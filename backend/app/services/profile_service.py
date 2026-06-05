"""Profile service — hierarchical core_memory + episodic_memory + OpenClaw flush.

Schema v2: { core_memory: { profession, learning_style, cognitive_gaps }, 
             episodic_memory: { chapter_XX: { status, key_struggles, aha_moments } } }
"""

import json as _json
import os
from pathlib import Path
from typing import AsyncGenerator

# ── DATA_ROOT: go up 3 dirs from app/services/ → project root, then data/ ──
DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "data"


# ====================================================================
# Schema migration — old flat profile → hierarchical v2
# ====================================================================

def _ensure_schema(profile: dict) -> dict:
    """Normalize any profile to the hierarchical v2 schema.
    
    Returns a dict that guarantees core_memory, episodic_memory, and schema_version exist.
    """
    profile.setdefault("schema_version", 2)
    profile.setdefault("book_name", "")
    
    if "core_memory" not in profile:
        core = {}
        # Lift old flat fields into core_memory
        for old_key, new_key in [
            ("profession", "profession"),
            ("learning_preference", "learning_style"),
            ("cognitive_gaps", "cognitive_gaps"),
            ("pain_point", "pain_point"),
            ("knowledge_level", "knowledge_level"),
            ("diagnosis_conclusion", "diagnosis"),
            ("diagnosis", "diagnosis"),
            ("difficulty_hint", "difficulty_hint"),
        ]:
            if old_key in profile and new_key not in core:
                core[new_key] = profile[old_key]
        profile["core_memory"] = core
    
    if "episodic_memory" not in profile:
        profile["episodic_memory"] = {}
    
    profile.setdefault("_flush_counter", 0)
    profile.setdefault("_last_flush_at", "")
    
    return profile


def _init_profile(book_name: str, data_root: str | None = None) -> dict:
    """Create a fresh v2 profile skeleton."""
    return {
        "schema_version": 2,
        "book_name": book_name,
        "core_memory": {
            "profession": "",
            "learning_style": "story_first",
            "cognitive_gaps": [],
            "pain_point": "",
            "knowledge_level": "",
            "diagnosis": "",
            "difficulty_hint": "",
        },
        "episodic_memory": {},
        "_flush_counter": 0,
        "_last_flush_at": "",
    }


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


def _load_prompt():
    """Load the Profiler prompt from the shared prompts module."""
    from .prompts import PROFILER_SYSTEM_PROMPT
    return PROFILER_SYSTEM_PROMPT


def _profile_path(book_name: str, data_root: str | None = None) -> Path:
    if data_root is None:
        data_root = DATA_ROOT
    wiki_dir = Path(data_root) / "wiki" / book_name
    wiki_dir.mkdir(parents=True, exist_ok=True)
    return wiki_dir / ".profile.json"


# ── Profile extraction (SSE streaming ice-breaking) ──

async def stream_profile_extraction(
    book_name: str,
    chat_context: list[dict],
    *,
    data_root: str | None = None,
    api_key: str = "",
) -> AsyncGenerator[str, None]:
    from .prompts import PROFILER_SYSTEM_PROMPT

    client = _make_client(api_key)
    system_prompt = _load_prompt()

    messages = [{"role": "system", "content": system_prompt}]
    for msg in chat_context:
        messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})

    full_response = ""
    profile_json = None

    stream = await client.chat.completions.create(
        model="deepseek-chat",
        messages=messages,
        temperature=0.7,
        max_tokens=2000,
        stream=True,
    )

    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta and delta.content:
            full_response += delta.content
            yield f"data: {_json.dumps({'token': delta.content})}\n\n"

    # Extract JSON profile from response
    import re
    json_match = re.search(r'```json\s*\n(.*?)\n```', full_response, re.DOTALL)
    if json_match:
        try:
            profile_json = _json.loads(json_match.group(1).strip())
        except _json.JSONDecodeError:
            pass

    if not json_match:
        json_match = re.search(r'\{[^{}]*"reading_mode"[^{}]*\}', full_response, re.DOTALL)
        if json_match:
            try:
                profile_json = _json.loads(json_match.group(0))
            except _json.JSONDecodeError:
                pass

    if profile_json:
        _save_profile_file(book_name, profile_json, data_root)
        yield f"data: {_json.dumps({'event': 'profile_readiness', 'is_ready': True})}\n\n"

    yield "data: [DONE]\n\n"


# ── Profile file I/O ──

def _save_profile_file(book_name: str, profile: dict, data_root: str | None = None) -> Path:
    path = _profile_path(book_name, data_root)
    path.write_text(_json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def read_profile(book_name: str, *, data_root: str | None = None) -> dict | None:
    path = _profile_path(book_name, data_root)
    if not path.exists():
        return None
    raw = _json.loads(path.read_text(encoding="utf-8"))
    # Auto-migrate flat profiles to v2 hierarchical schema
    migrated = _ensure_schema(raw)
    if migrated != raw:
        _save_profile_file(book_name, migrated, data_root)
    return migrated


def delete_profile(book_name: str, *, data_root: str | None = None) -> bool:
    path = _profile_path(book_name, data_root)
    if path.exists():
        path.unlink()
        return True
    return False


def update_profile_tags(
    book_name: str,
    new_tags: list[str],
    *,
    data_root: str | None = None,
) -> dict:
    profile = read_profile(book_name, data_root=data_root) or {}
    existing = set(profile.get("cognitive_tags", []))
    for tag in new_tags:
        existing.add(tag.strip())
    profile["cognitive_tags"] = sorted(existing)
    _save_profile_file(book_name, profile, data_root)
    return profile


def build_profile_context(book_name: str, *, data_root: str | None = None) -> str:
    profile = read_profile(book_name, data_root=data_root)
    if not profile:
        return "无用户画像（首次使用）"

    core = profile.get("core_memory", {})
    episodic = profile.get("episodic_memory", {})

    parts = []
    diagnosis = core.get("diagnosis", "") or profile.get("diagnosis_conclusion", "")
    if diagnosis:
        parts.append(f"- 诊断: {diagnosis}")
    gaps = core.get("cognitive_gaps", []) or profile.get("cognitive_gaps", [])
    if gaps:
        parts.append(f"- 认知缺口: {', '.join(gaps)}")
    pref = core.get("learning_style", "") or profile.get("learning_preference", "")
    if pref:
        pf_label = "先懂理论再看案例" if pref == "theory_first" else "先看案例再总结理论"
        parts.append(f"- 学习偏好: {pf_label}")
    minutes = profile.get("time_budget_minutes", 0)
    if minutes:
        parts.append(f"- 时间预算: {minutes} 分钟")
    baseline = core.get("knowledge_level", "") or profile.get("knowledge_baseline", "")
    if baseline:
        parts.append(f"- 知识基线: {baseline}")
    profession = core.get("profession", "") or profile.get("profession", "")
    if profession:
        parts.append(f"- 行业背景: {profession}")
    
    # Episodic summary
    chapter_count = len(episodic)
    if chapter_count:
        parts.append(f"- 已读章节: {chapter_count} 章")
    
    return "\n".join(parts) if parts else "无用户画像（首次使用）"


# ====================================================================
# Task 2: Baseline Intake — save profession, knowledge level, pain point
# ====================================================================

def save_baseline_profile(
    book_name: str,
    *,
    profession: str,
    knowledge_level: str,
    pain_point: str,
    daily_minutes: int = 30,
    planned_days: int = 7,
    data_root: str | None = None,
) -> dict:
    """Save the baseline intake form into hierarchical v2 schema."""
    profile = read_profile(book_name, data_root=data_root)
    if not profile:
        profile = _init_profile(book_name, data_root)
    else:
        profile = _ensure_schema(profile)
    
    core = profile.setdefault("core_memory", {})
    core["profession"] = profession
    core["knowledge_level"] = knowledge_level
    core["pain_point"] = pain_point
    profile["daily_minutes"] = daily_minutes
    profile["planned_days"] = planned_days
    _save_profile_file(book_name, profile, data_root)
    return profile


# ====================================================================
# Task 3: Multi-round Socratic converge (stateful single-question)
# ====================================================================

CONVERGE_SINGLE_QUESTION_PROMPT = """你是一个经验丰富、极其敏锐的阅读引导师，像一个和老朋友喝咖啡聊天的思维伙伴。

用户正在准备阅读《{book_name}》。
- 行业/职业: {profession}
- 对本书的熟悉度: {knowledge_level}
- 最初翻开书的动因: {pain_point}

【对话回顾】
{history_context}

请像朋友聊天一样，生成【下一道】极简单选题（A–E），温和地了解用户的阅读方向。

【出题铁律（违背将严重影响系统体验）】
1. **严禁考试感**：题干 ≤2 句话，像随口一问。绝对不要让用户分析复杂机制——那是书里的事。
2. **关注意图而非实现**：问"痛点症状""宏观目标""应用场景"，不追问"你打算怎么实现""参数怎么调"。
3. **选项轻量**：每个选项 ≤20 字，直击要害，不铺垫。
4. **允许模糊**：用户可能还没明确想法，必须提供探索逃逸选项。
5. **态度温和**：不审问、不考验、不评价用户的选择。
6. 当你判断用户阅读方向已基本清晰（通常 3–7 轮），设 is_converged: true 并给出 diagnosis_conclusion。

【选项发散铁律（必须严格遵守）】
4 个导向选项 A/B/C/D 必须覆盖不同的认知维度，绝不能挤在同一个狭窄角度：
- **A** 聚焦**实践落地**（如：如何操作、如何落地到我的场景）
- **B** 聚焦**底层逻辑 / 跨学科启发**（如：寻找全新的思维范式或哲学视角）
- **C** 聚焦**宏观系统观**（如：不看局部细节，想厘清整个系统的演化规律与边界）
- **D** 是**宽泛探索逃逸项**（如：没有特定目的，就是想系统性补全这块知识网；或：我还没想法，看看书里怎么说）
- **E** 永远是"以上都不是，我主要想..."（自由补充）

提问语气像老朋友聊天，不像做问卷调查！

【收敛信号】
- 用户连续 2 轮给出非 E 的具体选项
- 你能用一句话概括用户想从书中获得什么
- 第 10 轮强制收敛

【输出格式 (纯 JSON，禁止 markdown fence)】
{{
  "is_converged": false,
  "diagnosis_conclusion": "",
  "question": "一句轻量的提问",
  "options": {{
    "A": "实践痛点方向（≤20 字）",
    "B": "底层逻辑方向（≤20 字）",
    "C": "宏观系统方向（≤20 字）",
    "D": "宽泛探索：没有具体场景，就是想系统补全这块知识",
    "E": "以上都不是，我主要想..."
  }}
}}

is_converged 为 true 时，diagnosis_conclusion 写入 100 字内诊断。

【强制输出格式】你必须且只能输出一个纯 JSON 对象。绝对不要用 ```json 代码块包裹，绝对不要加任何开场白或解释性文字。输出必须以 {{ 开头、以 }} 结尾。"""


async def converge_next_round(
    book_name: str,
    round_num: int,
    profession: str,
    knowledge_level: str,
    pain_point: str,
    history: list[dict],
    free_text: str = "",
    *,
    api_key: str = "",
) -> dict:
    """Generate the next Socratic question or signal convergence.

    Args:
        book_name: Book slug
        round_num: Current round (1-based)
        profession: User's industry
        knowledge_level: "纯小白" | "零散了解过" | "具备系统性知识" | "资深从业者"
        pain_point: Core pain point
        history: Previous Q&A pairs [{"question": "...", "selected": "A. ..."}, ...]
        free_text: If last round was E, the user's free-text description

    Returns:
        {"is_converged": bool, "diagnosis_conclusion": str, "question": str, "options": dict}
    """
    client = _make_client(api_key)

    # Build history context
    history_lines = []
    for i, h in enumerate(history):
        history_lines.append(f"Round {i+1} — Q: {h['question']}")
        history_lines.append(f"Round {i+1} — A: {h['selected']}")
    if free_text:
        history_lines.append(f"Round {len(history)} — Free text: {free_text}")
    history_context = "\n".join(history_lines) if history_lines else "（尚无历史追问）"

    system_prompt = CONVERGE_SINGLE_QUESTION_PROMPT.format(
        book_name=book_name,
        profession=profession,
        knowledge_level=knowledge_level,
        pain_point=pain_point,
        history_context=history_context,
    )

    # Force convergence at round 10
    force_converge = round_num >= 10
    user_msg = (
        "这是最后一轮，请给出最终诊断并设置 is_converged: true。"
        if force_converge
        else f"请生成第 {round_num} 轮的追问问题。"
    )

    response = await client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.6,
        max_tokens=800,
    )

    raw = response.choices[0].message.content.strip() if response.choices else "{}"

    from .skeleton_service import extract_and_parse_json
    try:
        result = extract_and_parse_json(raw)
    except ValueError:
        # Last resort: force-converge with generic diagnosis
        result = {"is_converged": True, "diagnosis_conclusion": "诊断信号丢失，强制收敛", "question": "", "options": {}}

    # Force converge at round 10
    if round_num >= 10:
        result["is_converged"] = True
        if not result.get("diagnosis_conclusion"):
            result["diagnosis_conclusion"] = f"经过 {len(history)+1} 轮深度追问，用户的核心认知缺口已充分暴露。"

    return result


# ====================================================================
# Task 2+3: Final profile save with convergence history
# ====================================================================

def save_converge_profile(
    book_name: str,
    *,
    profession: str,
    knowledge_level: str,
    pain_point: str,
    learning_preference: str,
    daily_minutes: int,
    planned_days: int,
    diagnosis_conclusion: str,
    cognitive_gaps: list[str],
    difficulty_hint: str,
    convergence_history: list[dict] = None,
    data_root: str | None = None,
) -> dict:
    """Save the complete wizard-collected profile into hierarchical v2 schema."""
    profile = read_profile(book_name, data_root=data_root)
    if not profile:
        profile = _init_profile(book_name, data_root)
    else:
        profile = _ensure_schema(profile)
    
    core = profile.setdefault("core_memory", {})
    core["profession"] = profession
    core["knowledge_level"] = knowledge_level
    core["pain_point"] = pain_point
    core["learning_style"] = learning_preference
    core["diagnosis"] = diagnosis_conclusion
    core["cognitive_gaps"] = cognitive_gaps
    core["difficulty_hint"] = difficulty_hint
    
    # Preserve flat fields for backward compat during transition
    profile["profession"] = profession
    profile["knowledge_level"] = knowledge_level
    profile["pain_point"] = pain_point
    profile["learning_preference"] = learning_preference
    profile["daily_minutes"] = daily_minutes
    profile["planned_days"] = planned_days
    profile["diagnosis_conclusion"] = diagnosis_conclusion
    profile["cognitive_gaps"] = cognitive_gaps
    profile["difficulty_hint"] = difficulty_hint
    profile["convergence_history"] = convergence_history or []
    profile["time_budget_minutes"] = daily_minutes * planned_days
    _save_profile_file(book_name, profile, data_root)
    return profile


# ====================================================================
# OLD: converget_ask / converge_diagnose — kept for backward compat
# ====================================================================

async def converge_ask(
    book_name: str,
    user_input: str,
    *,
    data_root: str | None = None,
    api_key: str = "",
) -> dict:
    from .prompts import CONVERGE_ASK_PROMPT
    client = _make_client(api_key)
    system_prompt = CONVERGE_ASK_PROMPT.format(book_name=book_name, user_input=user_input)
    response = await client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "请生成诊断问题。"},
        ],
        temperature=0.7,
        max_tokens=1024,
    )
    raw = response.choices[0].message.content.strip() if response.choices else ""
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw[:-3]
    questions = _json.loads(raw)
    return {"questions": questions}


async def converge_diagnose(
    book_name: str,
    user_input: str,
    answers: list[dict],
    *,
    data_root: str | None = None,
    api_key: str = "",
) -> dict:
    from .prompts import CONVERGE_DIAGNOSE_PROMPT
    client = _make_client(api_key)
    answers_str = "\n".join(
        f"Q{i+1}: {a['question']}\n用户选择: {a['selected']}" for i, a in enumerate(answers)
    )
    system_prompt = CONVERGE_DIAGNOSE_PROMPT.format(
        book_name=book_name, user_input=user_input, answers=answers_str
    )
    response = await client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "请给出诊断。"},
        ],
        temperature=0.3,
        max_tokens=512,
    )
    raw = response.choices[0].message.content.strip() if response.choices else ""
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw[:-3]
    return _json.loads(raw)


def save_wizard_profile(
    book_name: str,
    profile_data: dict,
    *,
    data_root: str | None = None,
) -> dict:
    profile = read_profile(book_name, data_root=data_root)
    if not profile:
        profile = _init_profile(book_name, data_root)
    else:
        profile = _ensure_schema(profile)
    
    core = profile.setdefault("core_memory", {})
    if profile_data.get("cognitive_gaps"):
        core["cognitive_gaps"] = profile_data["cognitive_gaps"]
    if profile_data.get("learning_preference"):
        core["learning_style"] = profile_data["learning_preference"]
    if profile_data.get("time_budget_minutes"):
        profile["time_budget_minutes"] = profile_data["time_budget_minutes"]
    if profile_data.get("diagnosis"):
        core["diagnosis"] = profile_data["diagnosis"]
    if profile_data.get("difficulty_hint"):
        core["difficulty_hint"] = profile_data["difficulty_hint"]
    _save_profile_file(book_name, profile, data_root)
    return profile


# ====================================================================
# OpenClaw 式背景记忆引擎 v2 — 8-Round Throttle + Chapter Flush
# ====================================================================

async def async_flush_profile(
    book_name: str,
    new_chat_history: list[dict],
    *,
    api_key: str = "",
    data_root: str | None = None,
    chapter_id: str = "",
) -> dict | None:
    """Throttled background fusion: count turns, flush every 8 rounds.

    Returns the merged profile or None if:
    - No flush needed (counter not at multiple-of-8)
    - No new information detected
    """
    # 1. Read + ensure schema
    current = read_profile(book_name, data_root=data_root)
    if not current:
        current = _init_profile(book_name, data_root)
    else:
        current = _ensure_schema(current)
    
    # 2. Throttle check — Rule A: only flush on every 8th turn
    counter = current.get("_flush_counter", 0) + 1
    current["_flush_counter"] = counter
    _save_profile_file(book_name, current, data_root)
    
    if counter % 8 != 0:
        print(f"⏭  Throttle skip: turn {counter}, next flush at turn {((counter // 8) + 1) * 8}", flush=True)
        return None
    
    print(f"🔥🔥🔥 BackgroundTask: async_flush_profile 启动 (book={book_name}, turn={counter})", flush=True)
    
    # 3. Build chat history string
    history_lines = []
    for entry in new_chat_history:
        role = entry.get("role", "unknown")
        content = str(entry.get("content", ""))[:500]
        history_lines.append(f"[{role}]: {content}")
    chat_history_str = "\n".join(history_lines)
    
    # 4. Load prompt
    from .prompts import PROFILE_FLUSH_PROMPT
    system_prompt = PROFILE_FLUSH_PROMPT.format(
        current_profile_json=_json.dumps(current, ensure_ascii=False, indent=2),
        chat_history=chat_history_str,
        chapter_hint=f"当前正在阅读的章节: {chapter_id}" if chapter_id else "",
    )
    
    try:
        client = _make_client(api_key)
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "请融合档案。"},
            ],
            temperature=0.2,
            max_tokens=4096,  # increased for hierarchical JSON
            stream=False,
        )
        
        raw = response.choices[0].message.content if response.choices else ""
        
        from .skeleton_service import extract_and_parse_json
        merged = extract_and_parse_json(raw)
        merged = _ensure_schema(merged)
        
        if merged.get("core_memory") == current.get("core_memory") and \
           merged.get("episodic_memory") == current.get("episodic_memory"):
            print(f"✅ Profile flush: 无新信息，保持原档案不变", flush=True)
            _save_profile_file(book_name, current, data_root)
            return None
        
        # Preserve counter and metadata
        merged["_flush_counter"] = counter
        merged["_last_flush_at"] = _now_iso()
        merged["schema_version"] = 2
        merged["book_name"] = book_name
        _save_profile_file(book_name, merged, data_root)
        print(f"🔥 Profile flush: 档案已融合更新 (core_fields: {list(merged.get('core_memory', {}).keys())}, "
              f"episodic_chapters: {list(merged.get('episodic_memory', {}).keys())})", flush=True)
        return merged
    
    except Exception as e:
        print(f"⚠️  Profile flush 失败 (non-blocking): {e}", flush=True)
        return None


async def flush_chapter(
    book_name: str,
    chapter_id: str,
    chapter_summary: str,
    *,
    api_key: str = "",
    data_root: str | None = None,
) -> dict | None:
    """ Rule B: Forced chapter flush when user leaves a chapter.

    Directly writes episodic_memory for the given chapter_id.
    Leverages the same PROFILE_FLUSH_PROMPT to merge chapter memory.
    """
    print(f"🔥🔥🔥 BackgroundTask: flush_chapter 启动 (book={book_name}, chapter={chapter_id})", flush=True)
    
    current = read_profile(book_name, data_root=data_root)
    if not current:
        current = _init_profile(book_name, data_root)
    else:
        current = _ensure_schema(current)
    
    from .prompts import PROFILE_FLUSH_PROMPT
    system_prompt = PROFILE_FLUSH_PROMPT.format(
        current_profile_json=_json.dumps(current, ensure_ascii=False, indent=2),
        chat_history=f"本章总结 (用户离开第 {chapter_id} 章):\n{chapter_summary}",
        chapter_hint=f"即将离开的章节: {chapter_id}",
    )
    
    try:
        client = _make_client(api_key)
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"请将第 {chapter_id} 章的学习记忆打包写入 episodic_memory。"},
            ],
            temperature=0.2,
            max_tokens=4096,
            stream=False,
        )
        
        raw = response.choices[0].message.content if response.choices else ""
        
        from .skeleton_service import extract_and_parse_json
        merged = extract_and_parse_json(raw)
        merged = _ensure_schema(merged)
        
        merged["_last_flush_at"] = _now_iso()
        merged["schema_version"] = 2
        merged["book_name"] = book_name
        _save_profile_file(book_name, merged, data_root)
        print(f"🔥 Chapter flush: {chapter_id} 已写入 episodic_memory", flush=True)
        return merged
    
    except Exception as e:
        print(f"⚠️  Chapter flush 失败 (non-blocking): {e}", flush=True)
        return None


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
