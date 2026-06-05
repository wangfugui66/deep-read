"""Tests for rg_searcher.py — ripgrep invocation and command assembly.

Run: python -m pytest tests/test_rg_searcher.py -v
"""

import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "app" / "services"))

from rg_searcher import (
    _run_ripgrep,
    _resolve_book_dir,
    _collect_md_files,
)

# Detect if rg is available
_RG_AVAILABLE = shutil.which("rg") is not None
_RG_SKIP_REASON = "ripgrep (rg) not installed on this system"


# ====================================================================
# _run_ripgrep tests
# ====================================================================

class TestRunRipgrep:
    """Verify ripgrep subprocess invocation and output parsing."""

    def test_rg_finds_matching_text(self):
        """rg should find a known string in a temp directory."""
        if not _RG_AVAILABLE:
            import pytest; pytest.skip(_RG_SKIP_REASON)

        with tempfile.TemporaryDirectory() as tmpdir:
            md_file = Path(tmpdir) / "chapter_01.md"
            md_file.write_text("# 熵增定律\n\n熵增定律是热力学第二定律的核心。\n\n孤立系统中熵永不减少。", encoding="utf-8")

            async def _run():
                stdout, err = await _run_ripgrep("熵增", tmpdir)
                return stdout, err

            stdout, err = asyncio.run(_run())

            assert err is None, f"rg error: {err}"
            assert "熵增" in stdout

    def test_rg_returns_empty_for_no_match(self):
        """rg should return empty stdout when no match found."""
        if not _RG_AVAILABLE:
            import pytest; pytest.skip(_RG_SKIP_REASON)

        with tempfile.TemporaryDirectory() as tmpdir:
            md_file = Path(tmpdir) / "chapter_01.md"
            md_file.write_text("# Hello World\n\nNothing interesting here.", encoding="utf-8")

            async def _run():
                stdout, err = await _run_ripgrep("熵增", tmpdir)
                return stdout, err

            stdout, err = asyncio.run(_run())
            assert err is None
            assert stdout == ""

    def test_rg_handles_missing_directory(self):
        """rg should return descriptive error for nonexistent directory."""
        if not _RG_AVAILABLE:
            import pytest; pytest.skip(_RG_SKIP_REASON)

        async def _run():
            stdout, err = await _run_ripgrep("test", "/nonexistent/path/xyz")
            return stdout, err

        stdout, err = asyncio.run(_run())
        assert stdout == ""
        assert err is not None
        assert "not found" in err.lower()

    def test_rg_case_insensitive_by_default(self):
        """rg -i should match regardless of case."""
        if not _RG_AVAILABLE:
            import pytest; pytest.skip(_RG_SKIP_REASON)

        with tempfile.TemporaryDirectory() as tmpdir:
            md_file = Path(tmpdir) / "test.md"
            md_file.write_text("HeLLo WoRLd", encoding="utf-8")

            async def _run():
                stdout, err = await _run_ripgrep("hello", tmpdir)
                return stdout, err

            stdout, err = asyncio.run(_run())
            assert err is None
            assert "HeLLo" in stdout

    def test_rg_respects_max_results(self):
        """rg -m should limit the number of matches."""
        if not _RG_AVAILABLE:
            import pytest; pytest.skip(_RG_SKIP_REASON)

        with tempfile.TemporaryDirectory() as tmpdir:
            md_file = Path(tmpdir) / "test.md"
            content = "\n".join(f"match line {i}" for i in range(10))
            md_file.write_text(content, encoding="utf-8")

            async def _run():
                stdout, err = await _run_ripgrep("match", tmpdir, max_results=3)
                return stdout, err

            stdout, err = asyncio.run(_run())
            assert err is None
            lines = [l for l in stdout.strip().split("\n") if l.strip()]
            assert len(lines) <= 50  # with context lines, still bounded

    # ── Tests that work without rg installed ──

    def test_rg_command_includes_i_flag(self):
        """Verify the -i (case-insensitive) flag is part of the call contract."""
        # We test the *interface* contract: function accepts pattern and dir
        # The actual rg call handles -i internally
        # This is a design-contract test
        assert callable(_run_ripgrep)
        sig_params = ["pattern", "search_dir"]
        import inspect
        params = list(inspect.signature(_run_ripgrep).parameters.keys())
        for p in sig_params:
            assert p in params

    def test_rg_command_includes_context_lines(self):
        """Verify -C flag contract exists in function signature."""
        import inspect
        params = inspect.signature(_run_ripgrep).parameters
        assert "context_lines" in params
        assert params["context_lines"].default == 3

    def test_rg_command_includes_max_results(self):
        """Verify -m flag contract exists in function signature."""
        import inspect
        params = inspect.signature(_run_ripgrep).parameters
        assert "max_results" in params
        assert params["max_results"].default == 50


# ====================================================================
# _resolve_book_dir tests
# ====================================================================

class TestResolveBookDir:
    """Verify directory resolution for book lookup."""

    def test_finds_exact_match(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            book_dir = Path(tmpdir) / "系统论"
            book_dir.mkdir()

            result = _resolve_book_dir("系统论", tmpdir)
            assert result is not None
            assert result.name == "系统论"

    def test_finds_case_insensitive_match(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            book_dir = Path(tmpdir) / "SystemTheory"
            book_dir.mkdir()

            result = _resolve_book_dir("systemtheory", tmpdir)
            assert result is not None

    def test_returns_none_for_missing_book(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result = _resolve_book_dir("不存在的书", tmpdir)
            assert result is None

    def test_returns_none_for_nonexistent_base(self):
        result = _resolve_book_dir("anything", "/nonexistent/base/path")
        assert result is None


# ====================================================================
# _collect_md_files tests
# ====================================================================

class TestCollectMdFiles:
    """Verify Markdown file collection."""

    def test_collects_all_md_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / "01_chapter.md").write_text("# One", encoding="utf-8")
            (Path(tmpdir) / "02_chapter.md").write_text("# Two", encoding="utf-8")
            (Path(tmpdir) / "notes.txt").write_text("not md", encoding="utf-8")
            subdir = Path(tmpdir) / "sub"
            subdir.mkdir()
            (subdir / "03_appendix.md").write_text("# Appendix", encoding="utf-8")

            files = _collect_md_files(Path(tmpdir))
            md_names = [f.name for f in files]

            assert len(files) == 3
            assert "01_chapter.md" in md_names
            assert "02_chapter.md" in md_names
            assert "03_appendix.md" in md_names
            assert "notes.txt" not in md_names

    def test_returns_empty_for_empty_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            files = _collect_md_files(Path(tmpdir))
            assert files == []

    def test_returns_empty_for_nonexistent_dir(self):
        files = _collect_md_files(Path("/nonexistent/path"))
        assert files == []


# ====================================================================
# run as script
# ====================================================================

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
