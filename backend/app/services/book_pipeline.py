"""Book pipeline runner — triggers global knowledge graph building via LLM.

The real graph is now auto-built at the end of build_book_index() in indexer_service.py.
This module exists as a compatibility wrapper for the POST /api/pipeline/start endpoint
and for manual re-triggering.
"""

import json
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone

logger = logging.getLogger("deepread.pipeline")

from app.core.config import DATA_ROOT

WIKI_ROOT = DATA_ROOT / "wiki"


async def run_book_pipeline(book_name: str):
    """Trigger global knowledge graph building.

    The graph is built from chapters_index.json summaries via LLM.
    This function:
    1. Writes initial status to .todo.json
    2. Calls build_global_knowledge_graph()
    3. Updates .todo.json with result
    """
    from .graph_service import build_global_knowledge_graph

    wiki_dir = WIKI_ROOT / book_name
    wiki_dir.mkdir(parents=True, exist_ok=True)
    todo_file = wiki_dir / ".todo.json"

    now = datetime.now(timezone.utc).isoformat()
    todo = {
        "phase": 1,
        "status": "processing",
        "total_chapters": 0,
        "completed_chapters": [],
        "total_nodes": 0,
        "completed_nodes": [],
        "graph_built": False,
        "started_at": now,
        "updated_at": now,
    }
    _write_json(todo_file, todo)

    try:
        result = await build_global_knowledge_graph(book_name)

        if result.get("status") == "ok":
            todo["graph_built"] = True
            todo["status"] = "completed"
            todo["total_nodes"] = result.get("nodes", 0)
            todo["completed_nodes"] = list(range(result.get("nodes", 0)))
            todo["updated_at"] = datetime.now(timezone.utc).isoformat()
            logger.info("Graph pipeline: %d nodes, %d edges", result["nodes"], result["edges"])
        else:
            todo["status"] = "failed"
            todo["updated_at"] = datetime.now(timezone.utc).isoformat()
            logger.warning("Graph pipeline failed: %s", result.get("message", "unknown"))
    except Exception as exc:
        todo["status"] = "failed"
        todo["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.exception("Graph pipeline exception: %s", exc)

    _write_json(todo_file, todo)


def _write_json(path: Path, data: dict):
    """Atomic-ish write."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
