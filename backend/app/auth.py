"""账号和登录会话。数据库只保存密码派生值和令牌摘要，不保存明文。"""

import hashlib
import hmac
import secrets
import sqlite3
import time
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from .db import uid
from .schemas import Credentials

router = APIRouter(prefix="/api/auth", tags=["账号"])


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    result = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), 600000
    ).hex()
    return salt + ":" + result


def current_user(request: Request):
    token = request.cookies.get("study_session", "")
    with request.app.state.db.transaction() as c:
        row = c.execute(
            "SELECT users.id, users.username FROM auth_sessions JOIN users ON users.id=auth_sessions.user_id WHERE token=? AND expires>?",
            (digest(token), time.time()),
        ).fetchone()
    if not row:
        raise HTTPException(401, "请先登录")
    return dict(row)


def set_login(request, response, user_id):
    token = secrets.token_urlsafe(32)
    with request.app.state.db.transaction() as c:
        c.execute("DELETE FROM auth_sessions WHERE expires<?", (time.time(),))
        c.execute(
            "INSERT INTO auth_sessions VALUES(?,?,?)",
            (digest(token), user_id, time.time() + 7 * 86400),
        )
    response.set_cookie(
        "study_session",
        token,
        httponly=True,
        samesite="lax",
        secure=request.app.state.secure_cookie,
        max_age=7 * 86400,
    )


@router.post("/register")
def register(body: Credentials, request: Request, response: Response):
    user = {"id": uid(), "username": body.username}
    try:
        with request.app.state.db.transaction() as c:
            c.execute(
                "INSERT INTO users VALUES(?,?,?)",
                (user["id"], body.username, password_hash(body.password)),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "这个用户名已经存在")
    set_login(request, response, user["id"])
    return user


@router.post("/login")
def login(body: Credentials, request: Request, response: Response):
    with request.app.state.db.transaction() as c:
        row = c.execute(
            "SELECT * FROM users WHERE username=?", (body.username,)
        ).fetchone()
    stored = row["password"] if row else password_hash("dummy-password")
    matches = hmac.compare_digest(
        password_hash(body.password, stored.split(":")[0]), stored
    )
    if not row or not matches:
        raise HTTPException(401, "用户名或密码不正确")
    set_login(request, response, row["id"])
    return {"id": row["id"], "username": row["username"]}


@router.get("/me")
def me(user=Depends(current_user)):
    return user


@router.post("/logout")
def logout(request: Request, response: Response):
    with request.app.state.db.transaction() as c:
        c.execute(
            "DELETE FROM auth_sessions WHERE token=?",
            (digest(request.cookies.get("study_session", "")),),
        )
    response.delete_cookie("study_session")
    return {"ok": True}
