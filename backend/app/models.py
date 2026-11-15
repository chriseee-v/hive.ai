from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AgentState(str, Enum):
    stopped = "stopped"
    idle = "idle"
    running = "running"
    blocked = "blocked"


class Agent(BaseModel):
    id: str
    name: str
    kind: str
    description: str
    state: AgentState = AgentState.stopped
    enabled: bool = True
    requires_approval: bool = False


class TaskCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    agent_id: str = "demo"
    approved: bool = False
    context: str = Field(default="", max_length=12000)


class Task(BaseModel):
    id: str
    prompt: str
    agent_id: str
    status: str = "queued"
    result: str | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    approval_required: bool = False
    mode: str | None = None
    reason: str | None = None
    plan: list[str] = Field(default_factory=list)
    tool_proposal_id: str | None = None
    tool_proposal: dict[str, Any] | None = None
    repair_attempts: int = 0
    repair_note: str | None = None


class ApprovalDecision(BaseModel):
    approved: bool


class Event(BaseModel):
    type: str
    task_id: str
    payload: dict[str, Any] = Field(default_factory=dict)

