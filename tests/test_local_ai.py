"""临时HTTP模型验证无状态网关；测试输入不落入学习和设置表。"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app


@pytest.fixture
def local_ai(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        client.post(
            "/api/auth/register",
            json={"username": "local_ai", "password": "test-password"},
        )
        yield client, tmp_path


@pytest.fixture
def provider():
    calls = []
    result = {"chat": "本机回复"}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            calls.append((self.path, b"", dict(self.headers)))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {"data": [{"id": "small"}, {"id": "large"}, {"id": "small"}]}
                ).encode()
            )

        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            calls.append((self.path, body, dict(self.headers)))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            payload = (
                {"text": "口述原文"}
                if self.path.endswith("/transcriptions")
                else {"choices": [{"message": {"content": result["chat"]}}]}
            )
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", calls, result
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def config(base, **extra):
    return {
        "name": "我的电脑",
        "api_url": base + "/v1/chat/completions",
        "model": "small",
        "timeout": 30,
        "encrypted_key": "",
        **extra,
    }


def test_local_ai_seal_chat_models_and_no_persisted_learning(local_ai, provider):
    c, path = local_ai
    base, calls, _ = provider
    r = c.post("/api/local-ai/seal", json={"api_key": "stateless-secret"})
    assert r.status_code == 200, r.text
    encrypted = r.json()["encrypted_key"]
    assert encrypted and "stateless-secret" not in encrypted
    cfg = config(base, encrypted_key=encrypted)
    assert c.post(
        "/api/local-ai/chat", json={"config": cfg, "prompt": "只算本次输入"}
    ).json() == {"raw": "本机回复"}
    assert json.loads(calls[0][1])["messages"][0]["content"] == "只算本次输入"
    assert calls[0][2]["Authorization"] == "Bearer stateless-secret"
    assert c.post("/api/local-ai/models", json={"config": cfg}).json() == {
        "models": ["small", "large"]
    }
    assert calls[-1][0] == "/v1/models"
    assert (
        c.post(
            "/api/local-ai/chat", json={"config": config(base), "prompt": "无密钥"}
        ).status_code
        == 200
    )
    assert "Authorization" not in calls[-1][2]
    with c.app.state.db.transaction() as conn:
        for table in (
            "tasks",
            "checkpoints",
            "cards",
            "ai_jobs",
            "model_profiles",
            "user_settings",
            "voice_settings",
        ):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    assert b"stateless-secret" not in (path / "study.db").read_bytes()


def test_local_ai_voice_uses_whitelist_and_never_creates_a_task(local_ai, provider):
    c, _ = local_ai
    base, calls, result = provider
    cfg = config(base, api_url=base + "/v1/audio/transcriptions", language="zh")
    r = c.post(
        "/api/local-ai/transcribe",
        data={"config": json.dumps(cfg)},
        files={"file": ("private.wav", b"RIFFaudio", "audio/wav")},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"transcript": "口述原文", "model": "small"}
    assert b"RIFFaudio" in calls[-1][1] and b"private.wav" not in calls[-1][1]
    result["chat"] = json.dumps(
        {
            "fields": {
                "thought": "可能使用公式",
                "status": "done",
                "reason": "fatigue",
            },
            "domain_data": {"conditions": "x>0", "unknown": "忽略"},
        }
    )
    r = c.post(
        "/api/local-ai/summarize",
        json={
            "config": config(base),
            "task": {"title": "积分", "goal": "理解", "plugin_id": "math"},
            "transcript": "可能使用公式，条件x>0",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {
        "fields": {"thought": "可能使用公式"},
        "domain_data": {"conditions": "x>0"},
        "model": "small",
        "profile_name": "我的电脑",
    }
    result["chat"] = json.dumps({"fields": {}, "domain_data": {"sentence": "hello", "unknown": "ignore"}})
    custom = {
        "id": "custom-12345678", "version": "1.0.0", "name": "听力",
        "description": "记录关键句", "warmup": "哪一句不懂？",
        "fields": [{"key": "sentence", "label": "关键句", "hint": "原句", "type": "textarea"}],
    }
    request = {"config": config(base), "task": {"title": "听力", "goal": "理解", "plugin_id": custom["id"]}, "transcript": "hello", "plugin": custom}
    assert c.post("/api/local-ai/summarize", json=request).json()["domain_data"] == {"sentence": "hello"}
    assert c.post("/api/local-ai/summarize", json={**request, "plugin": None}).status_code == 422
    assert c.get("/api/tasks").json() == []
    assert (
        c.post(
            "/api/local-ai/transcribe",
            data={"config": json.dumps(cfg)},
            files={"file": ("bad.exe", b"MZ", "application/octet-stream")},
        ).status_code
        == 422
    )
    assert (
        c.post(
            "/api/local-ai/transcribe",
            data={"config": "{bad"},
            files={"file": ("a.wav", b"RIFF", "audio/wav")},
        ).status_code
        == 422
    )


def test_local_ai_rejects_bad_config_and_hides_provider_details(
    local_ai, provider, monkeypatch
):
    c, _ = local_ai
    base, _, _ = provider
    for values in (
        {"api_url": "file:///private"},
        {"api_url": "http://user:key@example.com/v1/chat/completions"},
        {"api_url": base + "/chat?key=secret"},
        {"encrypted_key": "not-valid"},
        {"model": " "},
    ):
        assert (
            c.post(
                "/api/local-ai/chat",
                json={"config": config(base, **values), "prompt": "测试"},
            ).status_code
            == 422
        )
    assert (
        c.post(
            "/api/local-ai/chat", json={"config": config(base), "prompt": " "}
        ).status_code
        == 422
    )

    def failed(*args):
        raise ValueError("provider secret private-path")

    monkeypatch.setattr("backend.app.local_ai.send_chat", failed)
    response = c.post(
        "/api/local-ai/chat", json={"config": config(base), "prompt": "测试"}
    )
    assert response.status_code == 502
    assert "private-path" not in response.text and "secret" not in response.text
    c.post("/api/auth/logout")
    assert c.post("/api/local-ai/seal", json={"api_key": "secret"}).status_code == 401


def test_settings_bootstrap_preserves_legacy_secrets_as_usable_account_bound_tokens(
    local_ai, provider
):
    c, _ = local_ai
    base, calls, _ = provider
    profile = c.post(
        "/api/settings/models",
        json={
            "name": "旧模型",
            "api_url": base + "/v1/chat/completions",
            "model": "small",
            "api_key": "legacy-model-secret",
        },
    ).json()
    c.put(
        "/api/settings/ai",
        json={"default_provider": "http_provider", "active_profile_id": profile["id"]},
    )
    c.put(
        "/api/settings/voice",
        json={
            "enabled": True,
            "api_url": base + "/v1/audio/transcriptions",
            "model": "speech",
            "api_key": "legacy-voice-secret",
        },
    )
    r = c.get("/api/local-ai/settings-bootstrap")
    assert r.status_code == 200, r.text
    assert "legacy-model-secret" not in r.text and "legacy-voice-secret" not in r.text
    value = r.json()
    assert value["ai"]["active_profile_id"] == profile["id"]
    migrated = value["ai"]["profiles"][0]
    assert migrated["encrypted_key"] and migrated["has_api_key"]
    model = {
        k: migrated[k] for k in ("name", "api_url", "model", "timeout", "encrypted_key")
    }
    assert (
        c.post(
            "/api/local-ai/chat", json={"config": model, "prompt": "使用迁移的模型"}
        ).status_code
        == 200
    )
    assert calls[-1][2]["Authorization"] == "Bearer legacy-model-secret"
    speech = value["speech"]
    cfg = {
        k: speech[k]
        for k in ("api_url", "model", "timeout", "language", "encrypted_key")
    }
    assert (
        c.post(
            "/api/local-ai/transcribe",
            data={"config": json.dumps(cfg)},
            files={"file": ("note.wav", b"RIFF", "audio/wav")},
        ).status_code
        == 200
    )
    assert calls[-1][2]["Authorization"] == "Bearer legacy-voice-secret"
    c.post("/api/auth/logout")
    assert c.get("/api/local-ai/settings-bootstrap").status_code == 401
    c.post(
        "/api/auth/register", json={"username": "other_ai", "password": "test-password"}
    )
    assert c.get("/api/local-ai/settings-bootstrap").json()["ai"]["profiles"] == []
    assert (
        c.post(
            "/api/local-ai/chat", json={"config": model, "prompt": "不得使用别人的密文"}
        ).status_code
        == 422
    )


def test_settings_bootstrap_materializes_environment_fallback_without_echoing_key(
    local_ai, provider, monkeypatch
):
    c, _ = local_ai
    base, calls, _ = provider
    monkeypatch.setenv("AI_API_URL", base + "/v1/chat/completions")
    monkeypatch.setenv("AI_API_KEY", "environment-only-secret")
    monkeypatch.setenv("AI_MODEL", "small")
    c.put(
        "/api/settings/ai",
        json={"default_provider": "http_provider", "active_profile_id": None},
    )
    r = c.get("/api/local-ai/settings-bootstrap")
    assert r.status_code == 200
    assert "environment-only-secret" not in r.text
    value = r.json()
    profile = next(
        p for p in value["ai"]["profiles"] if p["id"] == "environment-bootstrap"
    )
    assert value["ai"]["active_profile_id"] == "environment-bootstrap"
    assert value["ai"]["environment_available"] is False
    cfg = {
        k: profile[k] for k in ("name", "api_url", "model", "timeout", "encrypted_key")
    }
    assert (
        c.post(
            "/api/local-ai/chat", json={"config": cfg, "prompt": "使用环境迁移配置"}
        ).status_code
        == 200
    )
    assert calls[-1][2]["Authorization"] == "Bearer environment-only-secret"
    with c.app.state.db.transaction() as conn:
        assert conn.execute("SELECT COUNT(*) FROM model_profiles").fetchone()[0] == 0


def test_local_chat_accepts_prompt_generated_from_large_legal_learning_records(
    local_ai, provider
):
    c, _ = local_ai
    base, calls, _ = provider
    prompt = "历史学习内容" * 40000
    r = c.post("/api/local-ai/chat", json={"config": config(base), "prompt": prompt})
    assert r.status_code == 200, r.text[:1000]
    assert len(json.loads(calls[-1][1])["messages"][0]["content"]) == 240000


@pytest.mark.parametrize("endpoint", ["settings-bootstrap", "seal", "chat"])
def test_local_ai_rejects_switched_cookie_before_bootstrap_or_compute(
    local_ai, provider, endpoint
):
    c, _ = local_ai
    base, calls, _ = provider
    first_id = c.get("/api/auth/me").json()["id"]
    c.post("/api/auth/logout")
    second_id = c.post(
        "/api/auth/register",
        json={"username": "switched_ai", "password": "test-password"},
    ).json()["id"]
    headers = {"X-Study-User": first_id}
    if endpoint == "settings-bootstrap":
        r = c.get("/api/local-ai/settings-bootstrap", headers=headers)
    elif endpoint == "seal":
        r = c.post(
            "/api/local-ai/seal",
            headers=headers,
            json={"api_key": "do-not-seal-for-another-account"},
        )
    else:
        r = c.post(
            "/api/local-ai/chat",
            headers=headers,
            json={"config": config(base), "prompt": "旧账号的输入"},
        )
    assert r.status_code == 409, r.text
    assert r.json() == {"detail": "账号已切换，请刷新当前页面"}
    assert not calls
    assert (
        c.get("/api/auth/me", headers={"X-Study-User": second_id}).json()["id"]
        == second_id
    )
    with c.app.state.db.transaction() as conn:
        for table in ("tasks", "user_settings", "model_profiles", "voice_settings"):
            assert (
                conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE user_id=?", (second_id,)
                ).fetchone()[0]
                == 0
            )
