"""Ripgrep-based full-text search for book wiki + raw content.

Used by the /api/dictionary endpoint to find concepts, people, and terms
across all Markdown files in data/wiki/<book>/ and data/raw/sources/<book>/.
"""

import json as _json
import logging
import os
import subprocess
from pathlib import Path

from app.core.config import DATA_ROOT

logger = logging.getLogger("deepread.rg_searcher")

RG_PATH = "rg"  # ripgrep must be on PATH


def _find_rg() -> str | None:
    """Locate ripgrep binary on the system."""
    try:
        subprocess.run([RG_PATH, "--version"], capture_output=True, text=True, check=True)
        return RG_PATH
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


def search_book(book_name: str, query: str, max_results: int = 5) -> dict:
    """Search a book's content via ripgrep and return a formatted dictionary card.

    Returns a dict compatible with DictionaryCard on the frontend.
    Falls back to Python regex if rg is unavailable.
    """
    paths = _resolve_search_paths(book_name)
    if not paths:
        return {
            "term": query,
            "definition": "该书尚未完成文档处理，请先上传文件。",
            "context": "",
            "match_count": 0,
        }

    lines = _rg_search(paths, query, max_lines=max_results * 3)

    if not lines:
        # Try a wider search with just the first 2 chars in case it's encoding
        if len(query) >= 2:
            lines = _rg_search(paths, query[:2], max_lines=max_results * 2)

    if not lines:
        return {
            "term": query,
            "definition": "未找到匹配内容。",
            "context": "",
            "match_count": 0,
        }

    # Build definition from the first matched line
    definition = ""
    context_lines: list[str] = []
    matches: list[dict] = []

    for file_path, line_no, text in lines[:max_results * 3]:
        clean = text.strip()
        if not clean:
            continue
        if not definition and query.lower() in clean.lower():
            definition = clean[:200]
        else:
            context_lines.append(f"…{clean[:120]}")

        matches.append({
            "file": file_path,
            "line": line_no,
            "snippet": clean[:200],
        })

    return {
        "term": query,
        "definition": definition or f'找到与 "{query}" 相关的内容',
        "context": "\n".join(context_lines[:3]),
        "match_count": len(lines),
        "matches": matches[:max_results],
    }


def _resolve_search_paths(book_name: str) -> list[Path]:
    """Resolve the directories to search for a given book."""
    candidates = [
        DATA_ROOT / "wiki" / book_name,
        DATA_ROOT / "raw" / "sources" / book_name,
    ]
    return [p for p in candidates if p.is_dir()]


def _rg_search(paths: list[Path], query: str, max_lines: int) -> list[tuple[str, int, str]]:
    """Run ripgrep, return list of (file_path, line_no, line_text)."""
    bin_path = _find_rg()

    if bin_path:
        try:
            args = [
                bin_path,
                "--encoding", "utf-8",
                "--no-heading",
                "--with-filename",
                "--line-number",
                "--ignore-case",
                "--max-count", str(max_lines),
                "-g", "*.md",
                "--",
                query,
            ]
            # Add all search paths
            args.extend(str(p) for p in paths)

            proc = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=15,
                encoding="utf-8",
                errors="replace",
            )
            out = proc.stdout or ""
            return _parse_rg_output(out, paths)
        except Exception as e:
            logger.warning("ripgrep failed, falling back to Python: %s", e)

    # ── Python fallback ──
    return _py_grep(paths, query, max_lines)


def _parse_rg_output(output: str, search_paths: list[Path] | None = None) -> list[tuple[str, int, str]]:
    """Parse rg output like '/path/to/file.md:42:some line text' → (relative_path, line_no, text)."""
    results: list[tuple[str, int, str]] = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(":", 2)
        if len(parts) >= 3:
            try:
                line_no = int(parts[1])
                file_path = parts[0]
                # Convert absolute path to chapter-relative if possible
                if search_paths:
                    for sp in search_paths:
                        sp_str = str(sp).replace("\\", "/")
                        fp_str = file_path.replace("\\", "/")
                        if fp_str.startswith(sp_str + "/"):
                            file_path = fp_str[len(sp_str) + 1:]
                            break
                results.append((file_path, line_no, parts[2]))
            except ValueError:
                pass
    return results


def _py_grep(paths: list[Path], query: str, max_lines: int) -> list[tuple[str, int, str]]:
    """Fallback: pure Python search. Returns (relative_chapter_path, line_no, line_text)."""
    results: list[tuple[str, int, str]] = []
    q = query.lower()

    for search_dir in paths:
        for md_file in search_dir.rglob("*.md"):
            if len(results) >= max_lines:
                break
            try:
                content = md_file.read_text(encoding="utf-8", errors="replace")
                for i, line in enumerate(content.splitlines(), 1):
                    if q in line.lower():
                        # Return path relative to search_dir for chapter lookup
                        rel = str(md_file.relative_to(search_dir)) if search_dir in md_file.parents or search_dir == md_file.parent else str(md_file)
                        results.append((rel, i, line))
                        if len(results) >= max_lines:
                            break
            except Exception:
                continue

    return results
