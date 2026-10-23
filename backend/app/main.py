"""应用组装入口。业务逻辑在各模块，便于独立修改和测试。"""

import os
import time
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from . import auth, tasks, ai, resources, exports
from .db import Database
from .plugins import PLUGINS, get_plugin

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def create_app(data_dir=None):
    app = FastAPI(title="学习断片续接器", version="1.0.0")
    app.state.db = Database(
        Path(data_dir) if data_dir else Path(os.getenv("STUDY_DATA_DIR", ROOT / "data"))
    )
    app.state.secure_cookie = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    auth_hits = defaultdict(deque)

    @app.middleware("http")
    async def common_headers(request: Request, call_next):
        # 网页写操作只允许本站来源；开发代理保持原Host即可。
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            allowed = {
                request.headers.get("host", ""),
                *os.getenv("ALLOWED_ORIGINS", "").split(","),
            }
            if origin and urlsplit(origin).netloc not in allowed:
                return JSONResponse({"detail": "不允许跨站提交"}, status_code=403)
        if (
            request.url.path in ("/api/auth/login", "/api/auth/register")
            and request.method == "POST"
        ):
            key = request.client.host if request.client else "unknown"
            q = auth_hits[key]
            while q and q[0] < time.monotonic() - 60:
                q.popleft()
            if len(q) >= 20:
                return JSONResponse(
                    {"detail": "尝试次数较多，请一分钟后重试"}, status_code=429
                )
            q.append(time.monotonic())
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    for module in (auth, tasks, ai, resources, exports):
        app.include_router(module.router)

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": "1.0.0"}

    @app.get("/api/plugins")
    def plugins(user=Depends(auth.current_user)):
        return [get_plugin(key) for key in PLUGINS]

    # 构建后的React与API由同一个服务提供，手机只需打开一个网址。
    frontend = ROOT / "frontend" / "dist"
    if frontend.exists():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app
