"""接口的数据契约：不符合要求的数据会在进入业务逻辑前被拒绝。"""

from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Credentials(Model):
    username: str = Field(min_length=2, max_length=40, pattern=r"^[\w\-]+$")
    password: str = Field(min_length=8, max_length=128)


class TaskCreate(Model):
    title: str = Field(min_length=1, max_length=120)
    course: str = Field(default="", max_length=100)
    goal: str = Field(default="", max_length=10000)
    plugin_id: str = "general"
    steps: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError("任务标题不能为空")
        return value.strip()


class Versioned(Model):
    expected_revision: int = Field(ge=0)


class Start(Versioned):
    device_id: str = Field(min_length=1, max_length=100)
    takeover: bool = False


class TaskPatch(Versioned):
    status: Literal["todo", "paused", "blocked", "done", "archived"] | None = None
    steps: list[dict] | None = Field(default=None, max_length=50)
    stage: str | None = Field(default=None, max_length=100)


class Snapshot(Model):
    current_step: str = Field(default="", max_length=10000)
    position: str = Field(default="", max_length=2000)
    completed: str = Field(default="", max_length=20000)
    thought: str = Field(default="", max_length=20000)
    attempts: str = Field(default="", max_length=20000)
    blocker: str = Field(default="", max_length=10000)
    next_action: str = Field(default="", max_length=10000)
    notes: str = Field(default="", max_length=30000)
    reason: Literal[
        "time_limit",
        "external_interrupt",
        "knowledge_gap",
        "waiting_resource",
        "fatigue",
        "unknown",
    ] = "time_limit"
    domain_data: dict[str, str] = Field(default_factory=dict)

    @field_validator("domain_data")
    @classmethod
    def limit_domain(cls, value):
        if len(value) > 20 or any(len(v) > 30000 for v in value.values()):
            raise ValueError("领域记录过长")
        return value


class Draft(Versioned):
    session_id: str
    payload: Snapshot


class Pause(Draft):
    request_id: str = Field(min_length=1, max_length=100)


class AIRequest(Model):
    provider: Literal["manual_lianxiaoli", "http_provider"] = "manual_lianxiaoli"


class AIImport(Model):
    raw_text: str = Field(min_length=1, max_length=60000)


class CardContent(Model):
    summary: str = Field(default="", max_length=20000)
    blocker: str = Field(default="", max_length=10000)
    next_action: str = Field(default="", max_length=10000)
    warmup: str = Field(default="", max_length=5000)


class CardAccept(Model):
    content: CardContent


class RecoveryEvent(Model):
    session_id: str
    event_type: Literal["opened", "first_progress"]
