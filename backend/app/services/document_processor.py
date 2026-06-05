"""Document processor — pure file→Markdown pipeline. Zero database dependencies.

PDF  → pymupdf.open(file).get_toc() → TOC-based splitting (with LLM fallback)
EPUB → ebooklib TOC + BeautifulSoup anchor-based splitting
TXT  → direct read, single-chapter

Output: clean Markdown files written to data/raw/sources/<book_name>/
"""

import difflib
import json as _json
import logging
import os
import re
import shutil
from pathlib import Path

logger = logging.getLogger("deepread.processor")

# ====================================================================
# DEEPSEEK.md — static wiki template
# ====================================================================

DEEPSEEK_TEMPLATE = """# DEEPSEEK.md — AI 分析模板 (deepseek-v4-pro)

## 输出规范
- 使用 [[wikilink]] 建立节点间双向链接
- YAML frontmatter 必含: type, tags, related_chapters
- 正文 200-400 字，信息密度高

## 节点类型
- concept: 核心学术概念、理论框架
- term: 领域专有名词
- person: 重要学者、历史人物
- event: 关键历史事件或案例
"""

# ====================================================================
# Markdown text cleaner — strip OCR/conversion artifacts
# ====================================================================

_PICTURE_BLOCK_RE = re.compile(
    r'[\t\s]*\-+[\t\s]*Start of picture text[\t\s]*\-+.*?'
    r'[\t\s]*\-+[\t\s]*End of picture text[\t\s]*\-+'
    r'(?:[\t\s]*《[\t\s]*br[\t\s]*》[\t\s]*)?',
    re.DOTALL | re.IGNORECASE,
)

_BR_TAG_RE = re.compile(r'《\s*/?\s*br\s*/?\s*》', re.IGNORECASE)

_IMAGE_PLACEHOLDER_RE = re.compile(r'\s*\[图片\]\s*')

_SUP_REF_RE = re.compile(r'\s*<sup>\s*\[\d+\]\s*</sup>\s*', re.IGNORECASE)

_TAB_CLEANUP_RE = re.compile(r'[\t\x0b\x0c]+')

_HEADING_ADHESION_RE = re.compile(
    r'^(#{1,4}\s+[^\n]*?[\u4e00-\u9fff])([A-Za-z][^\n]+)$',
    re.MULTILINE,
)


def clean_markdown_text(text: str) -> str:
    """Strip OCR artifacts from chapter content.

    1. Remove picture text blocks: --- Start --- ... --- End --- (with optional **, tabs, trailing 《br》)
    2. Replace 《br》→ \\n, remove [图片], <sup>[N]</sup>, tabs
    3. Fix heading-body adhesion: "## Titlecontent" → "## Title\\n\\ncontent"
    """
    if not text:
        return text

    text = _PICTURE_BLOCK_RE.sub('', text)
    text = _BR_TAG_RE.sub('\n', text)
    text = _IMAGE_PLACEHOLDER_RE.sub('', text)
    text = _SUP_REF_RE.sub('', text)
    text = _TAB_CLEANUP_RE.sub(' ', text)
    text = _HEADING_ADHESION_RE.sub(r'\1\n\n\2', text)

    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


# ====================================================================
# Utility helpers
# ====================================================================

def _safe_book_dirname(title: str) -> str:
    """Sanitize a book title into a safe directory name."""
    name = re.sub(r'[\\/:*?"<>|]', '_', title.strip()).strip(' .')[:80]
    return name or "untitled"


def _ensure_dir(path: Path) -> Path:
    """Ensure a directory exists, create if needed."""
    path.mkdir(parents=True, exist_ok=True)
    return path


# ====================================================================
# PDF block-level extraction helpers
# ====================================================================

def _extract_page_blocks(doc: "fitz.Document", page_num: int) -> str:
    """Extract clean text from one PDF page via PyMuPDF block-level analysis.

    Filters:
      - Skip image blocks (block_type == 1)
      - Skip standalone page numbers (pure digits, short)
      - Skip header/footer regions (extreme top/bottom, short text)
    Within each valid block, merge mid-sentence continuation lines.
    Returns a string of paragraphs joined by \\n\\n.
    """
    page = doc[page_num]
    blocks = page.get_text("blocks")  # (x0,y0,x1,y1,text,block_no,block_type)
    page_height = page.rect.height

    valid_blocks: list[str] = []
    for x0, y0, x1, y1, text, _block_no, block_type in blocks:
        # Skip image blocks
        if block_type == 1:
            continue

        text = text.strip()
        if not text:
            continue

        # Skip standalone page numbers (pure 1-4 digit numbers, no surrounding text)
        if re.fullmatch(r'\d{1,4}', text):
            continue

        # Skip header/footer regions — extreme top/bottom, short text only
        is_edge = y0 < 65 or y1 > page_height - 65
        if is_edge and len(text) < 80:
            # Guard: don't skip if it looks like a chapter heading
            if not re.search(r'第.{1,6}[章篇部节]', text) and not re.search(r'(序言|前言|目录|引言|后记|参考)', text):
                continue

        # ── Within-block line merging ──
        lines = text.split('\n')
        merged: list[str] = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if merged and merged[-1] and not re.search(r'[。！？\.!\?）\)]"»]$', merged[-1]):
                # Previous line doesn't end with sentence-ending punctuation → continuation
                merged[-1] += line
            else:
                merged.append(line)
        valid_blocks.append(''.join(merged))

    return '\n\n'.join(valid_blocks)


# ====================================================================
# PDF Parser — TOC-guided splitting with difflib similarity matching
# ====================================================================

def _parse_pdf(file_path: str) -> dict:
    """Parse PDF using TOC page numbers with difflib similarity matching.

    Returns: {"chapters": [...], "full_text": ""}
    Each chapter: {"title", "order", "level", "parent_idx", "content", "page_start", "page_end"}
    """
    import fitz

    doc = fitz.open(file_path)
    toc = doc.get_toc()
    total_pages = len(doc)

    # ── Block-based extraction: process every page ──
    page_texts: list[str] = []
    for pn in range(total_pages):
        try:
            pt = _extract_page_blocks(doc, pn)
        except Exception:
            pt = ""
        page_texts.append(pt)

    # ── no TOC — fall back to LLM or single-chapter ──
    if not toc:
        full_text = "\n\n".join(p for p in page_texts if p)
        full_text = re.sub(r'^\s*[-_]{3,}\s*$', '', full_text, flags=re.MULTILINE)
        full_text = re.sub(r'\n{3,}', '\n\n', full_text)
        llm_chapters = _llm_detect_chapters(full_text)
        chapters = []
        if llm_chapters:
            for ch in llm_chapters:
                chapters.append({
                    "title": ch["title"], "order": len(chapters),
                    "level": ch.get("level", 1), "parent_idx": None,
                    "content": ch["content"].strip(),
                    "page_start": None, "page_end": None,
                })
        else:
            chapters.append({
                "title": "全文", "order": 0, "level": 1, "parent_idx": None,
                "content": full_text.strip(), "page_start": 1, "page_end": total_pages,
            })
        doc.close()
        return {"chapters": chapters, "full_text": full_text, "total_pages": total_pages}

    # ── 1. Build full text with per-page character offsets ──
    full_text = ""
    page_offsets: list[int] = []
    for pt in page_texts:
        page_offsets.append(len(full_text))
        full_text += pt + "\n\n"
    page_offsets.append(len(full_text))

    # ── 2. Locate TOC titles via wide-window difflib search ──
    toc_anchors: list[dict] = []
    for level, title, page_num in toc:
        title_clean = re.sub(r'[^\w]', '', title)
        if not title_clean:
            continue

        target_p = max(0, min(page_num - 1, len(page_offsets) - 2))
        win_start_page = max(0, target_p - 5)
        win_end_page = min(len(page_offsets) - 1, target_p + 10)
        win_start_char = page_offsets[win_start_page]
        win_end_char = page_offsets[win_end_page]
        search_area = full_text[win_start_char:win_end_char]

        best_ratio = 0.0
        best_start = -1
        best_end = -1

        for match in re.finditer(r'[^\n]+', search_area):
            line = match.group(0)
            if len(line) > 100:
                continue
            line_clean = re.sub(r'[^\w]', '', line)
            if not line_clean:
                continue
            ratio = difflib.SequenceMatcher(
                None, title_clean.lower(), line_clean.lower()
            ).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_start = win_start_char + match.start()
                best_end = win_start_char + match.end()

        if best_ratio >= 0.7:
            toc_anchors.append({
                "level": level, "title": title, "page_num": page_num,
                "start_idx": best_start, "end_idx": best_end,
            })
        else:
            toc_anchors.append({
                "level": level, "title": title, "page_num": page_num,
                "start_idx": -1, "end_idx": -1,
            })

    # ── 3. Collapse failed anchors ──
    last_valid_idx = 0
    for anchor in toc_anchors:
        if anchor["start_idx"] != -1 and anchor["start_idx"] >= last_valid_idx:
            last_valid_idx = anchor["end_idx"]
        else:
            anchor["start_idx"] = last_valid_idx
            anchor["end_idx"] = last_valid_idx

    # ── 4. Slice chapters ──
    chapters: list[dict] = []
    prev_parent: dict[int, int] = {}

    for i, curr in enumerate(toc_anchors):
        content_start = curr["end_idx"]
        content_end = toc_anchors[i + 1]["start_idx"] if i + 1 < len(toc_anchors) else len(full_text)
        raw = full_text[content_start:content_end].strip()

        # Light cleanup only — block extraction already handles paragraphs
        raw = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', raw)
        raw = raw.replace('<', '《').replace('>', '》')
        raw = re.sub(r'\n{3,}', '\n\n', raw)

        is_reference = any(kw in curr["title"] for kw in ["注释", "参考", "文献", "附录", "注脚"])
        if not is_reference:
            raw = re.sub(r'\[(\d+)\]', r'<sup>[\1]</sup>', raw)

        parent_idx = None
        if curr["level"] > 1:
            for lvl in range(curr["level"] - 1, 0, -1):
                if lvl in prev_parent:
                    parent_idx = prev_parent[lvl]
                    break

        content = raw.strip()
        if len(content) >= 20:
            chapters.append({
                "title": curr["title"],
                "order": len(chapters),
                "level": curr["level"],
                "parent_idx": parent_idx,
                "content": content,
                "page_start": curr["page_num"],
                "page_end": toc_anchors[i + 1]["page_num"] if i + 1 < len(toc_anchors) else total_pages,
            })

        prev_parent[curr["level"]] = len(chapters) - 1
        for lvl in list(prev_parent.keys()):
            if lvl > curr["level"]:
                del prev_parent[lvl]

    doc.close()
    return {"chapters": chapters, "full_text": full_text, "total_pages": total_pages}


def _llm_detect_chapters(full_text: str) -> list[dict] | None:
    """LLM fallback: detect chapter headings when PDF has no TOC."""
    try:
        import os as _os
        from openai import OpenAI

        client = OpenAI(
            api_key=_os.environ.get("DEEPSEEK_API_KEY", ""),
            base_url=_os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        )

        sample = full_text[:8000]
        prompt = (
            "分析以下文本，找出所有章节标题（如'第一章 绪论'、'第1章 引言'、'再版序一'等）。"
            "返回严格JSON数组，每个元素包含 title（完整标题文字）和 level（1=章/序, 2=节）：\n"
            '[{"title": "第一章 绪论", "level": 1}, {"title": "1.1 背景", "level": 2}]\n'
            "只返回在正文中实际出现的标题，不要猜测。最多返回20个。\n\n"
            f"文本:\n{sample[:6000]}"
        )

        response = client.chat.completions.create(
            model="deepseek-v4-pro",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=800,
        )

        raw = response.choices[0].message.content.strip() if response.choices[0].message.content else "[]"
        match = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', raw, re.DOTALL)
        clean = match.group(1) if match else raw
        titles = _json.loads(clean)

        if not isinstance(titles, list) or len(titles) < 2:
            return None

        entries = []
        for t in titles:
            title = t.get("title", "").strip()
            if title and len(title) >= 3:
                entries.append({"title": title, "level": t.get("level", 1)})
        if len(entries) < 2:
            return None

        positions = []
        for e in entries:
            pos = full_text.find(e["title"])
            if pos < 0:
                keyword = e["title"][:6]
                pos = full_text.find(keyword)
            if pos >= 0:
                positions.append((pos, e["title"], e["level"]))
        if len(positions) < 2:
            return None

        positions.sort(key=lambda x: x[0])
        seen = set()
        unique = []
        for pos, title, level in positions:
            if title not in seen:
                seen.add(title)
                unique.append((pos, title, level))

        chapters = []
        for i, (pos, title, level) in enumerate(unique):
            start = pos
            end = unique[i + 1][0] if i + 1 < len(unique) else len(full_text)
            content = full_text[start:end].strip()
            if len(content) >= 50:
                chapters.append({"title": title, "content": content, "level": level})

        return chapters if chapters else None
    except Exception:
        return None


# ====================================================================
# EPUB Parser — TOC-based anchor splitting
# ====================================================================

def _parse_epub(file_path: str) -> dict:
    """Parse EPUB: use TOC hrefs to split content at HTML anchor positions.

    Returns: {"chapters": [...], "full_text": ""}
    """
    from ebooklib import epub
    from bs4 import BeautifulSoup

    book = epub.read_epub(file_path)
    toc_entries = []
    _flatten_toc(book.toc, toc_entries, level=1)
    if not toc_entries:
        return {"chapters": [], "full_text": ""}

    prev_at_level = {}
    for i, entry in enumerate(toc_entries):
        level = entry["level"]
        entry["parent_idx"] = None
        if level > 1:
            for lvl in range(level - 1, 0, -1):
                if lvl in prev_at_level:
                    entry["parent_idx"] = prev_at_level[lvl]
                    break
        prev_at_level[level] = i
        for lvl in list(prev_at_level.keys()):
            if lvl > level:
                del prev_at_level[lvl]

    spine_ids = [item_id for item_id, _linear in book.spine]
    html_files = {}

    for item in book.get_items():
        if item.get_type() != 9 or item.id not in spine_ids:
            continue
        try:
            soup = BeautifulSoup(item.get_content(), "html.parser")
            text = soup.get_text(separator="\n")
            html_files[item.get_name()] = (soup, text)
        except Exception:
            continue

    for entry in toc_entries:
        href = entry.get("href", "")
        filename, anchor = _parse_href(href)
        if filename in html_files:
            soup, text = html_files[filename]
            if anchor:
                elem = soup.find(id=anchor)
                if elem:
                    anchor_text = elem.get_text(strip=True)[:80]
                    pos = text.find(anchor_text)
                    entry["_content_start"] = pos if pos >= 0 else 0
                else:
                    entry["_content_start"] = 0
            else:
                entry["_content_start"] = 0
            entry["_filename"] = filename
        else:
            entry["_content_start"] = -1

    filename_order = {name: i for i, name in enumerate(html_files.keys())}

    def sort_key(entry):
        fn = entry.get("_filename", "")
        pos = entry.get("_content_start", -1)
        return (filename_order.get(fn, 999), pos)

    sorted_entries = sorted(
        [e for e in toc_entries if e.get("_content_start", -1) >= 0],
        key=sort_key
    )

    chapters = []
    full_text_parts = []
    for i, entry in enumerate(sorted_entries):
        filename = entry.get("_filename", "")
        if filename not in html_files:
            continue
        _, file_text = html_files[filename]
        start = entry["_content_start"]
        end = len(file_text)
        for j in range(i + 1, len(sorted_entries)):
            if sorted_entries[j].get("_filename") == filename:
                next_start = sorted_entries[j].get("_content_start", 0)
                if next_start > start:
                    end = next_start
                    break

        raw = file_text[start:end].strip()
        if len(raw) < 20:
            continue

        full_text_parts.append(raw)
        chapters.append({
            "title": entry["title"],
            "order": len(chapters),
            "level": entry["level"],
            "parent_idx": entry.get("parent_idx"),
            "content": raw,
            "page_start": None,
            "page_end": None,
            "_original_idx": entry.get("_original_idx"),
        })

    # Remap parent_idx
    idx_map = {}
    for i, ch in enumerate(chapters):
        old = ch.get("_original_idx")
        if old is not None:
            idx_map[old] = i
        del ch["_original_idx"]
    for ch in chapters:
        old_parent = ch.get("parent_idx")
        if old_parent is not None and old_parent in idx_map:
            ch["parent_idx"] = idx_map[old_parent]
        else:
            ch["parent_idx"] = None

    return {"chapters": chapters, "full_text": "\n\n".join(full_text_parts)}


def _flatten_toc(toc, result, level):
    """Recursively flatten ebooklib nested TOC into a flat list."""
    if not toc:
        return
    for entry in toc:
        children = None
        if isinstance(entry, tuple):
            heading = entry[0]
            children = entry[1] if len(entry) > 1 else []
        elif hasattr(entry, "title"):
            heading = entry
        else:
            continue
        title = heading.title.strip() if hasattr(heading, "title") and heading.title else ""
        href = heading.href if hasattr(heading, "href") and heading.href else ""
        if title:
            result.append({"title": title, "href": href, "level": level, "_original_idx": len(result)})
        if children:
            _flatten_toc(children, result, level + 1)


def _parse_href(href):
    """Split href into (filename, anchor_id)."""
    if not href:
        return ("", "")
    parts = href.split("#", 1)
    return (parts[0] if parts[0] else "", parts[1] if len(parts) > 1 else "")


# ====================================================================
# TXT / MD / HTML / TeX / DOCX — direct read
# ====================================================================

def _parse_plain(file_path: str) -> dict:
    """Direct read for plain-text and simple formats."""
    text = Path(file_path).read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        raise ValueError("File is empty or unreadable")
    return {
        "chapters": [{"title": "全文", "order": 0, "level": 1, "parent_idx": None,
                       "content": text.strip(), "page_start": None, "page_end": None}],
        "full_text": text.strip(),
    }


# ====================================================================
# Format dispatch
# ====================================================================

PROCESSORS = {
    "pdf":  _parse_pdf,
    "epub": _parse_epub,
    "txt":  _parse_plain,
    "md":   _parse_plain,
    "html": _parse_plain,
    "tex":  _parse_plain,
    "docx": _parse_plain,
}


# ====================================================================
# Pure pipeline: input path → output to data/raw/sources/
# ====================================================================

def process_document(file_path: str, output_root: str | None = None, *, original_filename: str = "") -> dict:
    """Parse a document and write clean Markdown to data/raw/sources/<book>/.

    This is a pure function — no database, no network, no side effects
    beyond writing files to the output directory.

    Args:
        file_path:   Absolute path to the source document (PDF/EPUB/TXT/...).
        output_root: Root directory for output (default: data/raw/sources/).

    Returns:
        {
            "status":        "completed" | "failed",
            "book_title":    str,
            "safe_title":    str,
            "file_type":     str,
            "chapter_count": int,
            "output_dir":    Path to the book's output directory,
            "wiki_dir":      Path to data/wiki/<book> (sibling directory),
            "full_text":     str (concatenated Markdown),
        }
    """
    if output_root is None:
        output_root = Path(__file__).parent.parent.parent / "data" / "raw" / "sources"
    output_root = Path(output_root)
    _ensure_dir(output_root)

    # Detect file type
    ext = Path(file_path).suffix.lower().lstrip(".")
    file_type = ext if ext in PROCESSORS else "txt"

    # Run parser
    processor = PROCESSORS.get(file_type, _parse_plain)
    try:
        result = processor(file_path)
    except (ValueError, FileNotFoundError, OSError) as exc:
        return {
            "status": "failed",
            "book_title": "",
            "safe_title": "",
            "file_type": file_type,
            "chapter_count": 0,
            "output_dir": str(output_root),
            "wiki_dir": "",
            "full_text": "",
            "error": str(exc),
        }
    chapters = result.get("chapters", [])
    full_text = result.get("full_text", "")

    if not full_text:
        return {
            "status": "failed",
            "book_title": "",
            "safe_title": "",
            "file_type": file_type,
            "chapter_count": 0,
            "output_dir": str(output_root),
            "wiki_dir": "",
            "full_text": "",
            "error": "Parser produced empty output",
        }

    # Derive book title — prefer original filename over temp path stem
    book_title = Path(original_filename).stem if original_filename else Path(file_path).stem
    safe_title = _safe_book_dirname(book_title)

    # ── Write to data/raw/sources/<safe_title>/ ──
    book_dir = output_root / safe_title
    _ensure_dir(book_dir)

    # Full book markdown
    book_md_path = book_dir / f"{safe_title}.md"
    book_md_path.write_text(full_text, encoding="utf-8")
    logger.info("Full book MD saved to %s", book_md_path)

    # Individual chapter markdown files
    for ch in chapters:
        content = clean_markdown_text(ch.get("content", ""))
        ch_safe = re.sub(r'[\\/*?:"<>|]', '_', ch["title"])[:60]
        ch_path = book_dir / f"{ch['order']:04d}_{ch_safe}.md"
        header = f"# {ch['title']}\n\n"
        ch_path.write_text(header + content, encoding="utf-8")

    # ── Write to data/wiki/<safe_title>/ (sibling wiki directory) ──
    wiki_root = output_root.parent.parent / "wiki"
    wiki_dir = wiki_root / safe_title
    _ensure_dir(wiki_dir)

    # DEEPSEEK.md template
    deepseek_path = wiki_dir / "DEEPSEEK.md"
    if not deepseek_path.exists():
        deepseek_path.write_text(DEEPSEEK_TEMPLATE, encoding="utf-8")

    logger.info("Document processed: %s → %d chapters → %s", file_path, len(chapters), book_dir)

    return {
        "status": "completed",
        "book_title": book_title,
        "safe_title": safe_title,
        "file_type": file_type,
        "chapter_count": len(chapters),
        "output_dir": str(book_dir),
        "wiki_dir": str(wiki_dir),
        "full_text": full_text,
    }
