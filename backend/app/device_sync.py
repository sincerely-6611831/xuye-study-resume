"""手动同步仓库：每次保存完整版本，与旧任务数据库的业务记录分开。"""

import base64
import binascii
import hashlib
import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ConfigDict, Field, ValidationError

from .auth import current_user
from .db import dumps, loads, now
from .plugins import validate_payload
from .schemas import Model, Snapshot

router = APIRouter(prefix="/api/device-sync", tags=["手动设备同步"])
MAX_REQUEST = 50 * 1024 * 1024
MAX_FILE = 10 * 1024 * 1024
MAX_TOTAL_FILES = 30 * 1024 * 1024
Id = Annotated[str, Field(min_length=1, max_length=100)]
Stamp = Annotated[str, Field(min_length=1, max_length=100)]


class SyncModel(Model):
    model_config = ConfigDict(extra="forbid", strict=True)


class SyncSnapshot(Snapshot):
    model_config = ConfigDict(extra="forbid", strict=True)
    resource_ids: list[Id] = Field(default_factory=list, max_length=100)
    origin_checkpoint_ids: list[Id] = Field(default_factory=list, max_length=1000)


class Step(SyncModel):
    id: Id
    title: str = Field(max_length=300)
    done: bool


class Session(SyncModel):
    id: Id
    user_id: Id | None = None
    task_id: Id
    device_id: Id
    source_checkpoint_id: Id | None = None
    started_at: Stamp
    ended_at: Stamp | None = None


class Task(SyncModel):
    id: Id
    title: str = Field(min_length=1, max_length=120)
    course: str = Field(default="", max_length=100)
    goal: str = Field(default="", max_length=10000)
    plugin_id: Id
    status: Literal["todo", "active", "paused", "blocked", "done", "archived"]
    stage: str = Field(max_length=100)
    revision: int = Field(ge=0)
    updated_at: Stamp
    draft: SyncSnapshot
    session: Session | None
    steps: list[Step] = Field(max_length=50)


class Checkpoint(SyncModel):
    id: Id
    task_id: Id
    session_id: Id | None
    payload: SyncSnapshot
    plugin_id: Id
    plugin_version: str = Field(min_length=1, max_length=40)
    created_at: Stamp


class Job(SyncModel):
    id: Id
    checkpoint_id: Id
    provider: Literal["manual_lianxiaoli", "http_provider"]
    status: Literal[
        "running", "awaiting_user", "received", "succeeded", "failed", "interrupted"
    ]
    prompt: str = Field(max_length=2000000)
    raw_output: str | None = Field(default=None, max_length=60000)
    error: str | None = Field(default=None, max_length=10000)
    created_at: Stamp
    profile_name: str | None = Field(default=None, max_length=80)
    model_name: str | None = Field(default=None, max_length=150)


class Content(SyncModel):
    summary: str = Field(default="", max_length=60000)
    blocker: str = Field(default="", max_length=20000)
    next_action: str = Field(default="", max_length=20000)
    warmup: str = Field(default="", max_length=20000)
    source_ids: list[Id] = Field(max_length=1000)
    parse_note: str = Field(default="", max_length=2000)


class Card(SyncModel):
    id: Id
    checkpoint_id: Id
    job_id: Id | None = None
    content: Content
    status: Literal["draft", "accepted", "reviewed"]
    created_at: Stamp


class Resource(SyncModel):
    id: Id
    user_id: Id | None = None
    task_id: Id | None = None
    filename: str = Field(min_length=1, max_length=200)
    size: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    created_at: Stamp | None = None


class Event(SyncModel):
    id: Id
    task_id: Id
    session_id: Id
    event_type: Literal["opened", "first_progress"]
    created_at: Stamp


class Detail(SyncModel):
    task: Task
    checkpoints: list[Checkpoint] = Field(max_length=2000)
    cards: list[Card] = Field(max_length=5000)
    jobs: list[Job] = Field(max_length=5000)
    resources: list[Resource] = Field(max_length=100)
    sessions: list[Session] = Field(max_length=5000)
    events: list[Event] = Field(max_length=10000)


class FileData(SyncModel):
    id: Id
    data: str


class Bundle(SyncModel):
    detail: Detail
    files: list[FileData] = Field(max_length=100)


class Push(SyncModel):
    expected_revision: int | None = Field(ge=0)
    device_name: str = Field(min_length=1, max_length=100)
    bundle: Bundle


def reject(message="同步内容的字段、引用或附件不完整"):
    raise HTTPException(422, message)


def unique(records):
    result = {r.id: r for r in records}
    if len(result) != len(records):
        reject("同步内容含重复编号")
    return result


def validate_bundle(task_id, bundle):
    """先检查所有关联，再写入一次事务，避免保存只有一半的任务。"""
    d, task = bundle.detail, bundle.detail.task
    if task.id != task_id or not task.title.strip():
        reject()
    checkpoints, sessions = unique(d.checkpoints), unique(d.sessions)
    jobs, resources = unique(d.jobs), unique(d.resources)
    unique(task.steps)
    unique(d.cards)
    unique(d.events)
    for record in [*d.checkpoints, *d.sessions, *d.resources, *d.events]:
        if record.task_id is not None and record.task_id != task_id:
            reject()
    if task.session:
        matching = sessions.get(task.session.id)
        if not matching or matching != task.session or matching.ended_at is not None:
            reject()
    for session in d.sessions:
        if (
            session.source_checkpoint_id
            and session.source_checkpoint_id not in checkpoints
        ):
            reject()
    for event in d.events:
        if event.session_id not in sessions:
            reject()
    for cp in d.checkpoints:
        if cp.session_id and cp.session_id not in sessions:
            reject()
        if cp.plugin_id != task.plugin_id:
            reject()
    for payload in [task.draft, *(cp.payload for cp in d.checkpoints)]:
        validate_payload(task.plugin_id, payload.model_dump())
        if not set(payload.resource_ids) <= resources.keys():
            reject()
    for job in d.jobs:
        if job.checkpoint_id not in checkpoints:
            reject()
    for card in d.cards:
        if card.checkpoint_id not in checkpoints:
            reject()
        if card.job_id and (
            card.job_id not in jobs
            or jobs[card.job_id].checkpoint_id != card.checkpoint_id
        ):
            reject()
        if not card.content.source_ids or any(
            source != card.checkpoint_id for source in card.content.source_ids
        ):
            reject()
    files = unique(bundle.files)
    if files.keys() != resources.keys():
        reject("每个附件都必须包含对应的文件内容")
    total = 0
    for fid, item in files.items():
        if len(item.data) > 4 * ((MAX_FILE + 2) // 3):
            raise HTTPException(413, "单个同步附件最多10MB")
        try:
            data = base64.b64decode(item.data, validate=True)
        except (ValueError, binascii.Error):
            reject("附件不是有效的base64内容")
        total += len(data)
        if len(data) > MAX_FILE or total > MAX_TOTAL_FILES:
            raise HTTPException(413, "单个附件最多10MB，任务附件合计最多30MB")
        resource = resources[fid]
        if (
            resource.size != len(data)
            or resource.sha256 != hashlib.sha256(data).hexdigest()
        ):
            reject("附件大小或SHA256校验不一致")


@router.get("")
def list_bundles(request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        return [
            dict(row)
            for row in c.execute(
                "SELECT task_id,title,revision,updated_at,device_name FROM device_sync WHERE user_id=? ORDER BY updated_at DESC",
                (user["id"],),
            )
        ]


@router.get("/{task_id}")
def get_bundle(task_id: str, request: Request, user=Depends(current_user)):
    with request.app.state.db.transaction() as c:
        row = c.execute(
            "SELECT revision,bundle FROM device_sync WHERE user_id=? AND task_id=?",
            (user["id"], task_id),
        ).fetchone()
    if not row:
        raise HTTPException(404, "同步任务不存在")
    return {"revision": row["revision"], "bundle": loads(row["bundle"])}


@router.put("/{task_id}")
async def push_bundle(task_id: str, request: Request, user=Depends(current_user)):
    # 分块计数，不依赖可能缺失或伪造的Content-Length。
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_REQUEST:
            raise HTTPException(413, "完整同步请求最多50MB")
    try:
        value = json.loads(raw)
        body = Push.model_validate(value)
    except (ValueError, TypeError, ValidationError, RecursionError):
        reject("同步格式无效，或包含不允许同步的设置和密钥字段")
    validate_bundle(task_id, body.bundle)
    # 保存原始JSON，校验模型的默认值不会悄悄改变历史证据。
    encoded, timestamp = dumps(value["bundle"]), now()
    with request.app.state.db.transaction() as c:
        previous = c.execute(
            "SELECT revision FROM device_sync WHERE user_id=? AND task_id=?",
            (user["id"], task_id),
        ).fetchone()
        if (previous is None and body.expected_revision is not None) or (
            previous is not None and body.expected_revision != previous["revision"]
        ):
            raise HTTPException(409, "远端版本已变化，请保留本机副本并对照后再同步")
        revision = previous["revision"] + 1 if previous else 1
        args = (
            user["id"],
            task_id,
            body.bundle.detail.task.title,
            revision,
            timestamp,
            body.device_name,
            encoded,
        )
        c.execute(
            "INSERT INTO device_sync VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,task_id) DO UPDATE SET title=excluded.title,revision=excluded.revision,updated_at=excluded.updated_at,device_name=excluded.device_name,bundle=excluded.bundle",
            args,
        )
        c.execute(
            "INSERT INTO device_sync_history VALUES(?,?,?,?,?,?)",
            (user["id"], task_id, revision, timestamp, body.device_name, encoded),
        )
    return {"revision": revision}
