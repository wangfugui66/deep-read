"""Note service — pure file-system note management.

Notes are stored as Markdown files:
  data/wiki/{book_name}/notes/{note_id}.md

Format:
  ---
  book: {book_name}
  created_at: {iso}
  ---
  ## 原文引用
  > {quote}

  ## 我的笔记
  {content}
"""

import json as _json
import re as _re
import uuid as _uuid
from datetime import datetime, timezone
from pathlib import Path


def _notes_dir(book_name: str, data_root: str | None = None) -> Path:
    """Resolve the notes directory for a book."""
    if data_root is None:
        data_root = Path(__file__).parent.parent / "data"
    return Path(data_root) / "wiki" / book_name / "notes"


def _note_id() -> str:
    """Generate a short note ID."""
    return str(_uuid.uuid4())[:8]


def save_note(
    book_name: str,
    quote: str,
    content: str,
    *,
    data_root: str | None = None,
) -> dict:
    """Save a user note as a Markdown file.

    Args:
        book_name: Book directory name.
        quote:     The original text being annotated.
        content:   The user's note content.

    Returns:
        {"note_id": str, "path": str, "created_at": str}
    """
    notes_dir = _notes_dir(book_name, data_root)
    notes_dir.mkdir(parents=True, exist_ok=True)

    nid = _note_id()
    created_at = datetime.now(timezone.utc).isoformat()

    md = f"""---
book: {book_name}
note_id: {nid}
created_at: {created_at}
---

## 原文引用

> {quote}

## 我的笔记

{content}
"""
    filepath = notes_dir / f"{nid}.md"
    filepath.write_text(md, encoding="utf-8")

    return {
        "note_id": nid,
        "path": str(filepath),
        "created_at": created_at,
    }


def list_notes(
    book_name: str,
    *,
    data_root: str | None = None,
) -> list[dict]:
    """List all notes for a book.

    Returns list of {"note_id", "quote", "content", "created_at", "path"}.
    """
    notes_dir = _notes_dir(book_name, data_root)
    if not notes_dir.exists():
        return []

    results = []
    for f in sorted(notes_dir.glob("*.md"), reverse=True):
        text = f.read_text(encoding="utf-8")
        parts = text.split("---", 2)
        fm = {}
        body = text
        if len(parts) >= 3:
            for line in parts[1].split("\n"):
                kv = line.split(":", 1)
                if len(kv) == 2:
                    fm[kv[0].strip()] = kv[1].strip().strip('"').strip("'")
            body = parts[2]

        # Extract quote
        quote_match = _re.search(r'> (.+)', body)
        quote = quote_match.group(1).strip() if quote_match else ""

        # Extract content (after ## 我的笔记)
        note_match = _re.search(r'## 我的笔记\n+(.+)', body, _re.DOTALL)
        content = note_match.group(1).strip() if note_match else body.strip()

        results.append({
            "note_id": fm.get("note_id", f.stem),
            "quote": quote[:200],
            "content": content[:500],
            "created_at": fm.get("created_at", ""),
            "path": str(f),
        })

    return results


def delete_note(
    book_name: str,
    note_id: str,
    *,
    data_root: str | None = None,
) -> bool:
    """Delete a note by ID. Returns True if deleted, False if not found."""
    notes_dir = _notes_dir(book_name, data_root)
    filepath = notes_dir / f"{note_id}.md"
    if filepath.exists():
        filepath.unlink()
        return True
    return False
