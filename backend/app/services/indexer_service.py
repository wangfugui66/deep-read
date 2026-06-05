"""Indexer service — async background chapter summarization via LLM.

Uses a concurrency-limited asyncio.gather pool to avoid API rate limits.
Writes results to data/wiki/<book_name>/chapters_index.json.
"""

import json as _json
import logging
import os
import re
from pathlib import Path

logger = logging.getLogger("deepread.indexer")

# ── DATA_ROOT: go up 4 dirs from app/services/indexer_service.py → project root, then data/ ──
DATA_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "data"

# ====================================================================
# Helpers
# ====================================================================

def _make_client(api_key: str = ""):
    from openai import AsyncOpenAI

    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    if not key:
        raise RuntimeError(
            "DEEPSEEK_API_KEY is not set. "
            "Please set it in your environment or .env file."
        )
    return AsyncOpenAI(
        api_key=key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    )


def _index_path(book_name: str) -> Path:
    wiki_dir = DATA_ROOT / "wiki" / book_name
    wiki_dir.mkdir(parents=True, exist_ok=True)
    return wiki_dir / "chapters_index.json"


def _raw_dir(book_name: str) -> Path | None:
    d = DATA_ROOT / "raw" / "sources" / book_name
    return d if d.is_dir() else None


def _meta_path(book_name: str) -> Path:
    wiki_dir = DATA_ROOT / "wiki" / book_name
    wiki_dir.mkdir(parents=True, exist_ok=True)
    return wiki_dir / ".meta.json"


def _read_meta(book_name: str) -> dict:
    """Read .meta.json, return empty dict if missing or corrupt."""
    path = _meta_path(book_name)
    if not path.is_file():
        return {}
    try:
        return _json.loads(path.read_text(encoding="utf-8"))
    except (_json.JSONDecodeError, ValueError):
        return {}


def _write_meta(book_name: str, data: dict) -> None:
    """Persist .meta.json atomically."""
    path = _meta_path(book_name)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(_json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _update_progress(book_name: str, indexed: int, total: int, status: str) -> None:
    """Read .meta.json, update indexing progress fields, write back."""
    meta = _read_meta(book_name)
    meta["indexing_status"] = status
    meta["indexed_chapters"] = indexed
    meta["total_chapters"] = total
    _write_meta(book_name, meta)


# ====================================================================
# Load / save chapters_index.json
# ====================================================================

def load_chapters_index(book_name: str) -> dict:
    """Return {chapter_path: {summary, tags, is_indexed}, ...} or empty dict."""
    path = _index_path(book_name)
    if not path.is_file():
        return {}
    try:
        data = _json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (_json.JSONDecodeError, ValueError):
        pass
    return {}


def save_chapters_index(book_name: str, data: dict) -> None:
    """Persist the full chapters_index.json atomically."""
    path = _index_path(book_name)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        _json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(path)


# ====================================================================
# LLM summarizer — single chapter
# ====================================================================

_PROMPT = """请用50字提取以下文本的核心知识点，并给出3个标签（标签用逗号分隔）。

输出格式（严格遵守，不要加任何额外说明）：
{
  "summary": "50字以内的中文摘要",
  "tags": ["标签1", "标签2", "标签3"]
}

文本：
"""


async def _summarize_one_chapter(client, chapter_path: str, content: str) -> dict | None:
    """Call LLM to generate summary + tags for a single chapter.

    Returns: {"summary": str, "tags": list[str]} or None on failure.
    """
    # Truncate content to avoid oversized prompts (max ~4000 chars)
    snippet = content.strip()[:4000]

    try:
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是一个知识提取助手，输出严格JSON。"},
                {"role": "user", "content": _PROMPT + snippet},
            ],
            temperature=0.1,
            max_tokens=256,
            stream=False,
        )
        raw = response.choices[0].message.content or ""

        # Try to extract JSON from possible markdown fences
        raw = raw.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*\n?", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\n?\s*```\s*$", "", raw)

        result = _json.loads(raw)
        summary = str(result.get("summary", ""))[:60]
        tags = result.get("tags", [])
        if isinstance(tags, list):
            tags = [str(t)[:20] for t in tags[:3]]
        else:
            tags = []

        return {"summary": summary, "tags": tags}
    except Exception:
        return None


# ====================================================================
# Main entry point — build index for a whole book
# ====================================================================

async def build_book_index(book_name: str, api_key: str = "") -> None:
    """Background task: summarize all unindexed chapters via async LLM pool.

    Concurrency capped at 5. Per-chapter progress written to .meta.json in real time
    so the frontend polling endpoint can expose indexed_chapters / total_chapters.

    Args:
        book_name: Safe title slug from document processor.
        api_key:  User's DeepSeek API key (from x-api-key request header).
                  Falls back to DEEPSEEK_API_KEY env var.
    """
    logger.info("🚀 开始为书籍 %s 构建后台知识索引...", book_name)

    raw = _raw_dir(book_name)
    if not raw:
        logger.warning("Indexer: raw dir not found for %s", book_name)
        return

    # Collect all chapter files
    md_files = sorted(
        [f for f in raw.rglob("*.md") if f.is_file() and f.stem != raw.name],
        key=lambda f: f.name,
    )
    if not md_files:
        logger.info("Indexer: no chapters found for %s", book_name)
        _write_meta(book_name, {**_read_meta(book_name), "indexing_status": "completed"})
        logger.info("✅ 书籍 %s 知识索引构建完成！（无章节）", book_name)
        return

    total = len(md_files)

    # Load existing index to skip already-indexed chapters
    existing = load_chapters_index(book_name)

    # ── Create LLM client (may fail if DEEPSEEK_API_KEY is not set) ──
    try:
        client = _make_client(api_key)
    except Exception as e:
        logger.error("❌ 无法创建 LLM 客户端: %s。索引任务终止。", str(e))
        _update_progress(book_name, total, total, "failed")
        return

    sem = __import__("asyncio").Semaphore(5)

    async def _index_one(path: str, content: str) -> tuple[str, dict | None]:
        async with sem:
            try:
                result = await _summarize_one_chapter(client, path, content)
                return path, result
            except Exception as e:
                logger.error("❌ 章节 %s 索引失败: %s", path, str(e))
                return path, None

    tasks = []
    for f in md_files:
        rel = str(f.relative_to(raw)).replace("\\", "/")
        if existing.get(rel, {}).get("is_indexed"):
            continue  # already done
        try:
            content = f.read_text(encoding="utf-8")[:4000]
        except Exception:
            logger.exception("Indexer: failed to read %s", rel)
            existing[rel] = {"summary": "", "tags": [], "is_indexed": True}
            save_chapters_index(book_name, existing)
            continue
        tasks.append(_index_one(rel, content))

    # Set initial progress
    already_indexed = sum(1 for v in existing.values() if v.get("is_indexed"))
    _update_progress(book_name, already_indexed, total, "processing")

    if not tasks:
        logger.info("Indexer: all chapters already indexed for %s", book_name)
        _update_progress(book_name, total, total, "completed")
        logger.info("✅ 书籍 %s 知识索引构建完成！（全部已索引）", book_name)
        return

    # ── Run tasks with as_completed for real-time progress ──
    import asyncio as _asyncio
    indexed = already_indexed
    for coro in _asyncio.as_completed(tasks):
        try:
            path, result = await coro
        except Exception as exc:
            logger.error("❌ 索引任务崩溃: %s", str(exc))
            indexed += 1
            _update_progress(book_name, indexed, total, "processing")
            continue

        indexed += 1
        if result is not None:
            existing[path] = {
                "summary": result.get("summary", ""),
                "tags": result.get("tags", []),
                "is_indexed": True,
            }
            logger.info("  📝 [%d/%d] %s → %s", indexed, total, path, result.get("summary", "")[:30])
        else:
            existing[path] = {"summary": "", "tags": [], "is_indexed": True}
            logger.warning("  ⚠️ [%d/%d] %s → 空结果 (LLM 返回不可解析)", indexed, total, path)

        # Flush per-chapter progress + index to disk
        _update_progress(book_name, indexed, total, "processing")
        try:
            save_chapters_index(book_name, existing)
        except Exception:
            pass  # will save at the end anyway

    # Finalize
    try:
        save_chapters_index(book_name, existing)
        logger.info("Indexer: saved chapters_index.json for %s (%d chapters)", book_name, len(existing))
    except Exception:
        logger.exception("Indexer: failed to save chapters_index.json for %s", book_name)

    _update_progress(book_name, total, total, "completed")
    logger.info("✅ 书籍 %s 知识索引构建完成！", book_name)
