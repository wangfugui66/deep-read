"""Knowledge Animation service — LLM-powered HyperFrames HTML generator.

Reads raw chapter .md files, calls DeepSeek to generate a self-contained
GSAP-powered single-file HTML knowledge animation, and caches it under
data/plugins/animation_cache/ as a backup/debug log (the canonical output
is returned directly in the API response as JSON { html } ).

Architecture discipline:
  - Read-only on raw chapter files — never modifies existing data.
  - Strict BYOK: only uses the api_key passed via request header; never
    falls back to DEEPSEEK_API_KEY env var.
  - Output is returned in JSON — no secondary HTTP round-trip required.
"""

import hashlib
import logging
import os
import re
from pathlib import Path

from app.core.config import DATA_ROOT

logger = logging.getLogger("deepread.animation")

# ── Cache directory (backup / debug only) ──
PLUGINS_ROOT = DATA_ROOT / "plugins" / "animation_cache"

# ── Prompt (read once at module load) ──
_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "knowledge_animation.md"
_ANIMATION_SYSTEM_PROMPT: str | None = None


def _load_prompt() -> str:
    global _ANIMATION_SYSTEM_PROMPT
    if _ANIMATION_SYSTEM_PROMPT is not None:
        return _ANIMATION_SYSTEM_PROMPT
    if _PROMPT_PATH.is_file():
        _ANIMATION_SYSTEM_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8").strip()
        logger.info("Animation prompt loaded: %d chars", len(_ANIMATION_SYSTEM_PROMPT))
    else:
        logger.warning("Animation prompt file not found at %s — using fallback", _PROMPT_PATH)
        _ANIMATION_SYSTEM_PROMPT = "You are a HyperFrames animation engineer. Output raw HTML only."
    return _ANIMATION_SYSTEM_PROMPT


def _cache_dir(book_name: str) -> Path:
    d = PLUGINS_ROOT / book_name
    d.mkdir(parents=True, exist_ok=True)
    return d


def _cache_key(book_name: str, chapter_paths: list[str]) -> str:
    """Deterministic filename hash from book + sorted chapter paths."""
    payload = book_name + "::" + ",".join(sorted(chapter_paths))
    return hashlib.sha256(payload.encode()).hexdigest()[:12] + ".html"


def _strip_markdown_fences(text: str) -> str:
    """Robustly remove ```html ... ``` fences that LLMs often wrap around output.

    Handles: ```html, ```HTML, ```, leading/trailing whitespace, and multiple
    fence variants in a single pass.
    """
    t = text.strip()
    t = re.sub(r"^```(?:html|HTML|htm|HTM)?\s*\n?", "", t)
    t = re.sub(r"\n?```\s*$", "", t)
    return t.strip()


# ── Core generator ──
async def generate_animation(
    book_name: str,
    chapter_paths: list[str],
    *,
    api_key: str = "",
) -> dict:
    """Generate a single-file HyperFrames HTML knowledge animation.

    Args:
        book_name: book directory name under data/raw/sources/.
        chapter_paths: list of relative chapter file paths.
        api_key: DeepSeek API key from request header (required; strict BYOK).

    Returns:
        {"status": "ok", "html": "<!DOCTYPE html>..."}
        or {"status": "error", "message": "..."}
    """
    if not chapter_paths:
        return {"status": "error", "message": "chapter_paths must not be empty"}

    # ── Strict BYOK: never fall back to env var ──
    if not api_key:
        return {"status": "error", "message": "API key is required — please configure it in Settings"}

    # 1. Read full chapter texts from raw sources
    raw_dir = DATA_ROOT / "raw" / "sources" / book_name
    if not raw_dir.is_dir():
        return {"status": "error", "message": f"Book directory not found: {raw_dir}"}

    parts: list[str] = []
    missing: list[str] = []
    for p in chapter_paths:
        chapter_file = raw_dir / p
        if not chapter_file.is_file():
            missing.append(p)
            continue
        text = chapter_file.read_text(encoding="utf-8").strip()
        if not text:
            missing.append(p)
            continue
        parts.append(f"## 章节: {p}\n\n{text}")

    if not parts:
        return {
            "status": "error",
            "message": f"No readable chapter files found (missing: {missing})",
        }

    context_text = "\n\n---\n\n".join(parts)
    logger.info("Animation context: %d chapters, %d chars total", len(parts), len(context_text))

    # 2. LLM call
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    )

    system_prompt = _load_prompt()

    try:
        logger.info("Animation LLM call: %d chapters", len(parts))
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"请基于以下阅读文本生成知识动画：\n\n{context_text[:12000]}"},
            ],
            temperature=0.6,
            max_tokens=8192,
        )
        raw_output = response.choices[0].message.content or ""
    except Exception as exc:
        logger.exception("Animation LLM call failed")
        return {"status": "error", "message": f"LLM call failed: {exc}"}

    # 3. Strip markdown fences and validate
    html = _strip_markdown_fences(raw_output)

    if not html.strip().startswith("<"):
        logger.warning("LLM output does not start with '<' — possible misformat. First 200 chars: %s", html[:200])
        return {
            "status": "error",
            "message": "LLM output does not appear to be HTML — may be truncated or misformatted. Please retry.",
        }

    # 4. Cache as backup / debug log (non-blocking — failure is non-fatal)
    try:
        cache_dir = _cache_dir(book_name)
        file_name = _cache_key(book_name, chapter_paths)
        cache_path = cache_dir / file_name
        cache_path.write_text(html, encoding="utf-8")
        logger.info("Animation cached: %s (%d bytes)", cache_path, len(html))
    except Exception as exc:
        logger.warning("Animation cache write failed (non-fatal): %s", exc)

    return {
        "status": "ok",
        "html": html,
    }
