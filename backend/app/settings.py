"""按账号管理设置。浏览器永远拿不到已保存的API密钥，密钥也不进入学习备份。"""

import os
from time import monotonic
from typing import Literal
from urllib.parse import urlsplit
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field, field_validator
from .auth import current_user
from .db import uid, dumps, loads
from .schemas import Model
from .model_client import send_chat

router = APIRouter(prefix="/api/settings", tags=["设置中心"])
DEFAULT_APPEARANCE = {
    "theme": "light",
    "accent": "sage",
    "font_size": "medium",
    "density": "comfortable",
}
DEFAULT_AI = {"default_provider": "manual_lianxiaoli", "active_profile_id": None}


class Appearance(Model):
    theme: Literal["light", "dark", "system"] = "light"
    accent: Literal["sage", "blue", "violet"] = "sage"
    font_size: Literal["small", "medium", "large"] = "medium"
    density: Literal["comfortable", "compact"] = "comfortable"


class AISelection(Model):
    default_provider: Literal["manual_lianxiaoli", "http_provider"]
    active_profile_id: str | None = None


class ModelProfile(Model):
    name: str = Field(min_length=1, max_length=80)
    api_url: str = Field(min_length=1, max_length=2000)
    model: str = Field(min_length=1, max_length=150)
    api_key: str = Field(default="", max_length=4000)
    timeout: int = Field(default=30, ge=5, le=120)
    clear_api_key: bool = False

    @field_validator("name", "model")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("名称和模型不能为空")
        return value.strip()

    @field_validator("api_url")
    @classmethod
    def http_endpoint(cls, value):
        value = value.strip()
        url = urlsplit(value)
        if (
            url.scheme not in ("http", "https")
            or not url.hostname
            or url.username
            or url.password
            or url.fragment
        ):
            raise ValueError("请输入不含账号密码的完整HTTP/HTTPS请求地址")
        # 避免把密钥放在URL中并回显；参数应由专门的协议适配器处理。
        if url.query:
            raise ValueError("请不要在地址查询参数中填写密钥")
        try:
            url.port
        except ValueError:
            raise ValueError("端口格式无效")
        return value


def preferences(c, user_id):
    c.execute(
        "INSERT OR IGNORE INTO user_settings VALUES(?,?,?)",
        (user_id, dumps(DEFAULT_APPEARANCE), dumps(DEFAULT_AI)),
    )
    row = c.execute(
        "SELECT * FROM user_settings WHERE user_id=?", (user_id,)
    ).fetchone()
    return {"appearance": loads(row["appearance"]), "ai": loads(row["ai"])}


def owned_profile(c, profile_id, user_id):
    row = c.execute(
        "SELECT * FROM model_profiles WHERE id=? AND user_id=?", (profile_id, user_id)
    ).fetchone()
    if not row:
        raise HTTPException(404, "模型配置不存在")
    return row


def public_profile(row):
    # 不返回密钥、密文或“最后几位”，编辑时留空表示保留。
    return {
        **{k: row[k] for k in ("id", "name", "api_url", "model", "timeout")},
        "has_api_key": bool(row["encrypted_key"]),
    }


def cipher(db):
    path = db.directory / ".model-key"
    # 独占创建防止两个服务同时覆盖密钥。此文件和数据库都放在被Git忽略的data目录。
    try:
        with path.open("xb") as f:
            f.write(Fernet.generate_key())
        if os.name != "nt":
            path.chmod(0o600)
    except FileExistsError:
        pass
    return Fernet(path.read_bytes())


def resolve_model(db, user_id, profile_id=None):
    with db.transaction() as c:
        p = preferences(c, user_id)
        selected = profile_id or p["ai"]["active_profile_id"]
        row = owned_profile(c, selected, user_id) if selected else None
    if row:
        try:
            key = (
                cipher(db).decrypt(row["encrypted_key"].encode()).decode()
                if row["encrypted_key"]
                else ""
            )
        except (InvalidToken, ValueError):
            raise HTTPException(422, "密钥无法读取，请编辑该模型并重新填写密钥。")
        return {
            "name": row["name"],
            "api_url": row["api_url"],
            "model": row["model"],
            "api_key": key,
            "timeout": row["timeout"],
        }
    if not os.getenv("AI_API_URL"):
        raise HTTPException(422, "请先在设置中保存并选用模型，或使用连小理手动对话。")
    return {
        "name": "服务器默认",
        "api_url": os.environ["AI_API_URL"],
        "model": os.getenv("AI_MODEL", ""),
        "api_key": os.getenv("AI_API_KEY", ""),
        "timeout": 30,
    }


@router.get("")
def get_settings(request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        p = preferences(c, user["id"])
        profiles = [
            public_profile(r)
            for r in c.execute(
                "SELECT * FROM model_profiles WHERE user_id=? ORDER BY rowid",
                (user["id"],),
            )
        ]
    selected = next(
        (x for x in profiles if x["id"] == p["ai"]["active_profile_id"]), None
    )
    env_available = bool(os.getenv("AI_API_URL"))
    return {
        **p,
        "ai": {
            **p["ai"],
            "profiles": profiles,
            "environment_available": env_available,
            "environment_model": os.getenv("AI_MODEL", ""),
        },
        "http_ai_configured": bool(selected or env_available),
        "model": selected["model"] if selected else os.getenv("AI_MODEL", ""),
        "version": "1.1.0",
    }


@router.put("/appearance")
def save_appearance(body: Appearance, request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        preferences(c, user["id"])
        c.execute(
            "UPDATE user_settings SET appearance=? WHERE user_id=?",
            (dumps(body.model_dump()), user["id"]),
        )
    return get_settings(request, user)


@router.put("/ai")
def select_ai(body: AISelection, request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        preferences(c, user["id"])
        if body.active_profile_id:
            owned_profile(c, body.active_profile_id, user["id"])
        elif body.default_provider == "http_provider" and not os.getenv("AI_API_URL"):
            raise HTTPException(422, "请先添加并选择一个模型配置")
        c.execute(
            "UPDATE user_settings SET ai=? WHERE user_id=?",
            (dumps(body.model_dump()), user["id"]),
        )
    return get_settings(request, user)


@router.post("/models")
def add_model(body: ModelProfile, request: Request, user=Depends(current_user)):
    db = request.app.state.db
    encrypted = (
        cipher(db).encrypt(body.api_key.encode()).decode() if body.api_key else ""
    )
    pid = uid()
    with db.transaction() as c:
        count = c.execute(
            "SELECT count(*) FROM model_profiles WHERE user_id=?", (user["id"],)
        ).fetchone()[0]
        if count >= 20:
            raise HTTPException(422, "每个账号最多保存20套模型配置")
        c.execute(
            "INSERT INTO model_profiles VALUES(?,?,?,?,?,?,?)",
            (
                pid,
                user["id"],
                body.name,
                body.api_url,
                body.model,
                encrypted,
                body.timeout,
            ),
        )
        return public_profile(owned_profile(c, pid, user["id"]))


@router.put("/models/{profile_id}")
def edit_model(
    profile_id: str, body: ModelProfile, request: Request, user=Depends(current_user)
):
    db = request.app.state.db
    with db.transaction() as c:
        old = owned_profile(c, profile_id, user["id"])
        encrypted = "" if body.clear_api_key else old["encrypted_key"]
        if body.api_key and not body.clear_api_key:
            encrypted = cipher(db).encrypt(body.api_key.encode()).decode()
        c.execute(
            "UPDATE model_profiles SET name=?, api_url=?, model=?, encrypted_key=?, timeout=? WHERE id=?",
            (body.name, body.api_url, body.model, encrypted, body.timeout, profile_id),
        )
        return public_profile(owned_profile(c, profile_id, user["id"]))


@router.delete("/models/{profile_id}")
def remove_model(profile_id: str, request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        owned_profile(c, profile_id, user["id"])
        c.execute("DELETE FROM model_profiles WHERE id=?", (profile_id,))
        p = preferences(c, user["id"])
        if p["ai"]["active_profile_id"] == profile_id:
            c.execute(
                "UPDATE user_settings SET ai=? WHERE user_id=?",
                (dumps(DEFAULT_AI), user["id"]),
            )
    return get_settings(request, user)


@router.post("/models/{profile_id}/test")
def test_model(profile_id: str, request: Request, user=Depends(current_user)):
    config = resolve_model(request.app.state.db, user["id"], profile_id)
    started = monotonic()
    try:
        send_chat(config, "这是用户主动发起的连接测试。请只回复：连接成功。")
    except Exception:
        raise HTTPException(
            502, "连接测试失败，请检查请求地址、模型名称、密钥和超时设置。"
        )
    return {
        "ok": True,
        "elapsed_ms": round((monotonic() - started) * 1000),
        "model": config["model"],
    }
