"""附件按内部ID保存，原文件名只作展示，不能被用来拼接磁盘路径。"""

import hashlib
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from .auth import current_user
from .tasks import owned
from .db import uid, now

router = APIRouter(prefix="/api", tags=["材料"])
MAX_FILE = 10 * 1024 * 1024


@router.post("/tasks/{task_id}/resources")
async def upload(
    task_id: str, file: UploadFile, request: Request, user=Depends(current_user)
):
    db = request.app.state.db
    with db.transaction() as c:
        owned(c, task_id, user["id"])
    data = await file.read(MAX_FILE + 1)
    if len(data) > MAX_FILE:
        raise HTTPException(413, "单个附件最多10MB")
    rid = uid()
    (db.files / rid).write_bytes(data)
    name = (file.filename or "材料").replace("\\", "/").split("/")[-1][:200]
    try:
        with db.transaction() as c:
            c.execute(
                "INSERT INTO resources VALUES(?,?,?,?,?,?,?)",
                (
                    rid,
                    user["id"],
                    task_id,
                    name,
                    len(data),
                    hashlib.sha256(data).hexdigest(),
                    now(),
                ),
            )
            return dict(
                c.execute("SELECT * FROM resources WHERE id=?", (rid,)).fetchone()
            )
    except Exception:
        (db.files / rid).unlink(missing_ok=True)
        raise


@router.get("/resources/{resource_id}")
def download(resource_id: str, request: Request, user=Depends(current_user)):
    db = request.app.state.db
    with db.transaction() as c:
        row = c.execute(
            "SELECT * FROM resources WHERE id=? AND user_id=?",
            (resource_id, user["id"]),
        ).fetchone()
    if not row or not (db.files / resource_id).is_file():
        raise HTTPException(404, "材料不存在")
    # 作为下载提供，防止上传的HTML等内容在本站账号上下文中执行。
    return FileResponse(
        db.files / resource_id,
        filename=row["filename"],
        media_type="application/octet-stream",
    )
