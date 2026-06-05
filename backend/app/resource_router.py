"""Resource router — file-system book/chapter/graph/pipeline/dictionary endpoints.

These routes are pure passthroughs that scan data/raw/sources/ and data/wiki/.
No database needed. All endpoints are read-only except dictionary (LLM call).
"""

import os
import json
import logging
import shutil
import base64
import tempfile
import asyncio
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Request
from pydantic import BaseModel

logger = logging.getLogger("deepread.resource")

resource_router = APIRouter(prefix="/api")

DATA_ROOT = Path(__file__).resolve().parent.parent / "data"
RAW_ROOT = DATA_ROOT / "raw" / "sources"
WIKI_ROOT = DATA_ROOT / "wiki"

def _read_indexing_status(book_name: str) -> str:
    """Read indexing_status from wiki/{book}/.meta.json, default to 'pending'."""
    meta_file = WIKI_ROOT / book_name / ".meta.json"
    if meta_file.is_file():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            return meta.get("indexing_status", "pending")
        except (json.JSONDecodeError, ValueError):
            pass
    return "pending"


# ====================================================================
# Pydantic schemas
# ====================================================================

class DictionaryQueryRequest(BaseModel):
    book_name: str
    query: str

class UploadRequest(BaseModel):
    filename: str
    data: str  # base64-encoded file content

class BookUpdateRequest(BaseModel):
    new_name: str = ""    # rename (optional)
    cover_url: str = ""   # change cover (optional)

# ====================================================================
# GET /api/books — list all books
# ====================================================================

@resource_router.get("/books")
async def list_books() -> list[dict]:
    """Scan data/raw/sources/ for book directories. Each directory = one book."""
    books = []
    if not RAW_ROOT.exists():
        return books

    for d in sorted(RAW_ROOT.iterdir()):
        if not d.is_dir():
            continue
        # count .md chapter files (exclude the full-book .md)
        chapters = [f for f in d.rglob("*.md") if f.is_file() and f.stem != d.name]

        # read .meta.json for cover
        meta_file = WIKI_ROOT / d.name / ".meta.json"
        cover_url = ""
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                cover_url = meta.get("cover_url", "")
            except (json.JSONDecodeError, ValueError):
                pass

        books.append({
            "book_name": d.name,
            "title": d.name.replace("-", " ").title(),
            "file_type": "md",
            "chapter_count": len(chapters),
            "cover_url": cover_url,
            "indexing_status": _read_indexing_status(d.name),
        })
    return books


# ====================================================================
# DELETE /api/books/{book_name} — safe delete
# ====================================================================

@resource_router.delete("/books/{book_name}")
async def delete_book(book_name: str) -> dict:
    """Delete a book: remove data/raw/sources/<book> and data/wiki/<book>."""
    raw_dir = RAW_ROOT / book_name
    wiki_dir = WIKI_ROOT / book_name
    deleted = []

    for d, label in [(raw_dir, "raw"), (wiki_dir, "wiki")]:
        if d.is_dir():
            shutil.rmtree(d)
            deleted.append(label)

    if not deleted:
        raise HTTPException(404, f"Book not found: {book_name}")

    return {"deleted": True, "book_name": book_name, "removed": deleted}


# ====================================================================
# PUT /api/books/{book_name} — rename / change cover
# ====================================================================

@resource_router.put("/books/{book_name}")
async def update_book(book_name: str, req: BookUpdateRequest) -> dict:
    """Rename book folder or update cover_url in .meta.json."""
    raw_dir = RAW_ROOT / book_name
    if not raw_dir.is_dir():
        raise HTTPException(404, f"Book not found: {book_name}")

    # ── Rename ──
    if req.new_name and req.new_name != book_name:
        new_raw = RAW_ROOT / req.new_name
        new_wiki = WIKI_ROOT / req.new_name
        existing_raw = WIKI_ROOT / book_name
        if new_raw.exists() or new_wiki.exists():
            raise HTTPException(409, f"Target name already exists: {req.new_name}")
        raw_dir.rename(new_raw)
        if existing_raw.is_dir():
            existing_raw.rename(new_wiki)
        book_name = req.new_name  # update for meta file write below

    # ── Cover ──
    if req.cover_url:
        meta_file = WIKI_ROOT / book_name / ".meta.json"
        meta_file.parent.mkdir(parents=True, exist_ok=True)
        meta = {}
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, ValueError):
                pass
        meta["cover_url"] = req.cover_url
        meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return {"updated": True, "book_name": book_name}


# ====================================================================
# GET /api/books/{book_name} — single book meta
# ====================================================================

@resource_router.get("/books/{book_name}")
async def get_book_meta(book_name: str) -> dict:
    """Get metadata for a single book."""
    book_dir = RAW_ROOT / book_name
    if not book_dir.is_dir():
        raise HTTPException(404, f"Book not found: {book_name}")

    chapters = [f for f in book_dir.rglob("*.md") if f.is_file()]
    return {
        "book_name": book_name,
        "title": book_name.replace("-", " ").title(),
        "file_type": "md",
        "chapter_count": len(chapters),
        "indexing_status": _read_indexing_status(book_name),
    }


# ====================================================================
# GET /api/books/{book_name}/indexing-status — alive progress for frontend polling
# ====================================================================

@resource_router.get("/books/{book_name}/indexing-status")
async def get_indexing_status(book_name: str) -> dict:
    """Return { status, indexed, total } from .meta.json."""
    meta_file = WIKI_ROOT / book_name / ".meta.json"
    if not meta_file.is_file():
        return {"status": "pending", "indexed": 0, "total": 0}
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError):
        return {"status": "pending", "indexed": 0, "total": 0}
    return {
        "status": meta.get("indexing_status", "pending"),
        "indexed": meta.get("indexed_chapters", 0),
        "total": meta.get("total_chapters", 0),
    }


# ====================================================================
# POST /api/books/{book_name}/build_index — force re-index (极速调试通道)
# ====================================================================

@resource_router.post("/books/{book_name}/build_index")
async def force_build_index(book_name: str, background_tasks: BackgroundTasks, request: Request) -> dict:
    """Force-reset indexing status and re-trigger build_book_index as a background task.

    Useful when the first indexing silently crashed (e.g. missing API key)
    and the frontend is stuck showing "processing" with no progress.
    """
    from .services.indexer_service import build_book_index, _write_meta, _read_meta

    api_key = request.headers.get("x-api-key", "")

    # Reset progress
    meta = _read_meta(book_name)
    meta["indexing_status"] = "processing"
    meta["indexed_chapters"] = 0
    _write_meta(book_name, meta)

    background_tasks.add_task(build_book_index, book_name, api_key)
    logger.info("Manual index trigger for %s", book_name)
    return {"message": "后台索引任务已启动", "book_name": book_name}


# ====================================================================
# GET /api/books/{book_name}/chapters — chapter listing
# ====================================================================

@resource_router.get("/books/{book_name}/chapters")
async def list_chapters(book_name: str) -> list[dict]:
    """List chapter .md files for a book, sorted by numeric prefix."""
    from .services.indexer_service import load_chapters_index

    book_dir = RAW_ROOT / book_name
    if not book_dir.is_dir():
        raise HTTPException(404, f"Book not found: {book_name}")

    index = load_chapters_index(book_name)

    chapters = []
    for f in sorted(book_dir.rglob("*.md")):
        if not f.is_file():
            continue
        rel = str(f.relative_to(book_dir)).replace("\\", "/")
        entry = index.get(rel, {})
        chapters.append({
            "title": f.stem,
            "path": rel,
            "order": len(chapters),
            "parent_title": None,
            "summary": entry.get("summary"),
            "tags": entry.get("tags", []),
            "is_indexed": entry.get("is_indexed", False),
        })
    return chapters


# ====================================================================
# GET /api/books/{book_name}/chapters/{chapter_path:path} — chapter content
# ====================================================================

@resource_router.get("/books/{book_name}/chapters/{chapter_path:path}")
async def get_chapter_content(book_name: str, chapter_path: str) -> dict:
    """Return raw Markdown content of a chapter file."""
    book_dir = RAW_ROOT / book_name
    chapter_file = book_dir / chapter_path
    if not chapter_file.is_file():
        raise HTTPException(404, f"Chapter not found: {chapter_path}")

    content = chapter_file.read_text(encoding="utf-8", errors="replace")
    return {"title": chapter_file.stem, "content": content}


# ====================================================================
# GET /api/graph/{book_name} — knowledge graph data
# ====================================================================

@resource_router.get("/graph/{book_name}")
async def get_graph(book_name: str) -> dict:
    """Return graph.json for a book (nodes + edges)."""
    graph_file = WIKI_ROOT / book_name / "graph.json"
    if not graph_file.is_file():
        return {"nodes": [], "edges": []}

    try:
        data = json.loads(graph_file.read_text(encoding="utf-8"))
        return {"nodes": data.get("nodes", []), "edges": data.get("edges", [])}
    except (json.JSONDecodeError, ValueError):
        return {"nodes": [], "edges": []}


# ====================================================================
# GET /api/pipeline/status — pipeline progress
# ====================================================================

@resource_router.get("/pipeline/status")
async def get_pipeline_status(book_name: str = Query(...)) -> dict:
    """Read .todo.json for pipeline status."""
    todo_file = WIKI_ROOT / book_name / ".todo.json"
    if not todo_file.is_file():
        return {
            "phase": 0,
            "total_chapters": 0,
            "completed_chapters": [],
            "total_nodes": 0,
            "completed_nodes": [],
            "graph_built": False,
            "started_at": "",
            "updated_at": "",
        }

    try:
        return json.loads(todo_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError):
        return {
            "phase": 0,
            "total_chapters": 0,
            "completed_chapters": [],
            "total_nodes": 0,
            "completed_nodes": [],
            "graph_built": False,
            "started_at": "",
            "updated_at": "",
        }


# ====================================================================
# POST /api/pipeline/start — trigger pipeline
# ====================================================================

@resource_router.post("/pipeline/start")
async def start_pipeline(background_tasks: BackgroundTasks, book_name: str = Query(...)) -> dict:
    """Trigger book_pipeline.run_book_pipeline as a background task."""
    from .services import book_pipeline

    background_tasks.add_task(book_pipeline.run_book_pipeline, book_name)
    return {"status": "started", "book_name": book_name}


# ====================================================================
# POST /api/dictionary — term lookup via rg + LLM
# ====================================================================

@resource_router.post("/dictionary")
async def dictionary_lookup(req: DictionaryQueryRequest) -> dict:
    """Search for a term in raw/wiki .md files via ripgrep + LLM."""
    from .services import rg_searcher

    card = rg_searcher.search(req.book_name, req.query)
    return card


# ====================================================================
# POST /api/upload — base64 file import
# ====================================================================

@resource_router.post("/upload")
async def upload_book(req: UploadRequest, background_tasks: BackgroundTasks, request: Request) -> dict:
    """Receive a PDF/EPUB/TXT file as base64, process via document_processor."""
    from .services import document_processor
    from .services.indexer_service import build_book_index

    api_key = request.headers.get("x-api-key", "")

    allowed_extensions = {".pdf", ".epub", ".txt", ".md", ".html", ".tex", ".docx"}
    ext = Path(req.filename or "").suffix.lower()
    if ext not in allowed_extensions:
        raise HTTPException(400, f"Unsupported file type: {ext}. Allowed: {', '.join(allowed_extensions)}")

    # Decode and save to temp file
    try:
        raw = base64.b64decode(req.data)
    except Exception:
        raise HTTPException(400, "Invalid base64 data")

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
            tmp.write(raw)
    except Exception:
        raise HTTPException(500, "Failed to write temp file")

    # Process via document processor pipeline
    try:
        result = document_processor.process_document(tmp_path, original_filename=req.filename)
    except Exception as e:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(500, f"Document processing failed: {e}")

    if tmp_path and os.path.exists(tmp_path):
        os.unlink(tmp_path)

    if result.get("status") == "failed":
        raise HTTPException(500, f"Processing failed: {result.get('error', 'unknown error')}")

    safe_title = result["safe_title"]

    # ── Pre-initialize .meta.json so the frontend sees "processing" immediately ──
    try:
        from .services.indexer_service import _write_meta, _read_meta
        meta = _read_meta(safe_title)
        meta["indexing_status"] = "processing"
        meta["indexed_chapters"] = 0
        meta["total_chapters"] = result.get("chapter_count", 0)
        _write_meta(safe_title, meta)
    except Exception:
        logger.warning("Failed to pre-initialize .meta.json for %s", safe_title)

    # ── Kick off background indexing ──
    background_tasks.add_task(build_book_index, safe_title, api_key)

    return {
        "status": "completed",
        "book_title": result["book_title"],
        "safe_title": result["safe_title"],
        "chapter_count": result["chapter_count"],
        "file_type": result["file_type"],
    }
