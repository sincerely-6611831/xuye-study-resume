"""语音功能只生成可确认的建议，不能直接改写任务或信任模型字段。"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app


@pytest.fixture
def voice_client(tmp_path, monkeypatch):
    monkeypatch.delenv("AI_API_URL", raising=False)
    with TestClient(create_app(tmp_path)) as c:
        c.post(
            "/api/auth/register",
            json={"username": "voice_user", "password": "voice-test-password"},
        )
        yield c, tmp_path


def save_voice(c, **overrides):
    return c.put(
        "/api/settings/voice",
        json={
            "enabled": True,
            "api_url": "http://127.0.0.1:19999/transcriptions",
            "model": "speech-model",
            "api_key": "speech-secret-test",
            "language": "zh",
            "timeout": 60,
            "summary_profile_id": None,
            **overrides,
        },
    )


def test_voice_settings_secret_persistence_and_isolation(voice_client):
    c, path = voice_client
    r = save_voice(c)
    assert r.status_code == 200, r.text
    assert r.json()["speech"]["has_api_key"]
    assert "speech-secret-test" not in c.get("/api/settings").text
    assert b"speech-secret-test" not in (path / "study.db").read_bytes()
    assert "speech-secret-test" not in c.get("/api/export?format=json").text
    assert save_voice(c, api_key="").json()["speech"]["has_api_key"]
    with TestClient(create_app(path)) as other:
        other.post(
            "/api/auth/login",
            json={"username": "voice_user", "password": "voice-test-password"},
        )
        assert other.get("/api/settings").json()["speech"]["model"] == "speech-model"
        other.post("/api/auth/logout")
        other.post(
            "/api/auth/register",
            json={"username": "other_voice", "password": "voice-test-password"},
        )
        assert other.get("/api/settings").json()["speech"]["enabled"] is False
    assert (
        save_voice(c, api_key="", clear_api_key=True).json()["speech"]["has_api_key"]
        is False
    )


def test_voice_rejects_invalid_configuration_and_foreign_model(voice_client):
    c, _ = voice_client
    for url in [
        "file:///etc/passwd",
        "https://user:key@example.com/speech",
        "https://example.com/speech?key=secret",
    ]:
        assert save_voice(c, api_url=url).status_code == 422
    assert save_voice(c, model=" ").status_code == 422
    assert save_voice(c, summary_profile_id="foreign").status_code == 404


def test_voice_requires_configuration_and_task_ownership(voice_client):
    c, _ = voice_client
    t = c.post("/api/tasks", json={"title": "语音任务"}).json()
    url = f"/api/tasks/{t['id']}/voice"
    assert (
        c.post(
            url + "/transcribe", files={"file": ("note.wav", b"RIFFtest", "audio/wav")}
        ).status_code
        == 422
    )
    assert (
        c.post(
            url + "/summarize", json={"transcript": "做到第三题，下一次展开积分"}
        ).status_code
        == 422
    )
    assert c.post(url + "/summarize", json={"transcript": "   "}).status_code == 422
    c.post("/api/auth/logout")
    c.post(
        "/api/auth/register",
        json={"username": "outsider", "password": "voice-test-password"},
    )
    assert (
        c.post(
            url + "/summarize", json={"transcript": "不应读取其他账号的任务"}
        ).status_code
        == 404
    )
    assert (
        c.post(
            url + "/transcribe", files={"file": ("note.wav", b"RIFFtest", "audio/wav")}
        ).status_code
        == 404
    )


def test_voice_http_pipeline_and_no_implicit_task_write(voice_client):
    c, _ = voice_client
    calls = []
    response = {
        "fields": {
            "current_step": "第3题积分",
            "next_action": "展开积分",
            "thought": "可能使用分部积分",
        },
        "domain_data": {"verified_steps": "已确认条件", "unknown": "不得填入"},
    }

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            calls.append((self.path, body, dict(self.headers)))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = (
                {"text": "做到第3题，下次展开积分"}
                if self.path == "/speech"
                else {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(response, ensure_ascii=False)
                            }
                        }
                    ]
                }
            )
            self.wfile.write(json.dumps(result, ensure_ascii=False).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_port}"
        profile = c.post(
            "/api/settings/models",
            json={
                "name": "整理模型",
                "api_url": base + "/chat",
                "model": "summary-model",
                "api_key": "summary-key",
            },
        ).json()
        assert (
            save_voice(
                c, api_url=base + "/speech", summary_profile_id=profile["id"]
            ).status_code
            == 200
        )
        t = c.post("/api/tasks", json={"title": "语音任务", "plugin_id": "math"}).json()
        before = c.get(f"/api/tasks/{t['id']}").json()
        url = f"/api/tasks/{t['id']}/voice"
        r = c.post(
            url + "/transcribe",
            files={"file": ("note.wav", b"RIFFtest-audio", "audio/wav")},
        )
        assert r.status_code == 200, r.text
        assert r.json()["transcript"] == "做到第3题，下次展开积分"
        assert b'name="model"' in calls[0][1] and b"speech-model" in calls[0][1]
        assert b"RIFFtest-audio" in calls[0][1]
        assert calls[0][2]["Authorization"] == "Bearer speech-secret-test"
        r = c.post(url + "/summarize", json={"transcript": r.json()["transcript"]})
        assert r.status_code == 200, r.text
        assert r.json()["fields"]["current_step"] == "第3题积分"
        assert r.json()["domain_data"] == {"verified_steps": "已确认条件"}
        body = json.loads(calls[-1][1])
        assert body["model"] == "summary-model"
        assert calls[-1][2]["Authorization"] == "Bearer summary-key"
        assert c.get(f"/api/tasks/{t['id']}").json() == before
        response["fields"] = {
            "current_step": 42,
            "next_action": "展开积分",
            "reason": "fatigue",
            "status": "done",
        }
        r = c.post(url + "/summarize", json={"transcript": "测试模型产生非法字段"})
        assert r.status_code == 200
        assert r.json()["fields"] == {"next_action": "展开积分"}
        response.clear()
        assert (
            c.post(url + "/summarize", json={"transcript": "无有效字段"}).status_code
            == 502
        )
        assert (
            c.post(
                url + "/transcribe",
                files={"file": ("note.exe", b"MZtest", "application/octet-stream")},
            ).status_code
            == 422
        )
        assert (
            c.post(
                url + "/transcribe", files={"file": ("note.wav", b"", "audio/wav")}
            ).status_code
            == 422
        )
        assert (
            c.post(
                url + "/transcribe",
                files={
                    "file": ("note.wav", b"0" * (20 * 1024 * 1024 + 1), "audio/wav")
                },
            ).status_code
            == 413
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_voice_failures_hide_provider_details_and_deleted_summary_follows_default(
    voice_client, monkeypatch
):
    c, _ = voice_client
    profile = c.post(
        "/api/settings/models",
        json={
            "name": "整理模型",
            "api_url": "http://127.0.0.1:19999/chat",
            "model": "summary",
        },
    ).json()
    save_voice(c, summary_profile_id=profile["id"])
    t = c.post("/api/tasks", json={"title": "上游故障"}).json()
    url = f"/api/tasks/{t['id']}/voice"

    def failed(*args):
        raise ValueError("provider details speech-secret-test")

    monkeypatch.setattr("backend.app.voice.send_transcription", failed)
    monkeypatch.setattr("backend.app.voice.send_chat", failed)
    for r in [
        c.post(
            url + "/transcribe", files={"file": ("test.wav", b"RIFFtest", "audio/wav")}
        ),
        c.post(url + "/summarize", json={"transcript": "上游失败"}),
    ]:
        assert r.status_code == 502
        assert "provider details" not in r.text and "speech-secret-test" not in r.text
    c.delete(f"/api/settings/models/{profile['id']}")
    assert c.get("/api/settings").json()["speech"]["summary_profile_id"] is None
    assert (
        c.post(url + "/summarize", json={"transcript": "缺少默认模型"}).status_code
        == 422
    )
