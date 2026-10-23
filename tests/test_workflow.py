"""使用临时数据库验证真实接口；每个测试都与用户会遇到的故障对应。"""

import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        r = c.post(
            "/api/auth/register",
            json={"username": "student", "password": "learn123456"},
        )
        assert r.status_code == 200
        yield c


def task(client, **kwargs):
    r = client.post(
        "/api/tasks", json={"title": "分部积分练习", "plugin_id": "math", **kwargs}
    )
    assert r.status_code == 200, r.text
    return r.json()


def start(client, t):
    r = client.post(
        f"/api/tasks/{t['id']}/start",
        json={"expected_revision": t["revision"], "device_id": "desktop"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def pause(client, t, request_id="pause-1"):
    return client.post(
        f"/api/tasks/{t['id']}/pause",
        json={
            "expected_revision": t["revision"],
            "session_id": t["session"]["id"],
            "request_id": request_id,
            "payload": {
                "current_step": "选择u和dv",
                "next_action": "比较两种分配",
                "thought": "尝试令对数项为u",
                "reason": "knowledge_gap",
                "domain_data": {"conditions": "x>0"},
            },
        },
    )


def test_pause_resume_preserves_thought_and_creates_a_new_session(client):
    t = start(client, task(client))
    r = pause(client, t)
    assert r.status_code == 200, r.text
    cp = r.json()["checkpoint"]
    assert cp["payload"]["thought"] == "尝试令对数项为u"
    assert r.json()["task"]["status"] == "blocked"
    resumed = start(client, r.json()["task"])
    assert resumed["session"]["id"] != t["session"]["id"]
    assert resumed["session"]["source_checkpoint_id"] == cp["id"]
    assert (
        client.get(f"/api/tasks/{t['id']}").json()["checkpoints"][0]["payload"][
            "thought"
        ]
        == "尝试令对数项为u"
    )


def test_retrying_pause_does_not_create_duplicate_or_revert_new_session(client):
    t = start(client, task(client))
    first = pause(client, t).json()
    resumed = start(client, first["task"])
    again = pause(client, t)
    assert again.status_code == 200
    detail = client.get(f"/api/tasks/{t['id']}").json()
    assert len(detail["checkpoints"]) == 1
    assert detail["task"]["session"]["id"] == resumed["session"]["id"]
    assert detail["task"]["status"] == "active"


def test_two_devices_cannot_silently_overwrite_a_draft(client):
    t = start(client, task(client))
    url = f"/api/tasks/{t['id']}/draft"
    body = {
        "expected_revision": t["revision"],
        "session_id": t["session"]["id"],
        "payload": {"thought": "电脑思路"},
    }
    assert client.put(url, json=body).status_code == 200
    body["payload"]["thought"] = "手机旧思路"
    assert client.put(url, json=body).status_code == 409
    assert (
        client.get(f"/api/tasks/{t['id']}").json()["task"]["draft"]["thought"]
        == "电脑思路"
    )


def test_another_account_cannot_read_task_or_attachment(client):
    t = task(client)
    upload = client.post(
        f"/api/tasks/{t['id']}/resources",
        files={"file": ("notes.txt", b"private", "text/plain")},
    ).json()
    client.post("/api/auth/logout")
    client.post(
        "/api/auth/register", json={"username": "other", "password": "learn123456"}
    )
    assert client.get(f"/api/tasks/{t['id']}").status_code == 404
    assert client.get(f"/api/resources/{upload['id']}").status_code == 404
    assert client.get("/api/tasks").json() == []


def test_active_task_requires_explicit_pause_and_device_takeover(client):
    t = start(client, task(client))
    other = task(client, title="阅读")
    assert (
        client.post(
            f"/api/tasks/{other['id']}/start",
            json={"expected_revision": 0, "device_id": "mobile"},
        ).status_code
        == 409
    )
    r = client.post(
        f"/api/tasks/{t['id']}/start",
        json={
            "expected_revision": t["revision"],
            "device_id": "mobile",
            "takeover": True,
        },
    )
    assert r.status_code == 200
    assert r.json()["session"]["id"] != t["session"]["id"]
    assert pause(client, t).status_code == 409


def test_ai_plain_text_is_retained_and_accept_does_not_modify_checkpoint(client):
    t = start(client, task(client))
    cp = pause(client, t).json()["checkpoint"]
    j = client.post(
        f"/api/checkpoints/{cp['id']}/ai-jobs", json={"provider": "manual_lianxiaoli"}
    ).json()
    assert "选择u和dv" in j["prompt"]
    imported = client.post(
        f"/api/ai-jobs/{j['id']}/import",
        json={"raw_text": "先检查积分条件，再继续计算。"},
    ).json()
    assert imported["raw_output"] == "先检查积分条件，再继续计算。"
    card = imported["card"]
    assert card["status"] == "draft"
    assert (
        client.post(
            f"/api/cards/{card['id']}/accept",
            json={"content": {"summary": "我的确认版本", "next_action": "先核对公式"}},
        ).status_code
        == 200
    )
    detail = client.get(f"/api/tasks/{t['id']}").json()
    assert detail["checkpoints"][0]["payload"] == cp["payload"]
    assert detail["cards"][0]["content"]["summary"] == "我的确认版本"
    assert not any(c["status"] == "draft" for c in detail["cards"])


def test_unknown_plugin_and_invalid_domain_fields_are_rejected(client):
    assert (
        client.post(
            "/api/tasks", json={"title": "test", "plugin_id": "missing"}
        ).status_code
        == 422
    )
    t = start(client, task(client))
    r = client.put(
        f"/api/tasks/{t['id']}/draft",
        json={
            "expected_revision": t["revision"],
            "session_id": t["session"]["id"],
            "payload": {"domain_data": {"conditions": ["bad type"]}},
        },
    )
    assert r.status_code == 422
    assert {p["id"] for p in client.get("/api/plugins").json()} == {
        "general",
        "math",
        "coding",
        "reading",
        "writing",
    }


def test_uploaded_material_and_backup_survive_export_restore(client):
    t = start(client, task(client))
    client.post(
        f"/api/tasks/{t['id']}/resources",
        files={"file": ("notes.txt", b"proof notes", "text/plain")},
    )
    pause(client, t)
    archive = client.get("/api/export?format=zip")
    assert archive.status_code == 200
    with zipfile.ZipFile(io.BytesIO(archive.content)) as z:
        assert "backup.json" in z.namelist()
        assert any(
            z.read(n) == b"proof notes"
            for n in z.namelist()
            if n.startswith("resources/")
        )
    imported = client.post(
        "/api/backup/import",
        files={"file": ("backup.zip", archive.content, "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    tasks = client.get("/api/tasks").json()
    assert len(tasks) == 2
    restored = next(x for x in tasks if x["id"] != t["id"])
    detail = client.get(f"/api/tasks/{restored['id']}").json()
    assert detail["checkpoints"][0]["payload"]["next_action"] == "比较两种分配"
    assert (
        client.get(f"/api/resources/{detail['resources'][0]['id']}").content
        == b"proof notes"
    )


def test_csrf_origin_and_bad_login_are_rejected(client):
    assert (
        client.post(
            "/api/tasks",
            headers={"Origin": "https://evil.example"},
            json={"title": "x"},
        ).status_code
        == 403
    )
    client.post("/api/auth/logout")
    assert (
        client.post(
            "/api/auth/login", json={"username": "student", "password": "wrong1234"}
        ).status_code
        == 401
    )
    assert client.get("/api/tasks").status_code == 401


def test_complete_reopen_and_recovery_event(client):
    t = start(client, task(client))
    url = f"/api/tasks/{t['id']}"
    r = client.post(
        url + "/events",
        json={"session_id": t["session"]["id"], "event_type": "first_progress"},
    )
    assert r.status_code == 200
    done = client.patch(
        url, json={"expected_revision": t["revision"], "status": "done"}
    ).json()
    assert done["status"] == "done"
    assert done["session"] is None
    assert start(client, done)["status"] == "active"


def test_restart_preserves_records(tmp_path):
    c = TestClient(create_app(tmp_path))
    with c:
        c.post(
            "/api/auth/register",
            json={"username": "persist", "password": "learn123456"},
        )
        t = task(c)
    with TestClient(create_app(tmp_path)) as c2:
        c2.post(
            "/api/auth/login", json={"username": "persist", "password": "learn123456"}
        )
        assert c2.get("/api/tasks").json()[0]["id"] == t["id"]


def test_backup_keeps_ai_sources_and_imported_reply(client):
    t = start(client, task(client))
    cp = pause(client, t).json()["checkpoint"]
    job = client.post(
        f"/api/checkpoints/{cp['id']}/ai-jobs", json={"provider": "manual_lianxiaoli"}
    ).json()
    client.post(
        f"/api/ai-jobs/{job['id']}/import", json={"raw_text": "这是实际导入的回复"}
    )
    archive = client.get("/api/export?format=zip")
    r = client.post("/api/backup/import", files={"file": ("copy.zip", archive.content)})
    assert r.status_code == 200, r.text
    restored = next(t2 for t2 in client.get("/api/tasks").json() if t2["id"] != t["id"])
    d = client.get(f"/api/tasks/{restored['id']}").json()
    assert d["jobs"][0]["raw_output"] == "这是实际导入的回复"
    assert d["cards"][0]["content"]["source_ids"] == [d["checkpoints"][0]["id"]]


def test_full_backup_restores_session_and_progress_event(client):
    t = start(client, task(client))
    client.post(
        f"/api/tasks/{t['id']}/events",
        json={"session_id": t["session"]["id"], "event_type": "first_progress"},
    )
    pause(client, t)
    archive = client.get("/api/export?format=zip")
    r = client.post("/api/backup/import", files={"file": ("copy.zip", archive.content)})
    assert r.status_code == 200
    restored = next(t2 for t2 in client.get("/api/tasks").json() if t2["id"] != t["id"])
    d = client.get(f"/api/tasks/{restored['id']}").json()
    assert len(d["sessions"]) == 1
    assert d["sessions"][0]["ended_at"] is not None
    assert d["events"][0]["session_id"] == d["sessions"][0]["id"]
    assert d["checkpoints"][0]["session_id"] == d["sessions"][0]["id"]


def test_invalid_ai_sources_keep_raw_reply_without_creating_card(client):
    t = start(client, task(client))
    cp = pause(client, t).json()["checkpoint"]
    job = client.post(
        f"/api/checkpoints/{cp['id']}/ai-jobs", json={"provider": "manual_lianxiaoli"}
    ).json()
    raw = '{"summary":"无依据","source_ids":["made-up"]}'
    assert (
        client.post(
            f"/api/ai-jobs/{job['id']}/import", json={"raw_text": raw}
        ).status_code
        == 422
    )
    d = client.get(f"/api/tasks/{t['id']}").json()
    assert d["jobs"][0]["raw_output"] == raw
    assert d["cards"] == []


def test_reimport_creates_separate_raw_evidence_versions(client):
    t = start(client, task(client))
    cp = pause(client, t).json()["checkpoint"]
    j = client.post(
        f"/api/checkpoints/{cp['id']}/ai-jobs", json={"provider": "manual_lianxiaoli"}
    ).json()
    client.post(f"/api/ai-jobs/{j['id']}/import", json={"raw_text": "第一份原始回复"})
    client.post(f"/api/ai-jobs/{j['id']}/import", json={"raw_text": "第二份原始回复"})
    d = client.get(f"/api/tasks/{t['id']}").json()
    assert {j["raw_output"] for j in d["jobs"]} == {"第一份原始回复", "第二份原始回复"}
    originals = {j["id"]: j["raw_output"] for j in d["jobs"]}
    assert all(c["content"]["summary"] == originals[c["job_id"]] for c in d["cards"])


def test_restored_manual_prompt_accepts_original_source_id_and_normalizes_card(client):
    t = start(client, task(client))
    cp = pause(client, t).json()["checkpoint"]
    j = client.post(
        f"/api/checkpoints/{cp['id']}/ai-jobs", json={"provider": "manual_lianxiaoli"}
    ).json()
    archive = client.get("/api/export?format=zip")
    client.post("/api/backup/import", files={"file": ("copy.zip", archive.content)})
    copy = next(x for x in client.get("/api/tasks").json() if x["id"] != t["id"])
    d = client.get(f"/api/tasks/{copy['id']}").json()
    raw = '{"summary":"来自恢复的旧提示词","source_ids":["' + cp["id"] + '"]}'
    r = client.post(f"/api/ai-jobs/{d['jobs'][0]['id']}/import", json={"raw_text": raw})
    assert r.status_code == 200, r.text
    assert r.json()["card"]["content"]["source_ids"] == [d["checkpoints"][0]["id"]]
    assert j["prompt"] == d["jobs"][0]["prompt"]  # 历史原文不因迁移被篡改。


def test_malformed_ai_source_type_is_retained_as_failed_import(client):
    t = start(client, task(client))
    cp = pause(client, t).json()["checkpoint"]
    job = client.post(
        f"/api/checkpoints/{cp['id']}/ai-jobs", json={"provider": "manual_lianxiaoli"}
    ).json()
    raw = '{"source_ids":[{"unexpected":"object"}]}'
    r = client.post(f"/api/ai-jobs/{job['id']}/import", json={"raw_text": raw})
    assert r.status_code == 422
    d = client.get(f"/api/tasks/{t['id']}").json()
    assert d["jobs"][0]["raw_output"] == raw
    assert d["jobs"][0]["status"] == "failed"


def test_unknown_account_does_not_log_in_even_with_placeholder_password(client):
    client.post("/api/auth/logout")
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "missing", "password": "dummy-password"},
        ).status_code
        == 401
    )
