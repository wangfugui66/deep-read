"""Chat session service — file-based JSON persistence.

All sessions stored as data/wiki/<book>/chats/<session_id>.json
"""

import json as _json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import DATA_ROOT
from app.utils.file_ops import atomic_write_json


def _chats_dir(book_name: str) -> Path:
    return DATA_ROOT / "wiki" / book_name / "chats"


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_sessions(book_name: str) -> list[dict]:
    """Return all chat sessions for a book, sorted by updated_at descending."""
    d = _chats_dir(book_name)
    if not d.is_dir():
        return []

    sessions = []
    for f in sorted(d.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = _json.loads(f.read_text(encoding="utf-8"))
            sessions.append({
                "session_id": data.get("session_id", f.stem),
                "title": data.get("title", "新对话"),
                "message_count": len(data.get("messages", [])),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
            })
        except Exception:
            continue

    return sessions


def read_session(book_name: str, session_id: str) -> dict | None:
    """Read a single session file. Returns None if not found."""
    path = _chats_dir(book_name) / f"{session_id}.json"
    if not path.is_file():
        return None
    try:
        return _json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def append_message(book_name: str, session_id: str, role: str, content: str) -> dict:
    """Append a message to a session file. Creates the file if it doesn't exist."""
    d = _ensure_dir(_chats_dir(book_name))
    path = d / f"{session_id}.json"

    now = datetime.now(timezone.utc).isoformat()

    if path.is_file():
        try:
            data = _json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            data = {"session_id": session_id, "title": "新对话", "messages": [], "created_at": now}
    else:
        # New session — auto-title from first message
        title = content[:40] + ("…" if len(content) > 40 else "")
        data = {
            "session_id": session_id,
            "title": title,
            "messages": [],
            "created_at": now,
        }

    data["messages"].append({"role": role, "content": content, "timestamp": now})
    data["updated_at"] = now

    atomic_write_json(path, data)

    return data


def create_session(book_name: str) -> dict:
    """Create a new empty session."""
    session_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "session_id": session_id,
        "title": "新对话",
        "messages": [],
        "created_at": now,
        "updated_at": now,
    }
    d = _ensure_dir(_chats_dir(book_name))
    atomic_write_json(d / f"{session_id}.json", data)
    return data


def delete_session(book_name: str, session_id: str) -> bool:
    """Delete a session file. Returns True if deleted."""
    path = _chats_dir(book_name) / f"{session_id}.json"
    if path.is_file():
        path.unlink()
        return True
    return False
