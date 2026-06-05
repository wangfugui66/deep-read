"""Book pipeline runner — extracts concepts, builds knowledge graph JSON.

Invoked by POST /api/pipeline/start as a background task.
Reads .md chapters from data/raw/sources/<book>/, writes graph.json to data/wiki/<book>/.
"""

import json
import os
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone

logger = logging.getLogger("deepread.pipeline")

# ── Data root — matches resource_router.py (4 levels up from services/) ──
_DATA_ROOT = Path(__file__).parent.parent.parent.parent / "data"
RAW_ROOT = _DATA_ROOT / "raw" / "sources"
WIKI_ROOT = _DATA_ROOT / "wiki"


async def run_book_pipeline(book_name: str):
    """Run the full pipeline in background: concept extraction → graph.json.

    This is a simplified version that:
    1. Reads all .md chapters
    2. Extracts headings as concept nodes
    3. Links adjacent concepts as edges
    4. Writes graph.json to data/wiki/<book>/graph.json
    """
    book_dir = RAW_ROOT / book_name
    wiki_dir = WIKI_ROOT / book_name
    todo_file = wiki_dir / ".todo.json"

    if not book_dir.is_dir():
        logger.warning("Book directory not found: %s", book_dir)
        return

    # Ensure wiki dir exists
    wiki_dir.mkdir(parents=True, exist_ok=True)

    # ── Update .todo.json status ──
    now = datetime.now(timezone.utc).isoformat()
    chapters = sorted(
        [f for f in book_dir.rglob("*.md") if f.is_file() and f.stem != book_dir.name],
        key=lambda f: f.name,
    )

    todo = {
        "phase": 1,
        "status": "processing",
        "total_chapters": len(chapters),
        "completed_chapters": [],
        "total_nodes": 0,
        "completed_nodes": [],
        "graph_built": False,
        "started_at": now,
        "updated_at": now,
    }
    _write_json(todo_file, todo)

    # ── Phase 1: Extract concepts from headings ──
    nodes: list[dict] = []
    node_ids: set[str] = set()
    concept_idx = 0

    for ch_file in chapters:
        try:
            content = ch_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        for line in content.splitlines():
            line = line.strip()
            if not line.startswith("#"):
                continue

            # Clean heading: strip # markers and numeric prefixes
            heading = line.lstrip("#").strip()
            heading = heading.split(" ", 1)[-1] if " " in heading else heading

            if not heading or len(heading) < 2:
                continue

            node_id = f"concept-{_safe_id(heading)}"
            if node_id in node_ids:
                continue
            node_ids.add(node_id)

            concept_idx += 1
            nodes.append({
                "id": node_id,
                "label": heading[:40],
                "type": "concept",
                "community_id": 0,
                "size": 6 + (len(heading) % 6),
                "x": 200 + (concept_idx * 137) % 800,
                "y": 150 + (concept_idx * 293) % 500,
            })

        # Mark chapter as completed
        rel = str(ch_file.relative_to(book_dir)).replace("\\", "/")
        if rel not in todo["completed_chapters"]:
            todo["completed_chapters"].append(rel)
            todo["updated_at"] = datetime.now(timezone.utc).isoformat()
            _write_json(todo_file, todo)

    todo["total_nodes"] = len(nodes)
    todo["completed_nodes"] = list(range(len(nodes)))
    todo["phase"] = 3
    todo["updated_at"] = datetime.now(timezone.utc).isoformat()

    # ── Phase 2: Build edges (adjacent concepts) ──
    edges: list[dict] = []
    for i in range(len(nodes) - 1):
        edges.append({
            "source": nodes[i]["id"],
            "target": nodes[i + 1]["id"],
            "weight": 1,
        })

    # ── Write graph.json ──
    graph_file = wiki_dir / "graph.json"
    _write_json(graph_file, {"nodes": nodes, "edges": edges})

    todo["graph_built"] = True
    todo["status"] = "completed"
    todo["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_json(todo_file, todo)

    logger.info("Pipeline complete for %s: %d nodes, %d edges", book_name, len(nodes), len(edges))


def _write_json(path: Path, data: dict):
    """Atomic-ish write."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _safe_id(text: str, max_len: int = 50) -> str:
    """Convert text to a safe identifier."""
    result = ""
    for ch in text[:max_len]:
        if ch.isalnum() or ch in "-_":
            result += ch
        else:
            if result and result[-1] != "-":
                result += "-"
    return result.strip("-") or "concept"
