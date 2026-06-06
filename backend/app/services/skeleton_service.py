"""Skeleton service — dynamic learning path generation (Architect Agent).

Reads .profile.json + chapter list from data/raw/sources/<book>/,
generates a personalized JSON TOC and writes to data/wiki/{book_name}/dynamic_toc.json.
"""

import json as _json
import os
import re
from pathlib import Path

from app.core.config import DATA_ROOT
from app.utils.file_ops import atomic_write_json
from .indexer_service import load_chapters_index

# ====================================================================
# Robust LLM JSON extractor — handles markdown fences, stray text, etc.
# ====================================================================

def extract_and_parse_json(llm_response: str):
    """Robust JSON extractor with syntax error recovery (trailing commas, etc.).

    Returns:
        Parsed dict or list.

    Raises:
        ValueError if no parseable JSON found — includes the raw LLM response.
    """
    import re as _re
    import json as _json_local

    # 1. Force-print raw LLM response for backend debugging
    print("\n" + "=" * 50, flush=True)
    print("🔥🔥🔥 收到大模型的原始回复 🔥🔥🔥", flush=True)
    print(llm_response, flush=True)
    print("=" * 50 + "\n", flush=True)

    if not llm_response or not llm_response.strip():
        raise ValueError("大模型返回了空字符串，可能是触发了 API 限制。")

    text = llm_response.strip()

    # 2. Strip markdown code block fences
    text = _re.sub(r'^```(?:json)?\s*\n?', '', text, flags=_re.IGNORECASE)
    text = _re.sub(r'\n?\s*```\s*$', '', text)
    text = text.strip()

    # 3. Auto-fix common JSON syntax errors
    # Fix trailing commas before }  —  the #1 LLM JSON mistake
    text = _re.sub(r',\s*}', '}', text)
    text = _re.sub(r',\s*]', ']', text)

    # 4. Try direct parse
    first_error: str = ""
    try:
        return _json_local.loads(text)
    except _json_local.JSONDecodeError as _e:
        first_error = str(_e)

    # 5. Regex: find outermost { ... } (object) or [ ... ] (array)
    match = _re.search(r'\{.*\}', text, _re.DOTALL)
    if match:
        try:
            candidate = match.group(0)
            # Re-apply trailing comma fix on the extracted candidate
            candidate = _re.sub(r',\s*}', '}', candidate)
            candidate = _re.sub(r',\s*]', ']', candidate)
            return _json_local.loads(candidate)
        except _json_local.JSONDecodeError as _e:
            raise ValueError(
                f"JSON语法错误! 第一次解析: {first_error}。"
                f"正则提取后仍失败: {_e}。"
                f"提取到的JSON片段前200字: {candidate[:200]}..."
            )

    match = _re.search(r'\[.*\]', text, _re.DOTALL)
    if match:
        try:
            candidate = match.group(0)
            candidate = _re.sub(r',\s*}', '}', candidate)
            candidate = _re.sub(r',\s*]', ']', candidate)
            return _json_local.loads(candidate)
        except _json_local.JSONDecodeError as _e:
            raise ValueError(
                f"JSON语法错误! 第一次解析: {first_error}。"
                f"正则提取数组后仍失败: {_e}。"
                f"提取到的JSON片段前200字: {candidate[:200]}..."
            )

    raise ValueError(
        f"完全找不到 JSON 结构。首次解析错误: {first_error}。"
        f"原始返回前200字: {llm_response[:200]}..."
    )


def _make_client(api_key: str = ""):
    from openai import AsyncOpenAI
    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    if not key:
        raise RuntimeError(
            "DEEPSEEK_API_KEY is not set. "
            "Please set it in your environment or .env file. "
            "Get your key at https://platform.deepseek.com"
        )
    return AsyncOpenAI(
        api_key=key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    )


def _resolve_wiki(book_name: str, data_root: str | None = None) -> Path:
    if data_root is None:
        data_root = DATA_ROOT
    wiki_dir = Path(data_root) / "wiki" / book_name
    wiki_dir.mkdir(parents=True, exist_ok=True)
    return wiki_dir


def _resolve_raw(book_name: str, data_root: str | None = None) -> Path | None:
    """Return the raw sources directory for a book."""
    if data_root is None:
        data_root = DATA_ROOT
    raw_dir = Path(data_root) / "raw" / "sources" / book_name
    if not raw_dir.is_dir():
        return None
    return raw_dir


def _collect_chapters(raw_dir: Path) -> list[dict]:
    """Collect chapter list: file_path + title + word_count from raw MD files."""
    chapters = []
    for f in sorted(raw_dir.rglob("*.md"), key=lambda f: f.name):
        if f.name.startswith("."):
            continue
        text = f.read_text(encoding="utf-8")
        title = f.stem
        if text.startswith("---"):
            parts = text.split("---", 2)
            if len(parts) >= 3:
                for line in parts[1].split("\n"):
                    if line.startswith("title:"):
                        title = line.split(":", 1)[1].strip().strip('"').strip("'") or title
                        break
        word_count = len(text.replace(" ", "").replace("\n", ""))
        chapters.append({
            "file": str(f.relative_to(raw_dir)),
            "title": title,
            "word_count": word_count,
        })
    return chapters


def _build_profile_context(profile: dict) -> str:
    """Build a human-readable profile summary for the prompt."""
    parts = []
    diagnosis = profile.get("diagnosis", "")
    if diagnosis:
        parts.append(f"- 诊断: {diagnosis}")
    gaps = profile.get("cognitive_gaps", [])
    if gaps:
        parts.append(f"- 认知缺口: {', '.join(gaps)}")
    pref = profile.get("learning_preference", "")
    if pref:
        pf_label = "先懂理论再看案例" if pref == "theory_first" else "先看案例再总结理论"
        parts.append(f"- 学习偏好: {pf_label}")
    minutes = profile.get("time_budget_minutes", 0)
    if minutes:
        parts.append(f"- 时间预算: {minutes} 分钟")
    diff = profile.get("difficulty_hint", "")
    if diff:
        parts.append(f"- 难度推定: {diff}")
    mode = profile.get("reading_mode", "")
    if mode:
        parts.append(f"- 阅读模式: {'强攻型' if mode == 'ATTACK' else '漫游型'}")
    return "\n".join(parts) if parts else "无用户画像（首次使用）"


async def generate_skeleton(
    book_name: str,
    *,
    data_root: str | None = None,
    api_key: str = "",
) -> dict:
    """Generate a personalized dynamic TOC as a JSON array.

    Returns:
        {"status": "completed", "path": str, "toc_items": list[dict]}
        or {"status": "failed", "error": str}
    """
    raw_dir = _resolve_raw(book_name, data_root)
    wiki_dir = _resolve_wiki(book_name, data_root)

    # Read profile
    profile_path = wiki_dir / ".profile.json"
    if not profile_path.exists():
        return {"status": "failed", "error": "Profile not found. Run profile extraction first."}

    profile = _json.loads(profile_path.read_text(encoding="utf-8"))
    profile_context = _build_profile_context(profile)

    # Collect chapter list
    if not raw_dir:
        return {"status": "failed", "error": f"Book raw sources not found for: {book_name}"}

    chapters = _collect_chapters(raw_dir)
    if not chapters:
        return {"status": "failed", "error": "No chapters found in raw sources."}

    # Build enriched chapter list string for prompt — inject summary + tags from index
    index_data = load_chapters_index(book_name)
    chapter_lines = []
    for i, ch in enumerate(chapters, 1):
        rel_path = ch["file"]
        idx = index_data.get(rel_path, {})
        summary = idx.get("summary", "")
        tags = idx.get("tags", [])
        tags_str = ", ".join(tags) if tags else "(未索引)"
        summary_str = summary if summary else "(未索引)"
        chapter_lines.append(
            f"[{i}] 标题: {ch['title']} | 路径: {rel_path} | 字数: {ch['word_count']}字 | 标签: {tags_str} | 摘要: {summary_str}"
        )
    chapter_list = "\n".join(chapter_lines)

    # Compute Task 4 word budget: daily_minutes * planned_days * 500
    daily_minutes = profile.get("daily_minutes", 30)
    planned_days = profile.get("planned_days", 7)
    total_word_budget = daily_minutes * planned_days * 500

    # Load prompt
    from .prompts import ARCHITECT_TOC_PROMPT
    system_prompt = ARCHITECT_TOC_PROMPT.format(
        profile_context=profile_context,
        chapter_list=chapter_list,
        daily_minutes=daily_minutes,
        planned_days=planned_days,
        total_word_budget=total_word_budget,
    )

    user_prompt = "请根据以上信息生成个性化学习路径 JSON。"
    total_prompt_len = len(system_prompt) + len(user_prompt)
    print(f"🔥🔥🔥 准备发送的 Prompt 总长度: {total_prompt_len} 字符 (system={len(system_prompt)}, user={len(user_prompt)})",
          flush=True)

    if total_prompt_len > 30000:
        return {"status": "failed", "error": f"Prompt过长({total_prompt_len}字符)，请减少章节数量或缩短标题。"}

    try:
        client = _make_client(api_key)
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=8192,
            stream=False,
        )
        raw_output = response.choices[0].message.content or ""

        # Parse JSON robustly (handles markdown fences, stray text, etc.)
        toc_data = extract_and_parse_json(raw_output)

        if not isinstance(toc_data, dict):
            raise ValueError("Expected JSON object, got: " + type(toc_data).__name__)

        # Validate: ensure file_path exists in chapters
        valid_files = {ch["file"] for ch in chapters}

        def _validate_chapter(item: dict) -> dict:
            """Check file_path validity and fill missing fields."""
            fp = item.get("file_path", "")
            valid = fp in valid_files
            return {
                "file_path": fp,
                "original_title": item.get("original_title", ""),
                "strategy": item.get("strategy", "选读"),
                "advice": item.get("advice", ""),
                "_valid": valid,
            }

        # Validate modules
        validated_modules = []
        for mod in toc_data.get("modules", []):
            validated_chs = [_validate_chapter(ch) for ch in mod.get("chapters", [])]
            validated_modules.append({
                "module_name": mod.get("module_name", "未命名模块"),
                "chapters": validated_chs,
            })

        # Validate archived
        validated_archived = [
            _validate_chapter(ch) for ch in toc_data.get("archived_chapters", [])
        ]

        result_data = {
            "theme": toc_data.get("theme", ""),
            "modules": validated_modules,
            "archived_chapters": validated_archived,
        }

        # ── Post-processing: hard gate — short chapters can never be 精读 ──
        # Build word_count lookup from the chapter list we already collected
        wc_map = {ch["file"]: ch["word_count"] for ch in chapters}

        def _enforce_min_content(ch_item: dict) -> None:
            """Mutate in place: if strategy=精读 but content < 300 chars, demote to 略读."""
            if ch_item.get("strategy", "") == "精读":
                fp = ch_item.get("file_path", "")
                wc = wc_map.get(fp, 9999)  # if unknown, assume large enough
                if wc < 300:
                    ch_item["strategy"] = "略读"
                    ch_item["advice"] = "篇章结构，无实质内容"

        for mod in result_data["modules"]:
            for ch in mod["chapters"]:
                _enforce_min_content(ch)
        for ch in result_data["archived_chapters"]:
            _enforce_min_content(ch)

        # Write to file
        toc_path = wiki_dir / "dynamic_toc.json"
        atomic_write_json(toc_path, result_data)

        return {
            "status": "completed",
            "path": str(toc_path),
            "toc_data": result_data,
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


def read_skeleton(book_name: str, *, data_root: str | None = None) -> dict | None:
    """Read dynamic_toc.json. Returns dict with modules/archived or None."""
    wiki_dir = _resolve_wiki(book_name, data_root)
    toc_path = wiki_dir / "dynamic_toc.json"
    if not toc_path.exists():
        return None
    return _json.loads(toc_path.read_text(encoding="utf-8"))


def read_skeleton_text(book_name: str, *, data_root: str | None = None) -> str | None:
    """Read dynamic_toc.json as formatted text. Returns None if not found."""
    items = read_skeleton(book_name, data_root=data_root)
    if items is None:
        return None
    return _json.dumps(items, ensure_ascii=False, indent=2)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
