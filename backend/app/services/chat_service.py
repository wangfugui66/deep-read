"""Chat service — stateless LLM streaming for Track 1 (immersive actions).

No session persistence. No database. Pure LLM call + SSE streaming.
API key priority: x-api-key header > DEEPSEEK_API_KEY env var.
"""

import asyncio
import json as _json
import os
from typing import AsyncGenerator

MAX_RETRIES = 3
LLM_TIMEOUT_SECONDS = 30


def _make_client(api_key: str = ""):
    from openai import AsyncOpenAI
    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    return AsyncOpenAI(
        api_key=key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    )


async def _llm_stream(
    system_prompt: str,
    user_prompt: str,
    *,
    api_key: str = "",
    model: str = "deepseek-v4-flash",
    temperature: float = 0.7,
    max_tokens: int = 250,
) -> AsyncGenerator[str, None]:
    """Generic LLM streaming call with retry. api_key overrides env var."""
    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    if not key or key.startswith("sk-your-"):
        yield "（DeepSeek API Key 未配置。请点击顶部 ⚙ 设置按钮，输入你的 API Key。）"
        return

    client = _make_client(key)

    for attempt in range(MAX_RETRIES):
        try:
            stream = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
            return
        except Exception as exc:
            if attempt == MAX_RETRIES - 1:
                raise
            await asyncio.sleep(2 ** attempt)


# ── Immersive action prompts ───────────────────────────────────

_EXPLAIN_SYSTEM_PROMPT = """你是一个精通费曼学习法的概念拆解专家。用户正在阅读，并划选了一段文本。
你的唯一任务：把复杂的黑话变成大白话。

🔴 强制规则：
- 严禁复读：不要重复划线的原话，不要逐字翻译。
- 一击致命：用一句话说清楚这个词/这段话本质上是什么。
- 生活类比：必须给出一个绝妙的、极其接地气的生活类比（例如：把API比作餐厅服务员）。
- 字数限制：你的回答展示在悬浮气泡中，必须极其精简，严格控制在 100 字以内！"""

_ASSOCIATE_SYSTEM_PROMPT = """你是一位知识渊博的跨学科黑客。用户划选了书中的一段文本，说明他们对这个概念很感兴趣。
你的任务不是解释它，而是为它寻找现实世界中的映射，激发用户的啊哈时刻 (Aha moment)。

🔴 强制规则：
- 跨界链接：给出一个该概念在其他完全不相关的领域（如商业、生物学、日常心理、流行文化）的真实应用或相似现象。
- 引人深思：用一个反常识的视角，或者一句启发性的反问来结尾。
- 字数限制：悬浮气泡显示，极其精简，严格控制在 100 字以内！"""


async def stream_explain(selected_text: str, api_key: str = "") -> AsyncGenerator[str, None]:
    """Stream an explanation for selected text."""
    user_prompt = f"用户选中的文字：\n{selected_text}"
    async for token in _llm_stream(_EXPLAIN_SYSTEM_PROMPT, user_prompt, api_key=api_key):
        yield f"data: {_json.dumps({'type': 'chunk', 'data': token})}\n\n"
    yield f"data: {_json.dumps({'type': 'done'})}\n\n"


async def stream_associate(selected_text: str, api_key: str = "") -> AsyncGenerator[str, None]:
    """Stream cross-domain associations for selected text."""
    user_prompt = f"用户选中的文字：\n{selected_text}"
    async for token in _llm_stream(_ASSOCIATE_SYSTEM_PROMPT, user_prompt, api_key=api_key):
        yield f"data: {_json.dumps({'type': 'chunk', 'data': token})}\n\n"
    yield f"data: {_json.dumps({'type': 'done'})}\n\n"


# ── Socratic Chat — full conversation with profile injection ──

from .prompts import SOCRATIC_CHAT_SYSTEM_PROMPT as SOCRATIC_PROMPT

def _build_chapter_context(book_name: str, chapter_path: str, chapter_title: str, data_dir: str) -> str:
    """Read chapter file and return a formatted context string for the prompt.

    If chapter_path is provided and the file exists, reads the first 1500 chars
    of the Markdown file and returns them alongside the chapter title.
    Falls back to title-only context if the file is missing or unreadable.
    """
    if chapter_path:
        import os
        base = data_dir or os.path.join("data", "raw", "sources")
        file_path = os.path.join(base, book_name, chapter_path)
        if os.path.isfile(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read(1500)
                title = chapter_title or chapter_path
                return f"当前章节：{title}\n正文片段（前1500字）：\n{content}"
            except Exception:
                pass
    fallback = f"当前章节: {chapter_title}" if chapter_title else "用户正在阅读全书，未指定具体章节"
    return fallback


def _format_core_memory(profile: dict | None) -> str:
    """Extract and format core_memory from a profile for prompt injection."""
    if not profile:
        return "无用户画像（首次使用）"

    core = profile.get("core_memory", {})
    parts = []

    profession = core.get("profession", "") or profile.get("profession", "")
    if profession:
        parts.append(f"- 行业/职业: {profession}")

    knowledge = core.get("knowledge_level", "") or profile.get("knowledge_level", "")
    if knowledge:
        parts.append(f"- 知识水平: {knowledge}")

    style = core.get("learning_style", "") or profile.get("learning_preference", "")
    if style:
        label = "先懂理论再看案例" if style == "theory_first" else "先看案例再总结理论"
        parts.append(f"- 学习偏好: {label}")

    pain = core.get("pain_point", "") or profile.get("pain_point", "")
    if pain:
        parts.append(f"- 核心痛点: {pain}")

    gaps = core.get("cognitive_gaps", [])
    if gaps:
        parts.append(f"- 认知缺口: {', '.join(gaps)}")

    diag = core.get("diagnosis", "") or profile.get("diagnosis_conclusion", "")
    if diag:
        parts.append(f"- 诊断结论: {diag}")

    return "\n".join(parts) if parts else "无详细画像"


# ═══════════════════════════════════════════════════════════════════════
# Book name validation helpers (mirrored from master_router for safety)
# ═══════════════════════════════════════════════════════════════════════

FORBIDDEN_BOOK_NAMES = {"目录", "0000_目录", "0001_目录", "MD_目录", "README", "目录.md"}
FORBIDDEN_PREFIXES = ("目录", "0000_目录")

def _validate_book_name(book_name: str) -> None:
    bn = (book_name or "").strip()
    if bn in FORBIDDEN_BOOK_NAMES:
        raise ValueError(f"Invalid book name: '{bn}'")
    if bn.startswith(FORBIDDEN_PREFIXES):
        raise ValueError(f"Invalid book name: '{bn}'")


async def stream_socratic_chat(
    book_name: str,
    user_message: str,
    *,
    api_key: str = "",
    chapter_title: str = "",
    chapter_path: str = "",
    data_dir: str = "",
    chat_history: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """Full Socratic conversation with dynamic profile injection.

    Reads profile.json for core_memory and injects it into the system prompt
    so the LLM tailors analogies to the user's profession and learning style.
    If chapter_path is provided, reads the chapter file to inject context.
    """
    _validate_book_name(book_name)

    # ── Load profile ──
    profile = None
    try:
        from . import profile_service as _ps
        profile = _ps.read_profile(book_name) or {}
    except Exception:
        pass

    core_memory = _format_core_memory(profile)
    chapter_context = _build_chapter_context(book_name, chapter_path, chapter_title, data_dir)

    system_prompt = SOCRATIC_PROMPT.format(
        book_name=book_name,
        core_memory=core_memory,
        chapter_context=chapter_context,
    )

    # ── Build message list ──
    messages = [{"role": "system", "content": system_prompt}]
    if chat_history:
        messages.extend(chat_history)
    messages.append({"role": "user", "content": user_message})

    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    if not key or key.startswith("sk-your-"):
        yield f"data: {_json.dumps({'type': 'error', 'message': '未配置 DeepSeek API Key，请在设置中配置。'})}\n\n"
        yield f"data: {_json.dumps({'type': 'done'})}\n\n"
        return

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            api_key=key,
            base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        )

        import asyncio
        for attempt in range(3):
            try:
                stream = await client.chat.completions.create(
                    model="deepseek-v4-flash",
                    messages=messages,
                    stream=True,
                    temperature=0.8,
                    max_tokens=512,
                )
                async for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        token = chunk.choices[0].delta.content
                        yield f"data: {_json.dumps({'type': 'chunk', 'data': token})}\n\n"
                yield f"data: {_json.dumps({'type': 'done'})}\n\n"
                return
            except Exception:
                if attempt == 2:
                    yield f"data: {_json.dumps({'type': 'error', 'message': '请求失败，请重试'})}\n\n"
                    yield f"data: {_json.dumps({'type': 'done'})}\n\n"
                    return
                await asyncio.sleep(2 ** attempt)
    except Exception as e:
        error_detail = str(e)[:200]
        yield f"data: {_json.dumps({'type': 'error', 'message': f'大模型 API 异常：{error_detail}'})}\n\n"
        yield f"data: {_json.dumps({'type': 'done'})}\n\n"
