"""同步只保管用户选中的完整版本，不能偷偷覆盖原任务或其他账号。"""

import base64
import copy
import hashlib
import json

import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app


@pytest.fixture
def sync_client(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        client.post(
            "/api/auth/register",
            json={"username": "sync_user", "password": "test-password"},
        )
        yield client


def bundle():
    # 固定样本包含每一类关联和模型来源，能发现同步丢字段的问题。
    session = {
        "id": "s1",
        "user_id": "local-user",
        "task_id": "t1",
        "device_id": "desktop",
        "source_checkpoint_id": None,
        "started_at": "2026-10-23T01:00:00Z",
        "ended_at": None,
    }
    return {
        "detail": {
            "task": {
                "id": "t1",
                "title": "积分",
                "course": "",
                "goal": "理解公式",
                "plugin_id": "math",
                "status": "active",
                "stage": "学习中",
                "revision": 3,
                "updated_at": "2026-10-23T01:00:00Z",
                "draft": {"thought": "保留疑问", "domain_data": {"conditions": "x>0"}},
                "session": session,
                "steps": [{"id": "step1", "title": "展开", "done": False}],
            },
            "checkpoints": [
                {
                    "id": "cp1",
                    "task_id": "t1",
                    "session_id": "s1",
                    "plugin_id": "math",
                    "plugin_version": "1.0.0",
                    "created_at": "2026-10-23T01:00:00Z",
                    "payload": {
                        "current_step": "计算中",
                        "next_action": "展开",
                        "resource_ids": ["r1"],
                        "origin_checkpoint_ids": ["original-cp"],
                        "domain_data": {"verified_steps": "已验证"},
                    },
                }
            ],
            "jobs": [
                {
                    "id": "j1",
                    "checkpoint_id": "cp1",
                    "provider": "http_provider",
                    "status": "succeeded",
                    "prompt": "历史原始提示",
                    "raw_output": "真实回复",
                    "error": None,
                    "created_at": "2026-10-23T01:00:00Z",
                    "profile_name": "本机模型",
                    "model_name": "small",
                }
            ],
            "cards": [
                {
                    "id": "c1",
                    "checkpoint_id": "cp1",
                    "job_id": "j1",
                    "status": "accepted",
                    "content": {
                        "summary": "确认内容",
                        "blocker": "",
                        "next_action": "展开",
                        "warmup": "",
                        "source_ids": ["cp1"],
                        "parse_note": "人工整理",
                    },
                    "created_at": "2026-10-23T01:00:00Z",
                }
            ],
            "resources": [
                {
                    "id": "r1",
                    "user_id": "local-user",
                    "task_id": "t1",
                    "filename": "notes.txt",
                    "size": 5,
                    "sha256": hashlib.sha256(b"notes").hexdigest(),
                    "created_at": "2026-10-23T01:00:00Z",
                }
            ],
            "sessions": [session],
            "events": [
                {
                    "id": "e1",
                    "task_id": "t1",
                    "session_id": "s1",
                    "event_type": "first_progress",
                    "created_at": "2026-10-23T01:00:00Z",
                }
            ],
        },
        "files": [{"id": "r1", "data": base64.b64encode(b"notes").decode()}],
    }


def push(client, value, revision=None):
    return client.put(
        "/api/device-sync/t1",
        json={
            "expected_revision": revision,
            "device_name": "我的电脑",
            "bundle": value,
        },
    )


def test_sync_roundtrip_cas_history_and_legacy_separation(sync_client):
    c = sync_client
    first = bundle()
    assert push(c, first).json() == {"revision": 1}
    assert c.get("/api/device-sync/t1").json() == {"revision": 1, "bundle": first}
    listing = c.get("/api/device-sync").json()
    assert len(listing) == 1
    assert {
        k: listing[0][k] for k in ("task_id", "title", "revision", "device_name")
    } == {"task_id": "t1", "title": "积分", "revision": 1, "device_name": "我的电脑"}
    edited = copy.deepcopy(first)
    edited["detail"]["task"]["title"] = "更新后的积分"
    assert push(c, edited, 1).json() == {"revision": 2}
    assert push(c, first, 1).status_code == 409
    assert push(c, first).status_code == 409
    assert c.get("/api/device-sync/t1").json() == {"revision": 2, "bundle": edited}
    assert c.get("/api/tasks").json() == []
    with c.app.state.db.transaction() as conn:
        rows = conn.execute(
            "SELECT revision,bundle FROM device_sync_history ORDER BY revision"
        ).fetchall()
    assert [r["revision"] for r in rows] == [1, 2]
    assert json.loads(rows[0]["bundle"]) == first


def test_sync_is_account_isolated_even_with_same_task_id(sync_client):
    c = sync_client
    assert push(c, bundle()).status_code == 200
    c.post("/api/auth/logout")
    assert c.get("/api/device-sync").status_code == 401
    c.post(
        "/api/auth/register",
        json={"username": "second_user", "password": "test-password"},
    )
    assert c.get("/api/device-sync").json() == []
    assert c.get("/api/device-sync/t1").status_code == 404
    assert push(c, bundle(), 1).status_code == 409
    assert push(c, bundle()).json() == {"revision": 1}
    c.post("/api/auth/logout")
    c.post(
        "/api/auth/login", json={"username": "sync_user", "password": "test-password"}
    )
    assert c.get("/api/device-sync/t1").json()["revision"] == 1


@pytest.mark.parametrize(
    "change",
    [
        lambda b: b.update(settings={"api_key": "secret"}),
        lambda b: b["detail"]["jobs"][0].update(encrypted_key="secret"),
        lambda b: b["detail"]["task"]["draft"].update(api_key="secret"),
        lambda b: b["detail"]["task"].update(id="another-task"),
        lambda b: b["detail"]["checkpoints"][0].update(task_id="another-task"),
        lambda b: b["detail"]["checkpoints"][0]["payload"].update(
            resource_ids=["missing"]
        ),
        lambda b: b["detail"]["cards"][0].update(job_id="missing"),
        lambda b: b["detail"]["cards"][0]["content"].update(source_ids=["missing"]),
        lambda b: b["detail"]["task"]["draft"].update(
            domain_data={"api_key": "secret"}
        ),
        lambda b: b["files"][0].update(data="not base64!"),
        lambda b: b["files"][0].update(data=base64.b64encode(b"wrong").decode()),
        lambda b: b["files"].clear(),
        lambda b: b["detail"]["jobs"].append(copy.deepcopy(b["detail"]["jobs"][0])),
    ],
)
def test_sync_rejects_secrets_bad_references_and_corrupt_files(sync_client, change):
    value = bundle()
    change(value)
    result = push(sync_client, value)
    assert result.status_code == 422, result.text
    assert sync_client.get("/api/device-sync").json() == []


def test_sync_checks_size_and_strict_revision(sync_client):
    value = bundle()
    data = b"x" * (10 * 1024 * 1024 + 1)
    value["files"][0]["data"] = base64.b64encode(data).decode()
    value["detail"]["resources"][0].update(
        size=len(data), sha256=hashlib.sha256(data).hexdigest()
    )
    assert push(sync_client, value).status_code == 413
    result = sync_client.put(
        "/api/device-sync/t1",
        json={"expected_revision": True, "device_name": "电脑", "bundle": bundle()},
    )
    assert result.status_code == 422


def test_sync_keeps_large_prompt_from_a_valid_full_snapshot(sync_client):
    value = bundle()
    # 合法的领域记录可以有多个3万字字段，拼出的历史提示词会超过20万字。
    value["detail"]["jobs"][0]["prompt"] = "历史学习内容" * 40000
    r = push(sync_client, value)
    assert r.status_code == 200, r.text
    assert (
        len(
            sync_client.get("/api/device-sync/t1").json()["bundle"]["detail"]["jobs"][
                0
            ]["prompt"]
        )
        == 240000
    )


def test_sync_rejects_cookie_account_switch_before_reading_or_saving(sync_client):
    c = sync_client
    first_id = c.get("/api/auth/me").json()["id"]
    c.post("/api/auth/logout")
    second_id = c.post(
        "/api/auth/register",
        json={"username": "cookie_switch", "password": "test-password"},
    ).json()["id"]
    stale = {"X-Study-User": first_id}
    r = c.put(
        "/api/device-sync/t1",
        headers=stale,
        json={
            "expected_revision": None,
            "device_name": "旧页面",
            "bundle": bundle(),
        },
    )
    assert r.status_code == 409, r.text
    assert r.json() == {"detail": "账号已切换，请刷新当前页面"}
    assert c.get("/api/device-sync", headers=stale).status_code == 409
    assert c.get("/api/device-sync/t1", headers=stale).status_code == 409
    assert c.get("/api/device-sync", headers={"X-Study-User": second_id}).json() == []
    with c.app.state.db.transaction() as conn:
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM device_sync WHERE user_id=?", (second_id,)
            ).fetchone()[0]
            == 0
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM device_sync_history WHERE user_id=?", (second_id,)
            ).fetchone()[0]
            == 0
        )
