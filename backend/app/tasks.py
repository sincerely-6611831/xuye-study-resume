"""任务/会话/快照模块。所有状态修改都检查版本，防止两台设备互相覆盖。"""

from fastapi import APIRouter, Depends, HTTPException, Request
from .auth import current_user
from .db import uid, now, dumps, loads
from .plugins import get_plugin, validate_payload
from .schemas import TaskCreate, TaskPatch, Start, Draft, Pause, RecoveryEvent

router = APIRouter(prefix="/api/tasks", tags=["任务与中断"])


def owned(c, task_id, user_id):
    row = c.execute(
        "SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)
    ).fetchone()
    if not row:
        raise HTTPException(404, "任务不存在")
    return row


def pack_task(c, row):
    result = {
        "id": row["id"],
        **loads(row["body"]),
        "revision": row["revision"],
        "updated_at": row["updated_at"],
    }
    s = c.execute(
        "SELECT * FROM sessions WHERE task_id=? AND ended_at IS NULL", (row["id"],)
    ).fetchone()
    result["session"] = dict(s) if s else None
    return result


def pack_checkpoint(row):
    return {**dict(row), "payload": loads(row["payload"])}


def check_revision(row, revision):
    if row["revision"] != revision:
        raise HTTPException(
            409, "其他设备或页面已经更新了这个任务。请先刷新对照，原草稿仍保留在本机。"
        )


def save_task(c, row, body):
    c.execute(
        "UPDATE tasks SET body=?, revision=revision+1, updated_at=? WHERE id=?",
        (dumps(body), now(), row["id"]),
    )
    return pack_task(
        c, c.execute("SELECT * FROM tasks WHERE id=?", (row["id"],)).fetchone()
    )


def live_session(c, task_id, session_id):
    s = c.execute(
        "SELECT * FROM sessions WHERE id=? AND task_id=? AND ended_at IS NULL",
        (session_id, task_id),
    ).fetchone()
    if not s:
        raise HTTPException(409, "学习会话已结束或已被另一设备接管，请刷新后继续。")
    return s


@router.get("")
def list_tasks(request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        return [
            pack_task(c, r)
            for r in c.execute(
                "SELECT * FROM tasks WHERE user_id=? ORDER BY updated_at DESC",
                (user["id"],),
            ).fetchall()
        ]


@router.post("")
def create_task(body: TaskCreate, request: Request, user=Depends(current_user)):
    get_plugin(body.plugin_id)
    tid = uid()
    value = {
        **body.model_dump(exclude={"steps"}),
        "status": "todo",
        "stage": "准备开始",
        "draft": {},
        "steps": [
            {"id": uid(), "title": s[:300], "done": False}
            for s in body.steps
            if s.strip()
        ],
    }
    with request.app.state.db.transaction() as c:
        c.execute(
            "INSERT INTO tasks VALUES(?,?,?,?,?)",
            (tid, user["id"], dumps(value), 0, now()),
        )
        return pack_task(c, owned(c, tid, user["id"]))


@router.get("/{task_id}")
def detail(task_id: str, request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        row = owned(c, task_id, user["id"])
        checkpoints = [
            pack_checkpoint(r)
            for r in c.execute(
                "SELECT * FROM checkpoints WHERE task_id=? ORDER BY created_at DESC",
                (task_id,),
            )
        ]
        ids = [p["id"] for p in checkpoints]
        cards, jobs = [], []
        for cp in ids:
            cards += [
                {**dict(r), "content": loads(r["content"])}
                for r in c.execute(
                    "SELECT * FROM cards WHERE checkpoint_id=? ORDER BY created_at DESC",
                    (cp,),
                )
            ]
            jobs += [
                dict(r)
                for r in c.execute(
                    "SELECT ai_jobs.*, ai_job_models.profile_name, ai_job_models.model_name FROM ai_jobs LEFT JOIN ai_job_models ON ai_job_models.job_id=ai_jobs.id WHERE checkpoint_id=? ORDER BY created_at DESC",
                    (cp,),
                )
            ]
        return {
            "task": pack_task(c, row),
            "checkpoints": checkpoints,
            "cards": cards,
            "jobs": jobs,
            "resources": [
                dict(r)
                for r in c.execute(
                    "SELECT * FROM resources WHERE task_id=?", (task_id,)
                )
            ],
            "sessions": [
                dict(r)
                for r in c.execute(
                    "SELECT * FROM sessions WHERE task_id=? ORDER BY started_at DESC",
                    (task_id,),
                )
            ],
            "events": [
                dict(r)
                for r in c.execute(
                    "SELECT * FROM events WHERE task_id=? ORDER BY created_at",
                    (task_id,),
                )
            ],
        }


@router.post("/{task_id}/start")
def start_task(task_id: str, body: Start, request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        row = owned(c, task_id, user["id"])
        check_revision(row, body.expected_revision)
        active = c.execute(
            "SELECT * FROM sessions WHERE user_id=? AND ended_at IS NULL", (user["id"],)
        ).fetchone()
        if active:
            if active["task_id"] != task_id:
                raise HTTPException(409, "请先保存并暂停当前正在学习的另一个任务。")
            if active["device_id"] == body.device_id and not body.takeover:
                return pack_task(c, row)
            if not body.takeover:
                raise HTTPException(
                    409, "任务正在另一设备学习，请明确选择“接管到本机”。"
                )
            c.execute(
                "UPDATE sessions SET ended_at=? WHERE id=?", (now(), active["id"])
            )
        cp = c.execute(
            "SELECT id FROM checkpoints WHERE task_id=? ORDER BY created_at DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        c.execute(
            "INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",
            (
                uid(),
                user["id"],
                task_id,
                body.device_id,
                cp["id"] if cp else None,
                now(),
                None,
            ),
        )
        value = loads(row["body"])
        value["status"] = "active"
        value["stage"] = "学习中"
        return save_task(c, row, value)


@router.put("/{task_id}/draft")
def save_draft(task_id: str, body: Draft, request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        row = owned(c, task_id, user["id"])
        check_revision(row, body.expected_revision)
        live_session(c, task_id, body.session_id)
        value = loads(row["body"])
        value["draft"] = validate_payload(value["plugin_id"], body.payload.model_dump())
        return save_task(c, row, value)


@router.post("/{task_id}/pause")
def pause_task(task_id: str, body: Pause, request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        row = owned(c, task_id, user["id"])
        # 先查幂等回执，再查版本：断网重发旧请求也只返回原快照，不重做状态修改。
        receipt = c.execute(
            "SELECT * FROM receipts WHERE user_id=? AND request_id=?",
            (user["id"], body.request_id),
        ).fetchone()
        if receipt:
            if receipt["task_id"] != task_id:
                raise HTTPException(409, "请求编号已用于另一任务")
            cp = c.execute(
                "SELECT * FROM checkpoints WHERE id=?", (receipt["checkpoint_id"],)
            ).fetchone()
            return {"task": pack_task(c, row), "checkpoint": pack_checkpoint(cp)}
        check_revision(row, body.expected_revision)
        live_session(c, task_id, body.session_id)
        value = loads(row["body"])
        payload = validate_payload(value["plugin_id"], body.payload.model_dump())
        if not payload["current_step"].strip() or not payload["next_action"].strip():
            raise HTTPException(422, "请至少填写“当前做到哪里”和“下一步最小行动”。")
        payload["resource_ids"] = [
            r["id"]
            for r in c.execute("SELECT id FROM resources WHERE task_id=?", (task_id,))
        ]
        cid = uid()
        c.execute(
            "INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?)",
            (
                cid,
                task_id,
                body.session_id,
                dumps(payload),
                value["plugin_id"],
                "1.0.0",
                now(),
            ),
        )
        c.execute("UPDATE sessions SET ended_at=? WHERE id=?", (now(), body.session_id))
        value["draft"] = body.payload.model_dump()
        value["status"] = (
            "blocked"
            if payload["reason"] in ("knowledge_gap", "waiting_resource")
            else "paused"
        )
        value["stage"] = "等待续接"
        updated = save_task(c, row, value)
        c.execute(
            "INSERT INTO receipts VALUES(?,?,?,?)",
            (user["id"], body.request_id, task_id, cid),
        )
        return {
            "task": updated,
            "checkpoint": pack_checkpoint(
                c.execute("SELECT * FROM checkpoints WHERE id=?", (cid,)).fetchone()
            ),
        }


@router.patch("/{task_id}")
def update_task(
    task_id: str, body: TaskPatch, request: Request, user=Depends(current_user)
):
    with request.app.state.db.transaction() as c:
        row = owned(c, task_id, user["id"])
        check_revision(row, body.expected_revision)
        value = loads(row["body"])
        if body.status:
            c.execute(
                "UPDATE sessions SET ended_at=? WHERE task_id=? AND ended_at IS NULL",
                (now(), task_id),
            )
            value["status"] = body.status
            value["stage"] = (
                "已完成"
                if body.status == "done"
                else "已归档" if body.status == "archived" else value["stage"]
            )
        if body.steps is not None:
            if any(
                not isinstance(s.get("title"), str)
                or not isinstance(s.get("done"), bool)
                or not isinstance(s.get("id"), str)
                for s in body.steps
            ):
                raise HTTPException(422, "步骤格式不正确")
            value["steps"] = body.steps
        if body.stage:
            value["stage"] = body.stage
        return save_task(c, row, value)


@router.post("/{task_id}/events")
def event(
    task_id: str, body: RecoveryEvent, request: Request, user=Depends(current_user)
):
    with request.app.state.db.transaction() as c:
        owned(c, task_id, user["id"])
        live_session(c, task_id, body.session_id)
        existing = c.execute(
            "SELECT * FROM events WHERE session_id=? AND event_type=?",
            (body.session_id, body.event_type),
        ).fetchone()
        if existing:
            return dict(existing)
        eid, created = uid(), now()
        c.execute(
            "INSERT INTO events VALUES(?,?,?,?,?)",
            (eid, task_id, body.session_id, body.event_type, created),
        )
        return {"id": eid, "created_at": created, "event_type": body.event_type}
