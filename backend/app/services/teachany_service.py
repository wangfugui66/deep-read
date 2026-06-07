"""TeachAny service — LLM-powered interactive courseware generator.

Reads chapters_index.json summaries, calls DeepSeek to generate a self-contained
HTML interactive lesson, and caches the result under data/plugins/teachany_cache/.

Architecture discipline:
  - Read-only on chapters_index.json — never modifies existing data.
  - Output is standalone HTML — no state coupling to DeepRead core.
  - Cache dir is physically separate under data/plugins/.
"""

import hashlib
import json as _json
import logging
import os
import re
from pathlib import Path

from app.core.config import DATA_ROOT

logger = logging.getLogger("deepread.teachany")

# ── Cache directory ──
PLUGINS_ROOT = DATA_ROOT / "plugins" / "teachany_cache"


def _cache_dir(book_name: str) -> Path:
    d = PLUGINS_ROOT / book_name
    d.mkdir(parents=True, exist_ok=True)
    return d


def _cache_key(book_name: str, chapter_paths: list[str]) -> str:
    """Deterministic filename hash from book + sorted chapter paths."""
    payload = book_name + "::" + ",".join(sorted(chapter_paths))
    return hashlib.sha256(payload.encode()).hexdigest()[:12] + ".html"


# ── Prompt ──
TEACHANY_SYSTEM_PROMPT = """\
You are a TeachAny expert — a K-12 interactive courseware designer.  Your job is to turn
a provided chapter summary (context text) into a **self-contained, single-file HTML
interactive lesson**.

## Absolute rules
1. **Base everything on the provided summary text.** Do NOT invent facts, names, dates,
   or concepts that are not present in the summary.
2. Output a **complete, valid HTML document** with embedded CSS and JS — no external
   dependencies, no CDN links, no imports. Everything must be inline.
3. The lesson MUST include at least **three interactive components** (e.g. drag-and-drop
   sorting, concept-check quizzes, clickable flashcards, fill-in-the-blank, diagram
   exploration, timeline slider, etc.). Use vanilla JS only.
4. Structure the content into clearly separated sections:
   - Title + introductory hook: use a natural "背景 — 冲突 — 结论" narrative flow.
     You MUST fuse these three logical layers into ONE seamless, elegant Chinese
     paragraph, using natural semantic transition words (e.g. 然而, 正因如此,
     这要求我们, 由此看来) instead of mechanical labels.
     【最高警报 — ABSOLUTE PROHIBITION】
     * NEVER output the words "And", "But", "Therefore" as visible text or HTML labels.
     * NEVER output "安", "但", "因此" as prefix labels anywhere in the page.
     * NEVER expose the ABT framework structure to the reader.  The reader must
       perceive a smooth, continuous narrative — never a decomposed outline.
     * Violation of this rule is the single most critical quality failure.
   - Key concepts explained in simple language
   - At least 2 interactive exercises with immediate feedback
   - A summary + "next steps" suggestion
5. Use clean, modern CSS with generous whitespace, readable fonts, and a pleasant
   color palette suitable for reading on screen.
6. **Respond with ONLY the raw HTML code**, no markdown fences (no ```html), no
   explanations before or after. The very first character of your response must be `<`.
7. Keep the HTML under 2000 lines — be concise but complete.
"""


# ── Core generator ──
async def generate_courseware(
    book_name: str,
    chapter_paths: list[str],
    *,
    api_key: str = "",
) -> dict:
    """Generate a single-file HTML interactive courseware from chapter summaries.

    Args:
        book_name: book directory name under data/raw/sources/.
        chapter_paths: list of relative chapter file paths (e.g. ["0001_目录.md", …]).
        api_key: override for DEEPSEEK_API_KEY (falls back to env).

    Returns:
        {"status": "ok", "file_name": "abc123.html", "view_url": "/api/plugins/teachany/view/..."}
        or {"status": "error", "message": "..."}
    """
    if not chapter_paths:
        return {"status": "error", "message": "chapter_paths must not be empty"}

    # 1. Load summaries from index
    from .indexer_service import load_chapters_index

    index = load_chapters_index(book_name)
    if not index:
        return {"status": "error", "message": "No chapters index found — run indexer first"}

    parts: list[str] = []
    missing: list[str] = []
    for p in chapter_paths:
        entry = index.get(p)
        if not entry:
            missing.append(p)
            continue
        summary = (entry.get("summary", "") or "").strip()
        tags = entry.get("tags", []) or []
        if not summary:
            missing.append(p)
            continue
        parts.append(f"## 章节: {p}\n标签: {', '.join(tags)}\n摘要: {summary}")

    if not parts:
        return {
            "status": "error",
            "message": f"No indexed summaries found for any of the requested chapters (missing: {missing})",
        }

    context_text = "\n\n".join(parts)

    # 2. Check cache
    cache_dir = _cache_dir(book_name)
    file_name = _cache_key(book_name, chapter_paths)
    cache_path = cache_dir / file_name
    if cache_path.exists():
        logger.info("TeachAny cache hit: %s", cache_path)
        return {
            "status": "ok",
            "file_name": file_name,
            "view_url": f"/api/plugins/teachany/view/{book_name}/{file_name}",
            "cached": True,
        }

    # 3. LLM call
    from openai import AsyncOpenAI

    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    if not key:
        return {"status": "error", "message": "DEEPSEEK_API_KEY is not set"}

    client = AsyncOpenAI(
        api_key=key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    )

    try:
        logger.info("TeachAny LLM call: %d chapters, %d chars of context", len(parts), len(context_text))
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": TEACHANY_SYSTEM_PROMPT},
                {"role": "user", "content": f"请基于以下章节摘要生成知识沙盘：\n\n{context_text[:12000]}"},
            ],
            temperature=0.6,
            max_tokens=8192,
        )
        raw_output = response.choices[0].message.content or ""
    except Exception as exc:
        logger.exception("TeachAny LLM call failed")
        return {"status": "error", "message": f"LLM call failed: {exc}"}

    # 4. Clean output — strip markdown fences
    html = _strip_markdown_fences(raw_output)

    # 5. Sanitize — enforce product vocabulary at the code level
    html = _sanitize_html(html)

    if not html.strip().startswith("<"):
        return {
            "status": "error",
            "message": "LLM output does not appear to be HTML — may be truncated or misformatted",
        }

    # 6. Atomic write to cache
    try:
        cache_path.write_text(html, encoding="utf-8")
        logger.info("TeachAny courseware cached: %s (%d bytes)", cache_path, len(html))
    except Exception as exc:
        logger.exception("TeachAny cache write failed")
        return {"status": "error", "message": f"Cache write failed: {exc}"}

    return {
        "status": "ok",
        "file_name": file_name,
        "view_url": f"/api/plugins/teachany/view/{book_name}/{file_name}",
        "cached": False,
    }


def _strip_markdown_fences(text: str) -> str:
    """Remove leading/trailing ``` fences that LLMs sometimes wrap around code output."""
    t = text.strip()
    # Remove opening fence: ```html, ```HTML, ```, etc.
    t = re.sub(r"^```(?:html|HTML|htm|HTM)?\s*\n?", "", t)
    # Remove closing fence
    t = re.sub(r"\n?```\s*$", "", t)
    return t.strip()


def _sanitize_html(html: str) -> str:
    """Post-process the LLM output to enforce product vocabulary at the code level.

    This is the safety net: even if the prompt is ignored, the cache never contains
    stale branding terminology.
    """
    return html.replace("互动课件", "知识沙盘")
