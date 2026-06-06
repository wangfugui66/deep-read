"""Plugins router — isolated API surface for plugin backends.

All plugin endpoints live under /api/plugins/ to maintain physical separation
from core routers (resource_router, master_router).  Never imports core chat/skeleton logic.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

from app.core.config import DATA_ROOT
from app.services.teachany_service import generate_courseware, PLUGINS_ROOT

logger = logging.getLogger("deepread.plugins")

plugins_router = APIRouter(prefix="/api/plugins")


# ── Request schema ──

class TeachAnyGenerateRequest(BaseModel):
    book_name: str
    chapter_paths: list[str]


# ── POST /api/plugins/teachany/generate ──

@plugins_router.post("/teachany/generate")
async def teachany_generate(req: TeachAnyGenerateRequest, request: Request) -> dict:
    """Generate a TeachAny interactive courseware HTML from chapter summaries.

    Accepts one or more chapter_paths (relative to book's raw/sources/ directory).
    Returns a view URL that can be opened in a new tab via window.open().
    """
    # Extract API key from request header or env
    api_key = request.headers.get("x-api-key", "")

    logger.info(
        "TeachAny generate: book=%s, paths=%d, first=%s",
        req.book_name,
        len(req.chapter_paths),
        req.chapter_paths[0] if req.chapter_paths else "N/A",
    )

    if not req.chapter_paths:
        raise HTTPException(400, "chapter_paths must not be empty")

    result = await generate_courseware(
        book_name=req.book_name,
        chapter_paths=req.chapter_paths,
        api_key=api_key,
    )

    if result.get("status") == "error":
        raise HTTPException(500, result.get("message", "Unknown error"))

    return result


# ── GET /api/plugins/teachany/view/{book_name}/{file_name} ──

@plugins_router.get("/teachany/view/{book_name}/{file_name}")
async def teachany_view(book_name: str, file_name: str):
    """Serve a cached TeachAny courseware HTML file.

    Returns the HTML with Content-Type: text/html so browsers render it directly.
    """
    # Security: prevent path traversal via file_name
    if "/" in file_name or "\\" in file_name or ".." in file_name:
        raise HTTPException(400, "Invalid file_name")

    html_path = PLUGINS_ROOT / book_name / file_name
    if not html_path.is_file():
        raise HTTPException(404, f"Courseware not found: {file_name}")

    return FileResponse(
        path=str(html_path),
        media_type="text/html",
        headers={"Content-Type": "text/html; charset=utf-8"},
    )
