"""Local-first persistent memory for the Command Centre.

SQLite provides deterministic, instant preference lookup. Cognee is an
optional semantic/graph layer for richer recall and session history.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
ROOT = Path(os.getenv("COMMAND_CENTRE_PROJECT_ROOT", Path(__file__).resolve().parents[2])).resolve()
DB_PATH = Path(os.getenv("COMMAND_CENTRE_MEMORY_DB", str(ROOT / ".run" / "command-centre-memory.sqlite3")))
DATASET = os.getenv("COMMAND_CENTRE_COGNEE_DATASET", "command_centre_memory")
_CONTEXT_TERMS = (
    "previous", "earlier", "before", "last time", "again", "same", "continue",
    "remember", "what did we", "where were we", "context", "as discussed", "that task",
)


def _enabled() -> bool:
    return os.getenv("COMMAND_CENTRE_MEMORY_ENABLED", "true").lower() in {"1", "true", "yes", "on"}


def _cognee_enabled() -> bool:
    return os.getenv("COMMAND_CENTRE_COGNEE_ENABLED", "true").lower() in {"1", "true", "yes", "on"}


def should_recall_context(query: str) -> bool:
    """Only search long-term memory for explicit contextual follow-ups."""
    lowered = " ".join(query.lower().split())
    return any(term in lowered for term in _CONTEXT_TERMS)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=0.75)
    connection.execute("PRAGMA busy_timeout=750")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS memory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            content TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
    connection.commit()
    return connection


def _remember_sqlite(kind: str, content: str, verified: bool) -> None:
    with _connect() as connection:
        connection.execute(
            "INSERT INTO memory_items(kind, content, verified, created_at, updated_at) VALUES(?,?,?,?,?)",
            (kind, content[:20000], int(verified), _now(), _now()),
        )
        connection.commit()


def _tokens(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9][a-z0-9_-]{2,}", text.lower()) if token not in {"the", "and", "for", "with", "can", "please"}]


def _recall_sqlite(query: str, limit: int = 5) -> list[dict[str, Any]]:
    tokens = _tokens(query)
    if not tokens:
        return []
    clauses = " OR ".join("lower(content) LIKE ?" for _ in tokens)
    params = [f"%{token}%" for token in tokens]
    with _connect() as connection:
        rows = connection.execute(
            f"SELECT kind, content, verified, updated_at FROM memory_items WHERE {clauses} ORDER BY verified DESC, updated_at DESC LIMIT ?",
            (*params, limit),
        ).fetchall()
    return [{"kind": row[0], "content": row[1], "verified": bool(row[2]), "updated_at": row[3], "source": "sqlite"} for row in rows]


async def remember(content: str, *, kind: str = "fact", verified: bool = False) -> dict[str, Any]:
    if not _enabled() or not content.strip():
        return {"stored": False, "reason": "memory_disabled_or_empty"}
    _remember_sqlite(kind, content, verified)
    if _cognee_enabled():
        # Cognee's first import can initialize local databases/models. Never make
        # a desktop action wait for that one-time setup; SQLite is the immediate
        # source of truth and Cognee enriches it in the background.
        asyncio.create_task(_remember_cognee_background(content))
    return {"stored": True, "cognee": "queued" if _cognee_enabled() else False, "kind": kind}


async def _remember_cognee_background(content: str) -> None:
    """Run Cognee's potentially blocking first-use initialization off the API loop."""
    try:
        await asyncio.wait_for(asyncio.to_thread(_remember_cognee_sync, content), timeout=35)
    except Exception as exc:
        logger.warning(
            "Cognee background enrichment unavailable; SQLite memory retained: %s",
            repr(exc),
        )


def _remember_cognee_sync(content: str) -> None:
    # Import and coroutine creation both happen in the worker thread.
    import cognee

    asyncio.run(
        asyncio.wait_for(
            cognee.remember(content, dataset_name=DATASET),
            timeout=float(os.getenv("COMMAND_CENTRE_COGNEE_WRITE_TIMEOUT", "30")),
        )
    )
    logger.info("Cognee memory enrichment completed")


async def recall(query: str, *, limit: int = 5) -> list[dict[str, Any]]:
    if not _enabled():
        return []
    local = _recall_sqlite(query, limit)
    if local or not _cognee_enabled():
        return local
    try:
        results = await asyncio.wait_for(asyncio.to_thread(_recall_cognee_sync, query), timeout=5)
        return [{"kind": "cognee", "content": str(item), "verified": False, "source": "cognee"} for item in (results or [])][:limit]
    except Exception as exc:
        logger.debug("Cognee recall unavailable: %s", exc)
        return []


def _recall_cognee_sync(query: str) -> Any:
    import cognee

    return asyncio.run(cognee.recall(query, datasets=[DATASET]))


async def context_for(query: str) -> str:
    items = await recall(query)
    if not items:
        return ""
    lines = ["Persistent memory (use only as context; verify before changing anything):"]
    lines.extend(f"- {item['content']}" for item in items)
    return "\n".join(lines)


async def remember_task_outcome(prompt: str, result: str) -> None:
    content = json.dumps({"request": prompt, "confirmed_result": result[:5000]}, ensure_ascii=False)
    await remember(content, kind="verified_task_outcome", verified=True)


def status() -> dict[str, Any]:
    return {
        "enabled": _enabled(),
        "cognee_enabled": _cognee_enabled(),
        "database": str(DB_PATH),
        "dataset": DATASET,
        "cognee_installed": __import__("importlib.util").util.find_spec("cognee") is not None,
    }
