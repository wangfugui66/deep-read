"""Master router — Track 1 (stateless) + Profile + Skeleton + Quiz dispatch.

Routes:
  POST /api/chat/action       — SSE stream (explain / associate)
  POST /api/chat/answer       — quiz answer handler (ABCD next, E → converge)
  POST /api/notes             — save note as .md
  GET  /api/notes             — list notes for a book
  DEL  /api/notes             — delete a note
  POST /api/profile/extract   — ice-breaking profile extraction (SSE)
  GET  /api/profile/{book_name} — read profile
  DEL  /api/profile/{book_name} — delete profile
  POST /api/profile/converge/save_baseline — save baseline intake form
  POST /api/profile/converge/next    — single-question Socrates round
  POST /api/profile/converge/save    — save full wizard profile
  POST /api/skeleton/generate   — generate dynamic TOC
  GET  /api/skeleton/{book_name} — read dynamic TOC
  POST /api/converge/start      — start converge dialogue (Option E trigger)
"""

import json as _json
import traceback as _tb
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api")

# ═══════════════════════════════════════════════════════════════════
# Book name validation — reject "目录" / "0000_目录" ghost bug
# ═══════════════════════════════════════════════════════════════════

FORBIDDEN_BOOK_NAMES = {"目录", "0000_目录", "0001_目录", "MD_目录", "README", "目录.md"}
FORBIDDEN_PREFIXES = ("目录", "0000_目录")

def _validate_book_name(book_name: str) -> None:
    """Reject book_name that looks like a chapter slug or known ghost value."""
    bn = book_name.strip()
    if bn in FORBIDDEN_BOOK_NAMES:
        raise HTTPException(400, f"Invalid book name: '{bn}'. Did you pass a chapter path?")
    if bn.startswith(FORBIDDEN_PREFIXES):
        raise HTTPException(400, f"Invalid book name: '{bn}'. Looks like a ghost chapter slug.")


# ====================================================================
# Pydantic schemas
# ====================================================================

# ====================================================================
# POST /api/chat/action — SSE streaming (explain / associate)
# ====================================================================

class ChatActionRequest(BaseModel):
    action_type: str  # "explain" | "associate"
    context: str      # selected text
    book_name: str = ""  # for background profile flush
    chapter_id: str = ""  # for episodic memory routing

class NoteCreateRequest(BaseModel):
    book_name: str
    quote: str
    content: str

class NoteDeleteRequest(BaseModel):
    book_name: str
    note_id: str

class ProfileExtractRequest(BaseModel):
    book_name: str
    chat_context: list[dict]

class ProfileWriteRequest(BaseModel):
    reading_mode: str = "ATTACK"
    knowledge_baseline: str = ""
    pain_point: str = ""
    cognitive_preference: str = ""
    time_budget_minutes: int = 0

class SkeletonGenerateRequest(BaseModel):
    book_name: str

class QuizAnswerRequest(BaseModel):
    book_name: str
    concept_name: str
    selected_answer: str
    chat_context: list[dict] = []

class ConvergeStartRequest(BaseModel):
    book_name: str
    concept_name: str
    user_profile: dict = {}

class DictionaryRequest(BaseModel):
    book_name: str
    query: str

class ChatSessionRequest(BaseModel):
    book_name: str
    session_id: str = ""
    role: str = "user"
    content: str = ""

class SocraticChatRequest(BaseModel):
    book_name: str
    message: str
    chapter_title: str = ""
    chapter_path: Optional[str] = None
    chat_history: list[dict] = []

class QuizGenerateRequest(BaseModel):
    book_name: str
    chapter_path: str
    chapter_title: str = ""


# ── Converge: Baseline Intake ──

class BaselineSaveRequest(BaseModel):
    book_name: str
    profession: str           # user's industry / job
    knowledge_level: str      # "纯小白" | "零散了解过" | "具备系统性知识" | "资深从业者"
    pain_point: str           # core problem they want to solve
    daily_minutes: int = 30   # minutes per day
    planned_days: int = 7     # how many days planned


# ── Converge: Single-round Socratic question ──

class ConvergeNextRequest(BaseModel):
    book_name: str
    round_num: int            # 1–10
    profession: str
    knowledge_level: str
    pain_point: str
    history: list[dict] = []  # [{"question": "...", "selected": "A. ..."}, ...]
    # If last round had E selected, the free_text is the user's description
    free_text: str = ""


# ── Converge: Final save ──

class ConvergeSaveRequest(BaseModel):
    book_name: str
    profession: str
    knowledge_level: str
    pain_point: str
    learning_preference: str  # "theory_first" | "story_first"
    daily_minutes: int
    planned_days: int
    diagnosis_conclusion: str
    cognitive_gaps: list[str]
    difficulty_hint: str
    convergence_history: list[dict] = []


# ====================================================================
# POST /api/chat/action — SSE streaming (explain / associate)
# ====================================================================

@router.post("/chat/action")
async def chat_action(req: ChatActionRequest, request: Request) -> StreamingResponse:
    from .services import chat_service, profile_service

    api_key = request.headers.get("x-api-key", "")

    if req.action_type == "explain":
        inner = chat_service.stream_explain(req.context, api_key=api_key)
    elif req.action_type == "associate":
        inner = chat_service.stream_associate(req.context, api_key=api_key)
    else:
        raise HTTPException(400, f"Unknown action_type: {req.action_type}")

    # ── Wrapper: collect full response, then trigger throttled background flush ──
    book_name = req.book_name
    chapter_id = req.chapter_id

    async def _with_flush():
        full_response = ""
        async for chunk in inner:
            if chunk.startswith("data: ") and '"token"' in chunk:
                try:
                    data = _json.loads(chunk[6:])
                    if data.get("token"):
                        full_response += data["token"]
                except Exception:
                    pass
            yield chunk
        # Throttled flush — async_flush_profile handles the 8-turn gate internally
        if book_name and full_response.strip():
            try:
                await profile_service.async_flush_profile(
                    book_name,
                    new_chat_history=[
                        {"role": "user", "content": req.context},
                        {"role": "assistant", "content": full_response},
                    ],
                    api_key=api_key,
                    chapter_id=chapter_id,
                )
            except Exception:
                pass

    return StreamingResponse(_with_flush(), media_type="text/event-stream")


# ====================================================================
# POST /api/chat/socratic — Socratic conversation with profile injection
# ====================================================================

@router.post("/chat/socratic")
async def chat_socratic(req: SocraticChatRequest, request: Request) -> StreamingResponse:
    from .services import chat_service

    _validate_book_name(req.book_name)

    async def _sse():
        try:
            async for token in chat_service.stream_socratic_chat(
                req.book_name,
                req.message,
                api_key=request.headers.get("x-api-key", ""),
                chapter_title=req.chapter_title,
                chapter_path=req.chapter_path or "",
                chat_history=req.chat_history,
            ):
                yield f"data: {_json.dumps({'token': token})}\n\n"
        except Exception as e:
            yield f"data: {_json.dumps({'token': f'❌ 服务端异常：{str(e)[:200]}'})}\n\n"
        yield f"data: {_json.dumps({'done': True})}\n\n"

    return StreamingResponse(_sse(), media_type="text/event-stream")


# ====================================================================
# Notes CRUD
# ====================================================================

@router.post("/notes")
async def create_note(req: NoteCreateRequest) -> dict:
    from .services import note_service
    _validate_book_name(req.book_name)
    return note_service.save_note(req.book_name, req.quote, req.content)

@router.get("/notes")
async def list_notes(book_name: str = Query(...)) -> list[dict]:
    from .services import note_service
    _validate_book_name(book_name)
    return note_service.list_notes(book_name)

@router.delete("/notes")
async def delete_note(req: NoteDeleteRequest) -> dict:
    from .services import note_service
    _validate_book_name(req.book_name)
    deleted = note_service.delete_note(req.book_name, req.note_id)
    if not deleted:
        raise HTTPException(404, f"Note {req.note_id} not found")
    return {"deleted": True}


# ====================================================================
# Profile endpoints
# ====================================================================

@router.post("/profile/extract")
async def extract_profile(req: ProfileExtractRequest, request: Request) -> StreamingResponse:
    from .services import profile_service
    _validate_book_name(req.book_name)
    api_key = request.headers.get("x-api-key", "")

    async def _sse_wrapper() -> AsyncGenerator[str, None]:
        try:
            async for event in profile_service.stream_profile_extraction(
                req.book_name, req.chat_context, api_key=api_key,
            ):
                yield event
        except Exception as e:
            yield f"data: {_json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(_sse_wrapper(), media_type="text/event-stream")


@router.get("/profile/{book_name}")
async def read_profile(book_name: str) -> dict:
    from .services import profile_service
    _validate_book_name(book_name)
    profile = profile_service.read_profile(book_name)
    if profile is None:
        raise HTTPException(404, f"No profile found for book: {book_name}")
    return profile


@router.delete("/profile/{book_name}")
async def delete_profile(book_name: str) -> dict:
    from .services import profile_service
    _validate_book_name(book_name)
    deleted = profile_service.delete_profile(book_name)
    if not deleted:
        raise HTTPException(404, f"No profile found for book: {book_name}")
    return {"deleted": True}


@router.put("/profile/{book_name}")
async def upsert_profile(book_name: str, req: ProfileWriteRequest) -> dict:
    from .services import profile_service
    _validate_book_name(book_name)
    profile_dict = {
        "reading_mode": req.reading_mode,
        "knowledge_baseline": req.knowledge_baseline,
        "pain_point": req.pain_point,
        "cognitive_preference": req.cognitive_preference,
        "time_budget_minutes": req.time_budget_minutes,
        "cognitive_tags": [],
    }
    path = profile_service._save_profile_file(book_name, profile_dict)
    return {"status": "saved", "book_name": book_name, "path": str(path)}


# ====================================================================
# Profile — Chapter Flush (Rule B: episodic memory pack on leave)
# ====================================================================

class ChapterFlushRequest(BaseModel):
    book_name: str
    chapter_id: str
    chapter_summary: str = ""


@router.post("/profile/flush_chapter")
async def flush_chapter(req: ChapterFlushRequest, request: Request) -> dict:
    """Force episodic memory write when user leaves a chapter.

    Called by frontend when user clicks 'Next Chapter'.
    The backend compresses the chapter experience into episodic_memory[chapter_id].
    """
    from .services import profile_service
    _validate_book_name(req.book_name)
    api_key = request.headers.get("x-api-key", "")
    try:
        result = await profile_service.flush_chapter(
            book_name=req.book_name,
            chapter_id=req.chapter_id,
            chapter_summary=req.chapter_summary or f"用户完成了第 {req.chapter_id} 章的阅读",
            api_key=api_key,
        )
        return {
            "status": "flushed",
            "chapter_id": req.chapter_id,
            "has_update": result is not None,
        }
    except Exception as e:
        raise HTTPException(500, str(e))


# ====================================================================
# Converge — Multi-round Socratic diagnosis (Tasks 2+3)
# ====================================================================

@router.post("/profile/converge/save_baseline")
async def converge_save_baseline(req: BaselineSaveRequest) -> dict:
    """Save the baseline intake form (profession, knowledge level, pain point, time)."""
    from .services import profile_service
    _validate_book_name(req.book_name)
    try:
        profile = profile_service.save_baseline_profile(
            req.book_name,
            profession=req.profession,
            knowledge_level=req.knowledge_level,
            pain_point=req.pain_point,
            daily_minutes=req.daily_minutes,
            planned_days=req.planned_days,
        )
        return {"status": "saved", "profile": profile}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/profile/converge/next")
async def converge_next(req: ConvergeNextRequest, request: Request) -> dict:
    """Single-round Socratic question. Returns next question or convergence signal."""
    from .services import profile_service
    _validate_book_name(req.book_name)
    api_key = request.headers.get("x-api-key", "")
    try:
        result = await profile_service.converge_next_round(
            book_name=req.book_name,
            round_num=req.round_num,
            profession=req.profession,
            knowledge_level=req.knowledge_level,
            pain_point=req.pain_point,
            history=req.history,
            free_text=req.free_text,
            api_key=api_key,
        )
        return result
    except Exception as e:
        raise HTTPException(500, f"Converge round failed: {e}")


@router.post("/profile/converge/save")
async def converge_save(req: ConvergeSaveRequest) -> dict:
    """Save the full wizard-collected profile including convergence history."""
    from .services import profile_service
    _validate_book_name(req.book_name)
    try:
        profile = profile_service.save_converge_profile(
            book_name=req.book_name,
            profession=req.profession,
            knowledge_level=req.knowledge_level,
            pain_point=req.pain_point,
            learning_preference=req.learning_preference,
            daily_minutes=req.daily_minutes,
            planned_days=req.planned_days,
            diagnosis_conclusion=req.diagnosis_conclusion,
            cognitive_gaps=req.cognitive_gaps,
            difficulty_hint=req.difficulty_hint,
            convergence_history=req.convergence_history,
        )
        return {"status": "saved", "profile": profile}
    except Exception as e:
        raise HTTPException(500, str(e))


# ====================================================================
# Skeleton generation
# ====================================================================

@router.post("/skeleton/generate")
async def generate_skeleton(req: SkeletonGenerateRequest, request: Request) -> dict:
    from .services import skeleton_service
    _validate_book_name(req.book_name)
    api_key = request.headers.get("x-api-key", "")

    result = await skeleton_service.generate_skeleton(req.book_name, api_key=api_key)
    if result["status"] == "failed" and "Profile not found" in result.get("error", ""):
        raise HTTPException(400, result["error"])
    if result["status"] == "failed":
        raise HTTPException(500, result.get("error", "Unknown error"))
    return result


@router.get("/skeleton/{book_name}")
async def read_skeleton(book_name: str) -> dict:
    from .services import skeleton_service
    _validate_book_name(book_name)
    data = skeleton_service.read_skeleton(book_name)
    if data is None:
        raise HTTPException(404, f"No skeleton found for book: {book_name}")
    return {"book_name": book_name, "toc_data": data}


# ====================================================================
# Quiz answer handler
# ====================================================================

@router.post("/chat/answer")
async def handle_quiz_answer(req: QuizAnswerRequest) -> dict:
    from .services import profile_service
    _validate_book_name(req.book_name)
    answer = req.selected_answer.upper()

    if answer == "E":
        profile = profile_service.read_profile(req.book_name)
        if profile is None:
            profile = {}
        return {
            "action": "converge",
            "book_name": req.book_name,
            "concept_name": req.concept_name,
            "message": (
                "好的，让我换一种方式来帮你理解这个问题。"
                f"我们一起来找一个适合你认知背景的比喻来解释「{req.concept_name}」。"
            ),
            "user_profile": profile,
            "converge_prompt": (
                f"用户正在学习概念「{req.concept_name}」，但他/她觉得之前的解释无法理解。\n"
                f"用户画像: {_json.dumps(profile, ensure_ascii=False)}\n"
                "请通过多轮对话，找到适合用户认知背景的隐喻或类比来解释这个概念。\n"
                "目标：找到一个用户能直觉理解的比喻，然后将该认知标签写入 profile。"
            ),
        }
    return {
        "action": "quiz_result",
        "selected_answer": answer,
        "is_correct": (answer == "C"),
        "next_action": "continue_reading",
    }


# ====================================================================
# Converge / Dictionary / Chat Sessions (unchanged stubs)
# ====================================================================

@router.post("/converge/start")
async def start_converge(req: ConvergeStartRequest) -> dict:
    profile = req.user_profile or {}
    converge_opening = (
        f"## Converge — 比喻发现\n\n"
        f"**Restate**: 你在学习「{req.concept_name}」这个概念时遇到了理解障碍。"
        f"你目前的认知背景标签是: {_json.dumps(profile.get('cognitive_tags', ['无标签']), ensure_ascii=False)}\n\n"
        f"**Insight**: 不同认知背景的人需要不同的比喻来理解抽象概念。"
        f"比如，程序员用「内存/磁盘缓存」来理解「工作记忆/长期记忆」，"
        f"厨师用「高汤/调味」来理解「涌现/基础元素」。\n\n"
        f"**Questions — Round 1**:"
    )
    return {
        "session_id": f"converge_{req.book_name}_{req.concept_name}",
        "book_name": req.book_name,
        "concept_name": req.concept_name,
        "opening_message": converge_opening,
        "questions": [
            {
                "id": "domain_background",
                "prompt": "[背景] 你的专业领域或日常工作是什么？",
                "options": [
                    {"id": "tech", "label": "计算机/编程/IT"},
                    {"id": "eng", "label": "工程/制造/物理"},
                    {"id": "bio", "label": "生物/医学/化学"},
                    {"id": "biz", "label": "商业/管理/金融"},
                    {"id": "art", "label": "人文/艺术/设计"},
                    {"id": "edu", "label": "教育/社科/心理学"},
                    {"id": "other", "label": "以上都不是，我来说"},
                ],
            },
            {
                "id": "learning_style",
                "prompt": "[方式] 你更喜欢哪种理解方式？",
                "options": [
                    {"id": "analogy", "label": "用我熟悉的领域做类比"},
                    {"id": "first_principles", "label": "从第一性原理推导"},
                    {"id": "visual", "label": "图表/流程图/视觉化"},
                    {"id": "story", "label": "故事/案例/叙事"},
                    {"id": "other", "label": "以上都不是，我来说"},
                ],
            },
        ],
    }

@router.post("/dictionary")
async def dictionary_lookup(req: DictionaryRequest) -> dict:
    from .services import rg_searcher
    _validate_book_name(req.book_name)
    return rg_searcher.search_book(req.book_name, req.query)

@router.get("/chat/sessions/{book_name}")
async def list_chat_sessions(book_name: str) -> list[dict]:
    from .services import chat_session_service
    return chat_session_service.list_sessions(book_name)

@router.get("/chat/sessions/{book_name}/{session_id}")
async def read_chat_session(book_name: str, session_id: str) -> dict:
    from .services import chat_session_service
    data = chat_session_service.read_session(book_name, session_id)
    if data is None:
        raise HTTPException(404, f"Session {session_id} not found")
    return data

@router.post("/chat/sessions/{book_name}")
async def create_chat_session(book_name: str) -> dict:
    from .services import chat_session_service
    return chat_session_service.create_session(book_name)

@router.delete("/chat/sessions/{book_name}/{session_id}")
async def delete_chat_session(book_name: str, session_id: str) -> dict:
    from .services import chat_session_service
    deleted = chat_session_service.delete_session(book_name, session_id)
    if not deleted:
        raise HTTPException(404, f"Session {session_id} not found")
    return {"deleted": True}

@router.post("/chat/sessions/{book_name}/{session_id}/append")
async def append_chat_message(book_name: str, session_id: str, req: ChatSessionRequest) -> dict:
    from .services import chat_session_service
    return chat_session_service.append_message(book_name, session_id, req.role, req.content)


# ====================================================================
# POST /api/quiz/generate_chapter_test — dynamic chapter quiz
# ====================================================================

@router.post("/quiz/generate_chapter_test")
async def generate_chapter_test(req: QuizGenerateRequest, request: Request) -> dict:
    """Generate 5 personalized MCQs for the current chapter."""
    from .services import quiz_service

    _validate_book_name(req.book_name)
    api_key = request.headers.get("x-api-key", "")

    try:
        questions = await quiz_service.generate_chapter_test(
            req.book_name, req.chapter_path, chapter_title=req.chapter_title, api_key=api_key
        )
        return {"status": "ok", "questions": questions}
    except Exception as e:
        raise HTTPException(500, f"Quiz generation failed: {e}")
