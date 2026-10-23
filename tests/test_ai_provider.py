"""用本机临时HTTP服务检查AI协议，不消耗真实模型额度，也不读取任何密钥。"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app


@pytest.mark.parametrize("upstream_status", [200, 503])
def test_http_adapter_records_success_or_failure_without_losing_checkpoint(
    tmp_path, monkeypatch, upstream_status
):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append(
                json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            )
            self.send_response(upstream_status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {"choices": [{"message": {"content": "本机协议验收回复"}}]}
                ).encode()
            )

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("AI_API_URL", f"http://127.0.0.1:{server.server_port}/chat")
    monkeypatch.setenv("AI_API_KEY", "local-test-only")
    monkeypatch.setenv("AI_MODEL", "protocol-test")
    try:
        with TestClient(create_app(tmp_path)) as c:
            c.post(
                "/api/auth/register",
                json={"username": "test", "password": "local-test-password"},
            )
            t = c.post("/api/tasks", json={"title": "协议测试"}).json()
            t = c.post(
                f"/api/tasks/{t['id']}/start",
                json={"expected_revision": 0, "device_id": "test"},
            ).json()
            paused = c.post(
                f"/api/tasks/{t['id']}/pause",
                json={
                    "expected_revision": t["revision"],
                    "session_id": t["session"]["id"],
                    "request_id": "protocol-test",
                    "payload": {"current_step": "计算中", "next_action": "核对结果"},
                },
            ).json()
            c.post(
                f"/api/checkpoints/{paused['checkpoint']['id']}/ai-jobs",
                json={"provider": "http_provider"},
            )
            d = c.get(f"/api/tasks/{t['id']}").json()
            assert received[0]["model"] == "protocol-test"
            assert "计算中" in received[0]["messages"][0]["content"]
            assert d["checkpoints"][0]["payload"]["next_action"] == "核对结果"
            if upstream_status == 200:
                assert d["jobs"][0]["status"] == "succeeded"
                assert d["cards"][0]["content"]["summary"] == "本机协议验收回复"
            else:
                assert d["jobs"][0]["status"] == "failed"
                assert "local-test-only" not in d["jobs"][0]["error"]
                assert d["cards"] == []
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
