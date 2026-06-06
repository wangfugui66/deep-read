"""Quiz service — dynamic chapter test generation using profile memory.

Reads profile.json (core_memory + episodic_memory) and chapter content to
generate 5 difficulty-progressive multiple-choice questions tailored to the
user's profession and weak points.
"""

import json as _json
import os
import re
from pathlib import Path
from typing import Any

from app.core.config import DATA_ROOT

FORBIDDEN_BOOK_NAMES = {"目录", "0000_目录", "0001_目录", "MD_目录", "README", "目录.md"}
FORBIDDEN_PREFIXES = ("目录", "0000_目录")


def _validate_book_name(book_name: str) -> None:
    bn = (book_name or "").strip()
    if bn in FORBIDDEN_BOOK_NAMES:
        raise ValueError(f"Invalid book name: '{bn}'")
    if bn.startswith(FORBIDDEN_PREFIXES):
        raise ValueError(f"Invalid book name: '{bn}'")


# ═══════════════════════════════════════════════════════════════════
# Quiz generation prompt
# ═══════════════════════════════════════════════════════════════════

_QUIZ_GENERATION_PROMPT = """你是一位既严格又精准的阅读测试官。你的任务是基于以下信息生成单项选择题。

## 书籍
《{book_name}》

## 章节内容（节选）
{chapter_content}

## 用户画像
{core_memory}

## 本章薄弱点（前几轮对话暴露的问题）
{episodic_context}

## 题量约束（CRITICAL）
{question_count_hint}

## 出题铁律

1. **场景定制**：必须将 80% 的题目套入用户所在行业的具体场景中。
   例：如果用户是程序员，用「分布式系统」「微服务」「调试 bug」等场景；
   如果用户是医生，用「临床诊断」「病理机制」「用药方案」等场景。

2. **难度递进**：
   - 第 1 题：基础概念辨识（死记硬背即可答对）
   - 第 2 题：概念对比/区分（需要理解差异）
   - 第 3 题：场景应用（套入用户行业场景）
   - 第 4 题：深层推理（需要综合多个概念）
   - 第 5 题：批判性思考挑战（考察对概念局限性的理解）

3. **针对薄弱点**：至少 2 道题需直接指向 episodic_context 中暴露的概念混淆或认知缺口。

4. **选项设计**：
   - 每道题 4 个选项（A/B/C/D）
   - 干扰项必须来自书中真实存在的易混淆概念
   - 正确答案在 4 个选项中均匀分布（不要集中在某一字母）

5. **解释必须精炼**：解释项（explanation）控制在 1-2 句话，点出「为什么对」并顺带指出「为什么最常见的错误选项是错的」。

6. **绝对禁止脱离文本编造题目！** 如果文本中没有实质性可考察的知识点，请直接返回空数组 []。

## 输出格式 (严格 JSON 数组，不要任何额外文字)
[
  {{
    "question": "题目内容",
    "options": {{ "A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D" }},
    "answer": "A",
    "explanation": "解析文字"
  }}
]"""


# ═══════════════════════════════════════════════════════════════════
# Core functions
# ═══════════════════════════════════════════════════════════════════

def _read_profile(book_name: str) -> dict | None:
    """Read .profile.json, returning None if missing."""
    profile_file = DATA_ROOT / "wiki" / book_name / ".profile.json"
    if not profile_file.is_file():
        return None
    try:
        return _json.loads(profile_file.read_text(encoding="utf-8"))
    except Exception:
        return None


def _format_core_memory(profile: dict | None) -> str:
    """Extract and format core_memory from a profile for prompt injection."""
    if not profile:
        return "无用户画像（通用模式）"

    core = profile.get("core_memory", {})
    parts = []

    profession = core.get("profession", "") or profile.get("profession", "")
    if profession:
        parts.append(f"- 行业/职业: {profession}")

    knowledge = core.get("knowledge_level", "") or profile.get("knowledge_level", "")
    if knowledge:
        parts.append(f"- 知识水平: {knowledge}")

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


def _format_episodic(profile: dict | None) -> str:
    """Summarize episodic memory for the quiz prompt."""
    if not profile:
        return "无章节交互记录"

    episodic = profile.get("episodic_memory", {})
    if not episodic:
        return "无章节交互记录"

    parts = []
    for chapter_key, chapter_data in sorted(episodic.items()):
        if not isinstance(chapter_data, dict):
            continue
        struggles = chapter_data.get("key_struggles", [])
        if struggles:
            for s in struggles[:2]:  # Limit to 2 per chapter
                parts.append(f"- [{chapter_key}] 困难点: {s}")
        aha = chapter_data.get("aha_moments", [])
        if aha:
            for a in aha[:1]:
                parts.append(f"- [{chapter_key}] 顿悟: {a}")

    return "\n".join(parts[:10]) if parts else "无薄弱点记录"


def _read_chapter_content(book_name: str, chapter_path: str) -> tuple[str, int]:
    """Read chapter markdown content. Returns (cleaned_content, raw_char_count)."""
    chapter_file = DATA_ROOT / "raw" / "sources" / book_name / chapter_path
    if not chapter_file.is_file():
        return f"[章节文件未找到: {chapter_path}]", 0

    raw = chapter_file.read_text(encoding="utf-8", errors="replace")
    raw_len = len(raw.strip())
    cleaned = re.sub(r"\n{3,}", "\n\n", raw)
    # Truncate: first 2000 + last 1000 for context
    if len(cleaned) > 3500:
        cleaned = cleaned[:2200] + "\n\n[...中略...]\n\n" + cleaned[-1000:]
    return cleaned, raw_len


def _try_parse_json(raw: str) -> list[dict] | None:
    """Attempt to parse LLM output into a list of question dicts."""
    # Strip markdown fences if present
    text = raw.strip()
    if text.startswith("```"):
        idx = text.index("\n") if "\n" in text else 3
        text = text[idx:]
        if text.endswith("```"):
            text = text[:-3]
    text = text.strip()

    try:
        result = _json.loads(text)
        if isinstance(result, list) and len(result) > 0:
            return result
    except Exception:
        pass

    # Fallback: try to extract JSON array via regex
    m = re.search(r"\[([\s\S]*)\]", text)
    if m:
        try:
            extracted = _json.loads(m.group(0))
            if isinstance(extracted, list) and len(extracted) > 0:
                return extracted
        except Exception:
            pass

    return None


def _make_client(api_key: str = ""):
    from openai import AsyncOpenAI
    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    return AsyncOpenAI(
        api_key=key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    )


_FALLBACK_QUESTIONS: list[dict[str, Any]] = [
    {
        "question": "本章的核心主题是什么？",
        "options": {
            "A": "一个无关话题",
            "B": "本章标题所示的核心概念",
            "C": "下章内容的预告",
            "D": "作者的私人观点",
        },
        "answer": "B",
        "explanation": "本章标题直接点明了核心讨论对象，其余选项与正文内容不符。",
    },
    {
        "question": "作者阐述核心概念时使用的第一个论据是什么？",
        "options": {
            "A": "个人经历",
            "B": "常识性假设",
            "C": "书内明确展开的第一个论证点",
            "D": "引用他人的反对意见",
        },
        "answer": "C",
        "explanation": "作者在引入概念后随即展开核心论证，注意回看章节前 1/3 处的内容。",
    },
    {
        "question": "以下哪项是对本章核心概念的最佳应用场景？",
        "options": {
            "A": "完全无关的场景",
            "B": "仅表面相关的场景",
            "C": "反例 / 例外情况",
            "D": "书中明确讨论的应用场景",
        },
        "answer": "D",
        "explanation": "作者在章节后半部分给出了该概念在真实世界中的应用案例，选项 D 与之相符。",
    },
    {
        "question": "如果要用一句话总结本章的深层洞察，应该是？",
        "options": {
            "A": "一切都是相对的",
            "B": "本书讨论的核心机制及其反直觉推论",
            "C": "这个概念不重要",
            "D": "后面章节会有更详细的说明",
        },
        "answer": "B",
        "explanation": "本章通过层层递进的论证，最终揭示了一个反直觉但逻辑自洽的推论。",
    },
    {
        "question": "本章提出的观点与前面哪一主题形成了关键呼应？",
        "options": {
            "A": "完全不相关的内容",
            "B": "前文铺垫的核心框架",
            "C": "后文才会出现的概念",
            "D": "没有任何呼应",
        },
        "answer": "B",
        "explanation": "作者在前文中已经为本章论点铺设了概念基础，注意回顾上文中的相关节点。",
    },
]


async def generate_chapter_test(
    book_name: str,
    chapter_path: str,
    *,
    chapter_title: str = "",
    api_key: str = "",
) -> list[dict[str, Any]]:
    """Generate 5 personalized MCQs based on chapter content + user profile.

    Args:
        book_name:    The book directory name (e.g. "系统论_系统科学哲学")
        chapter_path: Relative path to the chapter .md file
        chapter_title: Human-readable chapter title for context
        api_key:      User-supplied DeepSeek API key (overrides env)

    Returns:
        A list of 5 question dicts, each with question/options/answer/explanation.
    """
    _validate_book_name(book_name)

    key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    if not key or key.startswith("sk-your-"):
        # No API key — return fallback questions
        return [dict(q) for q in _FALLBACK_QUESTIONS]

    # ── Load data ──
    profile = _read_profile(book_name) or {}
    core_memory = _format_core_memory(profile)
    episodic_context = _format_episodic(profile)
    chapter_content, raw_char_count = _read_chapter_content(book_name, chapter_path)

    # ── Content density gate ──
    if raw_char_count < 150:
        return [{"skipped": True, "reason": "本章内容较少，已为您开启免检通道"}]

    if raw_char_count < 500:
        question_count_hint = "本章文本内容较为单薄，请仅生成 1-2 道题。如果文本中没有实质性可考察的知识点，直接返回空数组 []。"
    else:
        question_count_hint = "本章内容充足，请生成 3-5 道题。如果文本中缺乏多样性，可以减少题量。绝对禁止脱离提供的文本强行编造题目！"

    user_prompt = _QUIZ_GENERATION_PROMPT.format(
        book_name=book_name,
        chapter_content=chapter_content,
        core_memory=core_memory,
        episodic_context=episodic_context,
        question_count_hint=question_count_hint,
    )

    # ── Retry loop for JSON parse robustness ──
    client = _make_client(key)
    import asyncio

    for attempt in range(3):
        try:
            resp = await client.chat.completions.create(
                model="deepseek-v4-flash",
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个出题引擎。必须返回纯 JSON 数组。禁止输出任何解释、markdown 标记或尾随文字。",
                    },
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.6,
                max_tokens=2048,
            )
            raw = resp.choices[0].message.content or ""
            parsed = _try_parse_json(raw)
            if parsed:
                # Accept as few as 1 question (or empty — LLM may have judged content insufficient)
                # Filter out any skipped dicts at LLM level
                valid = [q for q in parsed if isinstance(q, dict) and not q.get("skipped")]
                if len(valid) >= 1:
                    for q in valid:
                        q.setdefault("question", "")
                        q.setdefault("options", {})
                        q.setdefault("answer", "A")
                        q.setdefault("explanation", "")
                    return valid[:5]
                # empty valid → LLM deemed content insufficient
                if len(valid) == 0:
                    return [{"skipped": True, "reason": "本章内容暂无可考察的知识点，已为您免检放行"}]
        except Exception:
            pass

        if attempt < 2:
            await asyncio.sleep(2 ** attempt)

    # ── Fallback ──
    return [dict(q) for q in _FALLBACK_QUESTIONS]
