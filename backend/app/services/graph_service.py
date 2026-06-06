"""Graph service — LLM-powered global knowledge graph builder.

Reads chapters_index.json summaries + tags, distills them into a compact context,
calls DeepSeek to extract semantic nodes and edges, writes graph.json atomically.
"""

import json as _json
import os
import random as _random
from pathlib import Path as _Path

from app.utils.file_ops import atomic_write_json
from app.core.config import DATA_ROOT

# ── Color palette by type (mirrors KnowledgeGraphViewer.tsx) ──

TYPE_COLORS: dict[str, str] = {
    "concept": "#3b82f6",
    "term":    "#8b5cf6",
    "person":  "#f59e0b",
    "event":   "#ef4444",
}


# ====================================================================
# Build compact context from chapters_index.json
# ====================================================================

def _build_graph_context(book_name: str, data_root: _Path) -> str:
    """Extract tags + summaries from chapters_index.json into a compact LLM context."""
    from .indexer_service import load_chapters_index

    index = load_chapters_index(book_name)
    if not index:
        return ""

    lines: list[str] = []
    for i, (path, entry) in enumerate(sorted(index.items()), 1):
        summary = (entry.get("summary", "") or "").strip()
        tags = entry.get("tags", []) or []
        if not summary and not tags:
            continue
        tags_str = ", ".join(tags)
        lines.append(f"[{i}] {path}\n标签: {tags_str}\n摘要: {summary}")

    return "\n\n".join(lines)


# ====================================================================
# Main entry point
# ====================================================================

async def build_global_knowledge_graph(
    book_name: str,
    *,
    data_root: _Path | None = None,
    api_key: str = "",
) -> dict:
    """Build a semantic knowledge graph from indexed chapter summaries via LLM.

    Returns:
        {"status": "ok", "nodes": N, "edges": M}
        or {"status": "error", "message": "..."}
    """
    if data_root is None:
        data_root = DATA_ROOT

    wiki_dir = data_root / "wiki" / book_name
    wiki_dir.mkdir(parents=True, exist_ok=True)
    graph_file = wiki_dir / "graph.json"

    # 1. Build compact context
    context = _build_graph_context(book_name, data_root)
    if not context:
        return {"status": "error", "message": "No indexed chapters found — run indexer first"}

    # 2. LLM call
    from openai import AsyncOpenAI
    from .prompts import GRAPH_BUILDER_PROMPT

    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    if not key:
        return {"status": "error", "message": "DEEPSEEK_API_KEY is not set"}

    client = AsyncOpenAI(
        api_key=key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    )

    try:
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": GRAPH_BUILDER_PROMPT},
                {"role": "user", "content": f"## 全书章节摘要与标签\n\n{context[:14000]}"},
            ],
            temperature=0.3,
            max_tokens=8192,
        )
        raw_output = response.choices[0].message.content or ""
    except Exception as exc:
        return {"status": "error", "message": f"LLM call failed: {exc}"}

    # 3. Parse JSON (reuse the robust extractor from skeleton_service)
    try:
        from .skeleton_service import extract_and_parse_json
        graph_data = extract_and_parse_json(raw_output)
    except ValueError as exc:
        return {"status": "error", "message": f"JSON parse failed: {exc}"}

    if not isinstance(graph_data, dict):
        return {"status": "error", "message": f"Expected JSON object, got {type(graph_data).__name__}"}

    nodes_raw = graph_data.get("nodes", [])
    edges_raw = graph_data.get("edges", [])

    # 4. Post-process: assign deterministic positions + colors
    rng = _random.Random(42)
    nodes: list[dict] = []
    for node in nodes_raw:
        node.setdefault("x", 200 + rng.randint(0, 600))
        node.setdefault("y", 150 + rng.randint(0, 400))
        w = node.get("weight", 10)
        node.setdefault("size", max(4, int(w) // 5))
        node.setdefault("color", TYPE_COLORS.get(node.get("type", ""), "#6b7280"))
        nodes.append(node)

    result: dict = {"nodes": nodes, "edges": edges_raw}
    atomic_write_json(graph_file, result)

    return {"status": "ok", "nodes": len(nodes), "edges": len(edges_raw)}
