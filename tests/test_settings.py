"""设置应按账号保存；测试密钥不出现在读接口、备份或其他账号中。"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app


@pytest.fixture
def settings_client(tmp_path, monkeypatch):
    monkeypatch.delenv("AI_API_URL", raising=False)
    monkeypatch.delenv("AI_API_KEY", raising=False)
    with TestClient(create_app(tmp_path)) as c:
        c.post(
            "/api/auth/register",
            json={"username": "settings_user", "password": "settings-test-password"},
        )
        yield c, tmp_path


def profile(c, **kwargs):
    r = c.post(
        "/api/settings/models",
        json={
            "name": "自己的模型",
            "api_url": "http://127.0.0.1:19999/chat",
            "model": "study-model",
            "api_key": "secret-for-test-only",
            "timeout": 30,
            **kwargs,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_model_secrets_are_encrypted_and_never_returned_or_exported(settings_client):
    c, path = settings_client
    p = profile(c)
    s = c.get("/api/settings")
    assert p["has_api_key"] is True
    assert "secret-for-test-only" not in s.text
    assert "secret-for-test-only" not in (path / "study.db").read_bytes().decode(
        "latin1"
    )
    assert "secret-for-test-only" not in c.get("/api/export?format=json").text
    assert len(s.json()["ai"]["profiles"]) == 1


def test_model_edit_keeps_existing_key_when_left_blank_and_allows_explicit_clear(
    settings_client,
):
    c, _ = settings_client
    p = profile(c)
    r = c.put(
        f"/api/settings/models/{p['id']}",
        json={
            "name": "改名",
            "api_url": p["api_url"],
            "model": "model-2",
            "api_key": "",
            "timeout": 20,
        },
    )
    assert r.status_code == 200
    assert r.json()["has_api_key"] is True
    r = c.put(
        f"/api/settings/models/{p['id']}",
        json={
            "name": "无需密钥",
            "api_url": p["api_url"],
            "model": "local",
            "api_key": "",
            "clear_api_key": True,
            "timeout": 20,
        },
    )
    assert r.json()["has_api_key"] is False


def test_default_selection_and_appearance_persist_across_restart_and_accounts(
    settings_client,
):
    c, path = settings_client
    p = profile(c)
    assert (
        c.put(
            "/api/settings/ai",
            json={"default_provider": "http_provider", "active_profile_id": p["id"]},
        ).status_code
        == 200
    )
    appearance = {
        "theme": "dark",
        "accent": "blue",
        "font_size": "large",
        "density": "compact",
    }
    assert c.put("/api/settings/appearance", json=appearance).status_code == 200
    with TestClient(create_app(path)) as other:
        other.post(
            "/api/auth/login",
            json={"username": "settings_user", "password": "settings-test-password"},
        )
        s = other.get("/api/settings").json()
        assert s["appearance"] == appearance
        assert s["ai"]["active_profile_id"] == p["id"]
        other.post("/api/auth/logout")
        other.post(
            "/api/auth/register",
            json={"username": "other_user", "password": "settings-test-password"},
        )
        assert other.get("/api/settings").json()["ai"]["profiles"] == []
        assert (
            other.put(
                "/api/settings/ai",
                json={
                    "default_provider": "http_provider",
                    "active_profile_id": p["id"],
                },
            ).status_code
            == 404
        )
        assert other.delete(f"/api/settings/models/{p['id']}").status_code == 404


def test_removing_selected_model_falls_back_to_manual_without_touching_tasks(
    settings_client,
):
    c, _ = settings_client
    t = c.post("/api/tasks", json={"title": "保留的学习任务"}).json()
    p = profile(c)
    c.put(
        "/api/settings/ai",
        json={"default_provider": "http_provider", "active_profile_id": p["id"]},
    )
    assert c.delete(f"/api/settings/models/{p['id']}").status_code == 200
    s = c.get("/api/settings").json()
    assert s["ai"]["default_provider"] == "manual_lianxiaoli"
    assert s["ai"]["active_profile_id"] is None
    assert c.get(f"/api/tasks/{t['id']}").status_code == 200


def test_settings_reject_invalid_url_and_preferences(settings_client):
    c, _ = settings_client
    for url in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https://name:secret@example.com/chat",
        "relative/chat",
    ]:
        assert (
            c.post(
                "/api/settings/models",
                json={"name": "invalid", "api_url": url, "model": "m"},
            ).status_code
            == 422
        )
    assert (
        c.put("/api/settings/appearance", json={"theme": "unknown"}).status_code == 422
    )
    assert (
        c.put(
            "/api/settings/ai",
            json={"default_provider": "http_provider", "active_profile_id": None},
        ).status_code
        == 422
    )


def test_selected_profile_drives_real_http_generation_and_connection_test(
    settings_client,
):
    c, _ = settings_client
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((body, self.headers.get("Authorization")))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {"choices": [{"message": {"content": "接口已连接"}}]}
                ).encode()
            )

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        p = profile(
            c,
            api_url=f"http://127.0.0.1:{server.server_port}/chat",
            model="chosen-model",
        )
        assert c.post(f"/api/settings/models/{p['id']}/test").json()["ok"] is True
        c.put(
            "/api/settings/ai",
            json={"default_provider": "http_provider", "active_profile_id": p["id"]},
        )
        t = c.post("/api/tasks", json={"title": "实际路由检查"}).json()
        t = c.post(
            f"/api/tasks/{t['id']}/start",
            json={"expected_revision": 0, "device_id": "test"},
        ).json()
        paused = c.post(
            f"/api/tasks/{t['id']}/pause",
            json={
                "expected_revision": t["revision"],
                "session_id": t["session"]["id"],
                "request_id": "p1",
                "payload": {"current_step": "检查中", "next_action": "继续"},
            },
        ).json()
        j = c.post(
            f"/api/checkpoints/{paused['checkpoint']['id']}/ai-jobs",
            json={"provider": "http_provider"},
        )
        assert j.status_code == 200, j.text
        d = c.get(f"/api/tasks/{t['id']}").json()
        assert d["jobs"][0]["status"] == "succeeded"
        assert d["jobs"][0]["model_name"] == "chosen-model"
        assert calls[-1][0]["model"] == "chosen-model"
        assert calls[-1][1] == "Bearer secret-for-test-only"
        # 页面不指定旧profile_id时，下一次请求必须跟随账号最新选择。
        newer = profile(
            c, name="切换后的模型", api_url=p["api_url"], model="latest-model"
        )
        c.put(
            "/api/settings/ai",
            json={
                "default_provider": "http_provider",
                "active_profile_id": newer["id"],
            },
        )
        c.delete(f"/api/settings/models/{p['id']}")
        next_job = c.post(
            f"/api/checkpoints/{paused['checkpoint']['id']}/ai-jobs",
            json={"provider": "http_provider"},
        )
        assert next_job.status_code == 200
        assert calls[-1][0]["model"] == "latest-model"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
