"""可阅读导出和完整ZIP备份。恢复时生成新ID，绝不覆盖已有任务或账号。"""

import io
import json
import sqlite3
import zipfile
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import Response
from .auth import current_user
from .db import uid, now, dumps, loads
from .tasks import detail
from .plugins import get_plugin

router = APIRouter(prefix="/api", tags=["导出与恢复"])


@router.get("/export")
def export(request: Request, format: str = "json", user=Depends(current_user)):
    db = request.app.state.db
    with db.transaction() as c:
        ids = [
            r["id"]
            for r in c.execute("SELECT id FROM tasks WHERE user_id=?", (user["id"],))
        ]
    data = {
        "schema_version": 1,
        "exported_at": now(),
        "tasks": [detail(tid, request, user) for tid in ids],
    }
    if format == "markdown":
        lines = ["# 学习续接记录", "", "导出时间：" + data["exported_at"], ""]
        for d in data["tasks"]:
            t = d["task"]
            lines += [
                "## " + t["title"],
                "",
                "目标：" + t["goal"],
                "状态：" + t["status"],
                "",
            ]
            for cp in d["checkpoints"]:
                lines += [
                    "### 中断于 " + cp["created_at"],
                    "",
                    *[f"- {k}：{v}" for k, v in cp["payload"].items() if v],
                    "",
                ]
            for j in d["jobs"]:
                lines += [
                    "### AI交互 · " + j["provider"],
                    "",
                    j.get("raw_output") or "尚无回复",
                    "",
                ]
        return Response(
            "\n".join(lines),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="study-notes.md"'},
        )
    if format == "json":
        return Response(
            dumps(data),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="study-backup.json"'},
        )
    if format != "zip":
        raise HTTPException(422, "支持json、markdown、zip格式")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("backup.json", dumps(data))
        for d in data["tasks"]:
            for r in d["resources"]:
                path = db.files / r["id"]
                if path.is_file():
                    z.write(path, "resources/" + r["id"])
    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="study-backup.zip"'},
    )


@router.post("/backup/import")
async def restore(file: UploadFile, request: Request, user=Depends(current_user)):
    raw = await file.read(50 * 1024 * 1024 + 1)
    if len(raw) > 50 * 1024 * 1024:
        raise HTTPException(413, "备份压缩包最多50MB")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        if sum(i.file_size for i in z.infolist()) > 100 * 1024 * 1024:
            raise ValueError("解压后过大")
        data = json.loads(z.read("backup.json"))
        if (
            data["schema_version"] != 1
            or not isinstance(data["tasks"], list)
            or len(data["tasks"]) > 500
        ):
            raise ValueError("备份版本或任务数量不支持")
        prepared = []
        for d in data["tasks"]:
            if not isinstance(d["task"]["title"], str) or not isinstance(
                d["checkpoints"], list
            ):
                raise ValueError("任务格式错误")
            get_plugin(d["task"]["plugin_id"])
            materials = {
                r["id"]: z.read("resources/" + r["id"]) for r in d["resources"]
            }
            prepared.append((d, materials))
    except (ValueError, KeyError, TypeError, zipfile.BadZipFile, OSError):
        raise HTTPException(422, "无效备份，请选择本应用导出的完整ZIP文件。")
    db = request.app.state.db
    written = []
    try:
        with db.transaction() as c:
            for d, materials in prepared:
                t, tid = d["task"], uid()
                resource_map = {r["id"]: uid() for r in d["resources"]}
                checkpoint_map = {cp["id"]: uid() for cp in d["checkpoints"]}
                session_map = {s["id"]: uid() for s in d.get("sessions", [])}
                value = {
                    k: v
                    for k, v in t.items()
                    if k not in ("id", "revision", "updated_at", "session")
                }
                value["title"] += "（恢复副本）"
                value["status"] = "paused" if d["checkpoints"] else "todo"
                c.execute(
                    "INSERT INTO tasks VALUES(?,?,?,?,?)",
                    (tid, user["id"], dumps(value), 0, now()),
                )
                # 备份中的活动会话恢复为已结束历史，避免与当前设备的会话竞争。
                for s in d.get("sessions", []):
                    c.execute(
                        "INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",
                        (
                            session_map[s["id"]],
                            user["id"],
                            tid,
                            s["device_id"],
                            checkpoint_map.get(s["source_checkpoint_id"]),
                            s["started_at"],
                            s["ended_at"] or now(),
                        ),
                    )
                for cp in d["checkpoints"]:
                    payload = {
                        **cp["payload"],
                        "resource_ids": [
                            resource_map[r]
                            for r in cp["payload"].get("resource_ids", [])
                            if r in resource_map
                        ],
                        "origin_checkpoint_ids": list(
                            dict.fromkeys(
                                [
                                    cp["id"],
                                    *cp["payload"].get("origin_checkpoint_ids", []),
                                ]
                            )
                        ),
                    }
                    c.execute(
                        "INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?)",
                        (
                            checkpoint_map[cp["id"]],
                            tid,
                            session_map.get(cp["session_id"]),
                            dumps(payload),
                            cp["plugin_id"],
                            cp["plugin_version"],
                            cp["created_at"],
                        ),
                    )
                for event in d.get("events", []):
                    if event["session_id"] in session_map:
                        c.execute(
                            "INSERT INTO events VALUES(?,?,?,?,?)",
                            (
                                uid(),
                                tid,
                                session_map[event["session_id"]],
                                event["event_type"],
                                event["created_at"],
                            ),
                        )
                job_map = {}
                for job in d.get("jobs", []):
                    jid = uid()
                    job_map[job["id"]] = jid
                    c.execute(
                        "INSERT INTO ai_jobs VALUES(?,?,?,?,?,?,?,?)",
                        (
                            jid,
                            checkpoint_map[job["checkpoint_id"]],
                            job["provider"],
                            (
                                "interrupted"
                                if job["status"] == "running"
                                else job["status"]
                            ),
                            job["prompt"],
                            job["raw_output"],
                            job["error"],
                            job["created_at"],
                        ),
                    )
                    if job.get("model_name"):
                        c.execute(
                            "INSERT INTO ai_job_models VALUES(?,?,?)",
                            (
                                jid,
                                job.get("profile_name") or "历史模型",
                                job["model_name"],
                            ),
                        )
                for card in d.get("cards", []):
                    content = {
                        **card["content"],
                        "source_ids": [checkpoint_map[card["checkpoint_id"]]],
                    }
                    c.execute(
                        "INSERT INTO cards VALUES(?,?,?,?,?,?)",
                        (
                            uid(),
                            checkpoint_map[card["checkpoint_id"]],
                            job_map.get(card["job_id"]),
                            dumps(content),
                            card["status"],
                            card["created_at"],
                        ),
                    )
                for r in d["resources"]:
                    rid = resource_map[r["id"]]
                    (db.files / rid).write_bytes(materials[r["id"]])
                    written.append(db.files / rid)
                    c.execute(
                        "INSERT INTO resources VALUES(?,?,?,?,?,?,?)",
                        (
                            rid,
                            user["id"],
                            tid,
                            r["filename"],
                            len(materials[r["id"]]),
                            r["sha256"],
                            r["created_at"],
                        ),
                    )
    except (ValueError, KeyError, TypeError, sqlite3.IntegrityError):
        for path in written:
            path.unlink(missing_ok=True)
        raise HTTPException(422, "备份内容不完整，恢复已撤销。")
    except Exception:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return {"imported": len(prepared)}
