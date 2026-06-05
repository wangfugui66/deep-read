"""Tests for document_processor.py — pure Markdown cleaning and parsing.

Run: python -m pytest tests/test_document_processor.py -v
"""

import os
import sys
import tempfile
from pathlib import Path

# Ensure services/ is importable
sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "app" / "services"))

from document_processor import clean_markdown_text, PROCESSORS, process_document


# ====================================================================
# clean_markdown_text() tests
# ====================================================================

class TestCleanMarkdownText:
    """Verify OCR artifact removal and text cleanup."""

    def test_removes_picture_blocks(self):
        text = (
            "这是正文内容。\n"
            "**--- Start of picture text ---**\n"
            "Some garbage picture OCR text here\n"
            "**--- End of picture text ---**\n"
            "正文继续。"
        )
        result = clean_markdown_text(text)
        assert "Start of picture text" not in result
        assert "End of picture text" not in result
        assert "garbage picture OCR" not in result
        assert "这是正文内容" in result
        assert "正文继续" in result

    def test_replaces_br_tags(self):
        text = "第一行《br》第二行《br》第三行"
        result = clean_markdown_text(text)
        assert "《br》" not in result
        assert "\n" in result

    def test_removes_standalone_image_placeholders(self):
        text = "正文 [图片] 继续"
        result = clean_markdown_text(text)
        assert "[图片]" not in result
        assert "正文" in result
        assert "继续" in result

    def test_fixes_heading_adhesion(self):
        text = "## 第一章content starts here without newline"
        result = clean_markdown_text(text)
        assert "\n\ncontent" in result

    def test_fixes_heading_adhesion_h1(self):
        text = "# 标题Body text immediately follows"
        result = clean_markdown_text(text)
        assert "# 标题" in result
        assert "\n\nBody text" in result

    def test_fixes_heading_adhesion_h3(self):
        text = "### 1.1 背景简介body text"
        result = clean_markdown_text(text)
        assert "### 1.1 背景简介" in result
        assert "\n\nbody text" in result

    def test_collapses_excess_blank_lines(self):
        text = "Line one\n\n\n\n\nLine two\n\n\nLine three"
        result = clean_markdown_text(text)
        # No more than 2 consecutive newlines
        assert "\n\n\n" not in result
        # But paragraphs should still be separated by double newline
        assert "Line one\n\nLine two" in result

    def test_empty_string_returns_empty(self):
        assert clean_markdown_text("") == ""

    def test_none_input(self):
        assert clean_markdown_text(None) is None

    def test_preserves_valid_markdown(self):
        text = "## 章节标题\n\n这是正文段落。\n\n这是另一个段落，包含**加粗**文字。"
        result = clean_markdown_text(text)
        assert "## 章节标题" in result
        assert "这是正文段落" in result
        assert "**加粗**" in result

    def test_strips_trailing_whitespace(self):
        text = "  正文内容  \n\n  "
        result = clean_markdown_text(text)
        assert result == "正文内容"


# ====================================================================
# PROCESSORS dispatch tests
# ====================================================================

class TestProcessorDispatch:
    """Verify format dispatch table is correctly populated."""

    def test_pdf_processor_registered(self):
        assert "pdf" in PROCESSORS
        assert callable(PROCESSORS["pdf"])

    def test_epub_processor_registered(self):
        assert "epub" in PROCESSORS
        assert callable(PROCESSORS["epub"])

    def test_txt_processor_registered(self):
        assert "txt" in PROCESSORS
        assert callable(PROCESSORS["txt"])

    def test_md_processor_registered(self):
        assert "md" in PROCESSORS
        assert callable(PROCESSORS["md"])


# ====================================================================
# process_document() integration tests
# ====================================================================

class TestProcessDocument:
    """Verify the pure file→file pipeline works end-to-end."""

    def test_process_txt_file(self):
        """Parse a simple .txt file and verify output files exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a test .txt file
            txt_path = Path(tmpdir) / "test_book.txt"
            txt_path.write_text("# 测试标题\n\n这是第一段内容。\n\n这是第二段。", encoding="utf-8")

            output_root = Path(tmpdir) / "output"
            result = process_document(str(txt_path), str(output_root))

            assert result["status"] == "completed"
            assert result["file_type"] == "txt"
            assert result["chapter_count"] == 1

            # Verify raw/sources/ output
            raw_dir = Path(result["output_dir"])
            assert raw_dir.exists()
            book_md = raw_dir / f"{result['safe_title']}.md"
            assert book_md.exists()
            content = book_md.read_text(encoding="utf-8")
            assert "测试标题" in content

            # Verify wiki/ output
            wiki_dir = Path(result["wiki_dir"])
            assert wiki_dir.exists()
            deepseek_md = wiki_dir / "DEEPSEEK.md"
            assert deepseek_md.exists()
            assert "wikilink" in deepseek_md.read_text(encoding="utf-8")

    def test_process_unknown_extension_falls_back_to_txt(self):
        """Unrecognized extensions should default to plain text parser."""
        with tempfile.TemporaryDirectory() as tmpdir:
            txt_path = Path(tmpdir) / "test.xyz"
            txt_path.write_text("Hello World", encoding="utf-8")

            output_root = Path(tmpdir) / "output"
            result = process_document(str(txt_path), str(output_root))

            assert result["status"] == "completed"
            assert result["chapter_count"] == 1

    def test_process_empty_file_returns_failed(self):
        """Empty files should return status=failed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            txt_path = Path(tmpdir) / "empty.txt"
            txt_path.write_text("", encoding="utf-8")

            output_root = Path(tmpdir) / "output"
            result = process_document(str(txt_path), str(output_root))

            assert result["status"] == "failed"
            assert "empty" in result.get("error", "").lower() or result["full_text"] == ""


# ====================================================================
# run as script
# ====================================================================

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
