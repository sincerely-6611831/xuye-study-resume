"""SQLite持久化：一个事务要么全部成功，要么全部撤销。"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def uid():
    return uuid4().hex


def now():
    return datetime.now(timezone.utc).isoformat()


def dumps(value):
    return json.dumps(value, ensure_ascii=False)


def loads(value):
    return json.loads(value) if value else None


class Database:
    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.files = self.directory / "resources"
        self.files.mkdir(exist_ok=True)
        self.path = self.directory / "study.db"
        with self.transaction() as c:
            # 第一版把领域内容放在JSON里，公用的状态和关联ID放在表字段中。
            # 这样增加插件字段不必每次都修改数据库表。
            c.executescript("""
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS auth_sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL, device_id TEXT NOT NULL, source_checkpoint_id TEXT, started_at TEXT NOT NULL, ended_at TEXT);
            CREATE TABLE IF NOT EXISTS checkpoints(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT, payload TEXT NOT NULL, plugin_id TEXT NOT NULL, plugin_version TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ai_jobs(id TEXT PRIMARY KEY, checkpoint_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL, raw_output TEXT, error TEXT, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, checkpoint_id TEXT NOT NULL, job_id TEXT, content TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT NOT NULL, event_type TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS receipts(user_id TEXT NOT NULL, request_id TEXT NOT NULL, task_id TEXT NOT NULL, checkpoint_id TEXT NOT NULL, PRIMARY KEY(user_id, request_id));
            CREATE TABLE IF NOT EXISTS user_settings(user_id TEXT PRIMARY KEY, appearance TEXT NOT NULL, ai TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS model_profiles(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, api_url TEXT NOT NULL, model TEXT NOT NULL, encrypted_key TEXT NOT NULL, timeout INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS ai_job_models(job_id TEXT PRIMARY KEY, profile_name TEXT NOT NULL, model_name TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS voice_settings(user_id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS task_owner ON tasks(user_id, updated_at);
            CREATE INDEX IF NOT EXISTS checkpoint_task ON checkpoints(task_id, created_at);
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_session ON sessions(user_id) WHERE ended_at IS NULL;
            PRAGMA user_version=3;
            """)
            # 进程重启后，先前未完成的AI请求不能一直停留在“生成中”。
            c.execute(
                "UPDATE ai_jobs SET status='interrupted', error='服务已重启，请重新生成' WHERE status='running'"
            )

    @contextmanager
    def transaction(self):
        c = sqlite3.connect(self.path, timeout=15)
        c.row_factory = sqlite3.Row
        try:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("BEGIN IMMEDIATE")
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()
