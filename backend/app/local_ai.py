"""本机计算网关：配置随请求传入，结果由浏览器决定何时保存。"""

import json
import os
from pathlib import Path

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import Field, ValidationError, field_validator

from .auth import current_user
from .model_client import send_chat, send_models, send_transcription
from .plugins import get_plugin
from .schemas import Model
from .settings import ModelProfile, cipher, get_settings
from .settings_voice import read_voice
from .voice import AUDIO_TYPES, MAX_AUDIO, Summarize, extract_fields, summary_prompt

router = APIRouter(prefix="/api/local-ai", tags=["本机模型网关"])


class Config(Model):
    name: str = Field(default="本机模型", min_length=1, max_length=80)
    api_url: str = Field(min_length=1, max_length=2000)
    model: str = Field(min_length=1, max_length=150)
    timeout: int = Field(default=30, ge=5, le=120)
    encrypted_key: str = Field(default="", max_length=8000)
    language: str = Field(default="zh", max_length=20, pattern=r"^[a-zA-Z-]*$")

    @field_validator("api_url")
    @classmethod
    def endpoint(cls, value):
        return ModelProfile.http_endpoint(value)

    @field_validator("name", "model")
    @classmethod
    def not_blank(cls, value):
        return ModelProfile.not_blank(value)


class Seal(Model):
    api_key: str = Field(max_length=4000)


class ConfigRequest(Model):
    config: Config


class Chat(ConfigRequest):
    prompt: str = Field(min_length=1, max_length=2000000)

    @field_validator("prompt")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("提示词不能为空")
        return value


class TaskContext(Model):
    title: str = Field(min_length=1, max_length=120)
    goal: str = Field(default="", max_length=10000)
    plugin_id: str = Field(default="general", max_length=100)


class SummaryRequest(Summarize):
    config: Config
    task: TaskContext


def resolve(config, request, user):
    """封装密文绑定账号；换电脑或换账号后需要重新填写密钥。"""
    key = ""
    if config.encrypted_key:
        try:
            sealed = json.loads(
                cipher(request.app.state.db).decrypt(config.encrypted_key.encode())
            )
            if sealed["user_id"] != user["id"] or not isinstance(
                sealed["api_key"], str
            ):
                raise ValueError("密文不属于当前账号")
            key = sealed["api_key"]
        except (InvalidToken, ValueError, TypeError, KeyError, UnicodeError):
            raise HTTPException(422, "密钥无法在当前网关账号读取，请重新填写密钥")
    return config.model_dump(exclude={"encrypted_key"}) | {"api_key": key}


def seal_key(db, user_id, api_key):
    if not api_key:
        return ""
    plain = json.dumps({"user_id": user_id, "api_key": api_key}).encode()
    return cipher(db).encrypt(plain).decode()


def migrate_key(db, user_id, encrypted_key):
    """旧密文只在网关内解密，然后转换为绑定账号的本机配置密文。"""
    if not encrypted_key:
        return ""
    try:
        plain = cipher(db).decrypt(encrypted_key.encode()).decode()
    except (InvalidToken, ValueError, UnicodeError):
        raise HTTPException(422, "旧模型密钥无法迁移，请在原设置中重新填写密钥")
    return seal_key(db, user_id, plain)


@router.get("/settings-bootstrap")
def settings_bootstrap(request: Request, user=Depends(current_user)):
    db = request.app.state.db
    result = get_settings(request, user)
    with db.transaction() as c:
        profiles = {
            row["id"]: row["encrypted_key"]
            for row in c.execute(
                "SELECT id,encrypted_key FROM model_profiles WHERE user_id=?",
                (user["id"],),
            )
        }
        speech = read_voice(c, user["id"])
    for profile in result["ai"]["profiles"]:
        profile["encrypted_key"] = migrate_key(db, user["id"], profiles[profile["id"]])
    result["speech"]["encrypted_key"] = migrate_key(
        db, user["id"], speech["encrypted_key"]
    )
    if os.getenv("AI_API_URL"):
        # 环境配置也复制成设备配置，之后的计算不再依赖隐含的服务器默认项。
        profile = {
            "id": "environment-bootstrap",
            "name": "服务器默认（迁移）",
            "api_url": os.environ["AI_API_URL"],
            "model": os.getenv("AI_MODEL", ""),
            "timeout": 30,
            "encrypted_key": seal_key(db, user["id"], os.getenv("AI_API_KEY", "")),
            "has_api_key": bool(os.getenv("AI_API_KEY")),
        }
        result["ai"]["profiles"].append(profile)
        if (
            result["ai"]["default_provider"] == "http_provider"
            and not result["ai"]["active_profile_id"]
        ):
            result["ai"]["active_profile_id"] = profile["id"]
        result["ai"]["environment_available"] = False
        result["ai"]["environment_model"] = ""
    return result


@router.post("/seal")
def seal(body: Seal, request: Request, user=Depends(current_user)):
    # 只在网关保留加密主密钥，不保存提交的API密钥或请求内容。
    return {"encrypted_key": seal_key(request.app.state.db, user["id"], body.api_key)}


@router.post("/chat")
def chat(body: Chat, request: Request, user=Depends(current_user)):
    config = resolve(body.config, request, user)
    try:
        return {"raw": send_chat(config, body.prompt)}
    except Exception:
        raise HTTPException(502, "模型调用失败，请检查地址、模型、密钥、超时与回复格式")


@router.post("/models")
def models(body: ConfigRequest, request: Request, user=Depends(current_user)):
    config = resolve(body.config, request, user)
    try:
        return {"models": send_models(config)}
    except Exception:
        raise HTTPException(502, "模型列表读取失败，请检查兼容接口地址、密钥和超时")


@router.post("/transcribe")
def transcribe(
    request: Request,
    config: str = Form(..., max_length=16000),
    file: UploadFile = File(...),
    user=Depends(current_user),
):
    try:
        parsed = Config.model_validate_json(config)
    except (ValueError, ValidationError):
        raise HTTPException(422, "语音模型配置格式无效")
    resolved = resolve(parsed, request, user)
    ext = Path(file.filename or "").suffix.lower().lstrip(".")
    if ext not in AUDIO_TYPES:
        raise HTTPException(422, "请选择支持的音频格式")
    audio = file.file.read(MAX_AUDIO + 1)
    if len(audio) > MAX_AUDIO:
        raise HTTPException(413, "音频不能超过20MB")
    if not audio:
        raise HTTPException(422, "音频为空")
    try:
        text = send_transcription(resolved, audio, "recording." + ext, AUDIO_TYPES[ext])
    except Exception:
        raise HTTPException(502, "语音转写失败，请检查接口、模型、密钥、格式和超时")
    return {"transcript": text, "model": resolved["model"]}


@router.post("/summarize")
def summarize(body: SummaryRequest, request: Request, user=Depends(current_user)):
    plugin = get_plugin(body.task.plugin_id)
    config = resolve(body.config, request, user)
    prompt = summary_prompt(body.task.model_dump(), body.transcript, plugin)
    try:
        result = extract_fields(send_chat(config, prompt), plugin)
    except Exception:
        raise HTTPException(
            502, "AI整理失败或未返回有效字段，请检查模型配置或修改转写文本"
        )
    return {**result, "model": config["model"], "profile_name": config["name"]}
