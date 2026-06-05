"""test_indexer.py — sandbox test for build_book_index.

Run directly from the project root:
    cd D:\DeepRead-v2\backend
    python test_indexer.py

This bypasses FastAPI entirely and calls build_book_index via asyncio.run().
"""
import sys
import os
import io
import logging
from pathlib import Path

# Fix Windows console encoding for emoji
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Ensure backend/ is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Configure root logger to see everything
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)

# Also ensure DEEPSEEK_API_KEY is loaded from .env if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Discover available books ──
DATA_ROOT = Path(__file__).resolve().parent.parent / "data"
SOURCES = DATA_ROOT / "raw" / "sources"

print("=" * 60)
print("  test_indexer.py -- sandbox test")
print("=" * 60)
print(f"  DATA_ROOT = {DATA_ROOT}")
print(f"  SOURCES  = {SOURCES}")
print(f"  exists   = {SOURCES.is_dir()}")

books = sorted([p.name for p in SOURCES.iterdir() if p.is_dir()]) if SOURCES.is_dir() else []
print(f"  books    = {books}")
print(f"  DEEPSEEK_API_KEY set = {bool(os.environ.get('DEEPSEEK_API_KEY'))}")
print("=" * 60)

if not books:
    print("\n[FAIL] No book directories found under data/raw/sources/.")
    sys.exit(1)

# Pick the first book
BOOK_NAME = books[0]
print(f"\n[*] Selected book: {BOOK_NAME}")

if not os.environ.get("DEEPSEEK_API_KEY"):
    print("\n[FAIL] DEEPSEEK_API_KEY is not set.")
    print("       Set it via environment variable or .env file.")
    sys.exit(1)

# ── Import and run ──
from app.services.indexer_service import build_book_index

import asyncio

print(f"\n>>> Starting build_book_index(\"{BOOK_NAME}\") ...\n")
try:
    asyncio.run(build_book_index(BOOK_NAME, os.environ.get("DEEPSEEK_API_KEY", "")))
    print(f"\n[OK] build_book_index completed without exception.")
except Exception as e:
    print(f"\n[FAIL] build_book_index raised: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# ── Verify output ──
INDEX_FILE = DATA_ROOT / "wiki" / BOOK_NAME / "chapters_index.json"
META_FILE = DATA_ROOT / "wiki" / BOOK_NAME / ".meta.json"
print(f"\n[*] chapters_index.json exists: {INDEX_FILE.is_file()}")
print(f"[*] .meta.json exists:          {META_FILE.is_file()}")
if META_FILE.is_file():
    import json
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    print(f"    indexing_status = {meta.get('indexing_status')}")
    print(f"    indexed_chapters = {meta.get('indexed_chapters')}")
    print(f"    total_chapters = {meta.get('total_chapters')}")
