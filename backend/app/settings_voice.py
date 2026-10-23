"""语音识别与文本整理是两种协议，配置分开，密钥复用服务器加密存储。"""

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field, field_validator, model_validator
from .auth import current_user
from .db import dumps, loads
from .schemas import Model
from .settings import ModelProfile, cipher, owned_profile

router = APIRouter(prefix="/api/settings/voice", tags=["语音设置"])
DEFAULT_VOICE = {
    "enabled": False,
    "api_url": "",
    "model": "",
    "encrypted_key": "",
    "language": "zh",
    "timeout": 60,
    "summary_profile_id": None,
}


class VoiceSettings(Model):
    enabled: bool = False
    api_url: str = Field(default="", max_length=2000)
    model: str = Field(default="", max_length=150)
    api_key: str = Field(default="", max_length=4000)
    clear_api_key: bool = False
    language: str = Field(default="zh", max_length=20, pattern=r"^[a-zA-Z-]*$")
    timeout: int = Field(default=60, ge=5, le=120)
    summary_profile_id: str | None = None

    @field_validator("api_url")
    @classmethod
    def valid_url(cls, value):
        return ModelProfile.http_endpoint(value) if value.strip() else ""

    @field_validator("model")
    @classmethod
    def trim_model(cls, value):
        return value.strip()

    @model_validator(mode="after")
    def enabled_requires_endpoint(self):
        if self.enabled and (not self.api_url or not self.model):
            raise ValueError("启用语音转写需要完整地址和模型名称")
        return self


def read_voice(c, user_id):
    row = c.execute(
        "SELECT body FROM voice_settings WHERE user_id=?", (user_id,)
    ).fetchone()
    return {**DEFAULT_VOICE, **(loads(row["body"]) if row else {})}


def public_voice(c, user_id):
    config = read_voice(c, user_id)
    return {k: v for k, v in config.items() if k != "encrypted_key"} | {
        "has_api_key": bool(config["encrypted_key"]),
    }


def resolve_speech(db, user_id):
    with db.transaction() as c:
        config = read_voice(c, user_id)
    if not config["enabled"]:
        raise HTTPException(
            422, "请在个人 → 设置 → 模型与API中启用语音转写，或直接输入转写文本。"
        )
    try:
        config["api_key"] = (
            cipher(db).decrypt(config["encrypted_key"].encode()).decode()
            if config["encrypted_key"]
            else ""
        )
    except (InvalidToken, ValueError):
        raise HTTPException(422, "语音密钥无法读取，请在语音设置中重新填写。")
    return config


@router.put("")
def save_voice(body: VoiceSettings, request: Request, user=Depends(current_user)):
    db = request.app.state.db
    with db.transaction() as c:
        if body.summary_profile_id:
            owned_profile(c, body.summary_profile_id, user["id"])
        old = read_voice(c, user["id"])
        encrypted = "" if body.clear_api_key else old["encrypted_key"]
        if body.api_key and not body.clear_api_key:
            encrypted = cipher(db).encrypt(body.api_key.encode()).decode()
        config = body.model_dump(exclude={"api_key", "clear_api_key"}) | {
            "encrypted_key": encrypted
        }
        c.execute(
            "INSERT INTO voice_settings VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body",
            (user["id"], dumps(config)),
        )
    from .settings import get_settings

    return get_settings(request, user)
