"""Tests for book_pipeline.py — step-by-step verification of the pipeline.

Run: python -m pytest tests/test_book_pipeline.py -v
"""

import asyncio
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "app" / "services"))

from book_pipeline import (
    # Step 0
    _read_raw_chapters,
    _chunk_content,
    # Step 2 helpers
    _sanitize_filename,
    _build_filename,
    _build_bookshelf,
    _parse_node_md,
    # Step 3
    _build_graph_json,
    # State
    PipelineState,
)


# ====================================================================
# Step 0 — Chunking tests
# ====================================================================

class TestReadRawChapters:
    """Verify .md file reading from data/raw/sources/."""

    def test_reads_chapters_from_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_dir = Path(tmpdir)
            (raw_dir / "0000_第一章.md").write_text(
                "# 第一章 绪论\n\n内容第一段。\n\n内容第二段。", encoding="utf-8"
            )
            (raw_dir / "0001_第二章.md").write_text(
                "# 第二章 背景\n\n背景介绍。", encoding="utf-8"
            )

            chapters = _read_raw_chapters(raw_dir)
            assert len(chapters) == 2
            assert chapters[0]["title"] == "第一章 绪论"
            assert "内容第一段" in chapters[0]["content"]
            assert chapters[1]["title"] == "第二章 背景"

    def test_skips_full_book_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_dir = Path(tmpdir)
            book_name = raw_dir.name
            (raw_dir / f"{book_name}.md").write_text("# full book", encoding="utf-8")
            (raw_dir / "0000_第一章.md").write_text("# 第一章\n\n正文。", encoding="utf-8")

            chapters = _read_raw_chapters(raw_dir)
            assert len(chapters) == 1

    def test_raises_for_missing_directory(self):
        import pytest
        with pytest.raises(FileNotFoundError):
            _read_raw_chapters(Path("/nonexistent/dir"))


class TestChunkContent:
    """Verify content splitting for LLM context windows."""

    def test_no_split_for_short_content(self):
        content = "短内容"
        chunks = _chunk_content(content, max_chars=100)
        assert len(chunks) == 1
        assert chunks[0] == content

    def test_splits_at_paragraph_boundaries(self):
        p1 = "段落A " * 100  # ~600 chars
        p2 = "段落B " * 100
        content = f"{p1}\n\n{p2}"
        chunks = _chunk_content(content, max_chars=700)
        assert len(chunks) == 2
        assert chunks[0].strip() == p1.strip()
        assert chunks[1].strip() == p2.strip()

    def test_splits_long_paragraph(self):
        # A single paragraph exceeding max_chars
        long_para = "长内容 " * 500  # ~5000 chars
        chunks = _chunk_content(long_para, max_chars=800)
        assert len(chunks) > 1

    def test_empty_input(self):
        assert _chunk_content("") == [""]


# ====================================================================
# Step 2 — Filename & bookshelf helpers
# ====================================================================

class TestSanitizeFilename:
    """Verify safe filename generation."""

    def test_removes_special_chars(self):
        assert "/" not in _sanitize_filename("a/b")
        assert "\\" not in _sanitize_filename("a\\b")
        assert ":" not in _sanitize_filename("a:b")
        assert "<" not in _sanitize_filename("<tag>")

    def test_truncates_long_names(self):
        long_name = "A" * 200
        result = _sanitize_filename(long_name)
        assert len(result) <= 60

    def test_strips_trailing_underscores(self):
        assert _sanitize_filename("  test__ ") == "test"

    def test_untitled_fallback(self):
        assert _sanitize_filename("") == "untitled"
        assert _sanitize_filename("   ") == "untitled"


class TestBuildFilename:
    """Verify node filename convention: type-title.md."""

    def test_standard_format(self):
        result = _build_filename("concept", "耗散结构")
        assert result.endswith(".md")
        assert "concept" in result
        assert "耗散结构" in result

    def test_person_type(self):
        result = _build_filename("person", "普利高津")
        assert result.startswith("person-")


class TestBuildBookshelf:
    """Verify BOOKSHELF reference list for NODE_PROMPT."""

    def test_generates_wikilink_references(self):
        entities = [
            {"name": "耗散结构", "type": "concept"},
            {"name": "普利高津", "type": "person"},
        ]
        bookshelf = _build_bookshelf(entities)
        assert "concept-耗散结构" in bookshelf
        assert "person-普利高津" in bookshelf
        assert "[[" in bookshelf
        assert "]]" in bookshelf

    def test_empty_entities(self):
        assert _build_bookshelf([]) == ""


# ====================================================================
# Step 2 — Parse generated .md (YAML frontmatter + [[wikilinks]])
# ====================================================================

class TestParseNodeMd:
    """Verify parsing of Obsidian-compatible .md node files."""

    def test_parses_yaml_frontmatter(self):
        content = """---
type: concept
title: "耗散结构"
sources: ["第一章 绪论"]
---
正文内容，这是关于[[concept-熵增定律]]的讨论。

也参考了[[person-普利高津]]的研究。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            f = Path(tmpdir) / "concept-耗散结构.md"
            f.write_text(content, encoding="utf-8")

            result = _parse_node_md(f)
            assert result is not None
            assert result["type"] == "concept"
            assert result["label"] == "耗散结构"
            assert "第一章 绪论" in result["sources"]
            assert "concept-熵增定律" in result["wikilinks"]
            assert "person-普利高津" in result["wikilinks"]

    def test_handles_missing_frontmatter(self):
        content = "没有 frontmatter 的纯文本正文。"
        with tempfile.TemporaryDirectory() as tmpdir:
            f = Path(tmpdir) / "plain.md"
            f.write_text(content, encoding="utf-8")

            result = _parse_node_md(f)
            assert result is not None
            assert result["type"] == "concept"  # default

    def test_handles_no_wikilinks(self):
        content = """---
type: term
title: "普通术语"
---
没有链接的正文。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            f = Path(tmpdir) / "term-普通术语.md"
            f.write_text(content, encoding="utf-8")

            result = _parse_node_md(f)
            assert result is not None
            assert result["wikilinks"] == set()

    def test_extracts_multiple_sources(self):
        content = """---
type: concept
title: "系统论"
sources: ["第一章 绪论", "第二章 背景", "第三章 方法"]
---
正文。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            f = Path(tmpdir) / "concept-系统论.md"
            f.write_text(content, encoding="utf-8")

            result = _parse_node_md(f)
            assert result is not None
            assert len(result["sources"]) == 3
            assert "第二章 背景" in result["sources"]

    def test_handles_unreadable_file(self):
        result = _parse_node_md(Path("/nonexistent/node.md"))
        assert result is None


# ====================================================================
# Step 3 — Graph construction tests
# ====================================================================

class TestBuildGraphJson:
    """Verify 4-signal weighted graph construction from .md files."""

    def test_builds_graph_with_two_linked_nodes(self):
        """Two .md files with a mutual wikilink → an edge must exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)

            node_a = """---
type: concept
title: "耗散结构"
sources: ["第一章"]
---
这是耗散结构的内容。参见[[concept-熵增定律]]。"""
            node_b = """---
type: concept
title: "熵增定律"
sources: ["第一章"]
---
熵增定律的内容。"""
            (wiki_dir / "concept-耗散结构.md").write_text(node_a, encoding="utf-8")
            (wiki_dir / "concept-熵增定律.md").write_text(node_b, encoding="utf-8")

            graph = _build_graph_json(wiki_dir)
            # graph may be None if networkx not installed
            if graph is None:
                import pytest
                pytest.skip("networkx not installed — graph test skipped")

            assert graph is not None
            assert len(graph["nodes"]) == 2
            assert "concept-耗散结构" in [n["id"] for n in graph["nodes"]]
            assert "concept-熵增定律" in [n["id"] for n in graph["nodes"]]

            # Edge must exist: 耗散结构 → 熵增定律 (Signal 1: direct wikilink ×3.0)
            assert len(graph["edges"]) >= 1
            edge_ids = {(e["source"], e["target"]) for e in graph["edges"]}
            assert (
                ("concept-耗散结构", "concept-熵增定律") in edge_ids
                or ("concept-熵增定律", "concept-耗散结构") in edge_ids
            )

    def test_edge_weight_for_direct_wikilink(self):
        """Signal 1: direct wikilink → weight >= 3.0."""
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)

            (wiki_dir / "concept-A.md").write_text(
                "---\ntype: concept\ntitle: A\nsources: [\"Ch1\"]\n---\n[[concept-B]]", encoding="utf-8"
            )
            (wiki_dir / "concept-B.md").write_text(
                "---\ntype: concept\ntitle: B\nsources: [\"Ch1\"]\n---\n正文。", encoding="utf-8"
            )

            graph = _build_graph_json(wiki_dir)
            if graph is None:
                import pytest
                pytest.skip("networkx not installed")
            assert graph is not None
            assert len(graph["edges"]) == 1
            assert graph["edges"][0]["weight"] >= 3.0

    def test_source_overlap_weight(self):
        """Signal 2: shared sources → weight >= 4.0 per shared source."""
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)

            (wiki_dir / "concept-X.md").write_text(
                '---\ntype: concept\ntitle: X\nsources: ["Ch1", "Ch2"]\n---\n正文。', encoding="utf-8"
            )
            (wiki_dir / "concept-Y.md").write_text(
                '---\ntype: concept\ntitle: Y\nsources: ["Ch1", "Ch2"]\n---\n正文。', encoding="utf-8"
            )

            graph = _build_graph_json(wiki_dir)
            if graph is None:
                import pytest
                pytest.skip("networkx not installed")
            assert graph is not None
            # Both share Ch1 and Ch2 → 4.0 * 2 = 8.0 weight
            assert len(graph["edges"]) == 1
            assert graph["edges"][0]["weight"] >= 8.0

    def test_type_affinity_weight(self):
        """Signal 4: same type → weight >= 1.0 (type affinity)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)

            (wiki_dir / "person-A.md").write_text(
                '---\ntype: person\ntitle: "Person A"\nsources: ["Ch1"]\n---\n正文。', encoding="utf-8"
            )
            (wiki_dir / "person-B.md").write_text(
                '---\ntype: person\ntitle: "Person B"\nsources: ["Ch1"]\n---\n正文。', encoding="utf-8"
            )

            graph = _build_graph_json(wiki_dir)
            if graph is None:
                import pytest
                pytest.skip("networkx not installed")
            assert graph is not None
            # Both type=person → +1.0 type affinity
            assert len(graph["edges"]) >= 1

    def test_node_has_community_id(self):
        """Every node must have a community_id assigned."""
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)
            for i in range(5):
                (wiki_dir / f"concept-N{i}.md").write_text(
                    f'---\ntype: concept\ntitle: "Node {i}"\nsources: ["Ch1"]\n---\n[[concept-N{(i+1)%5}]]',
                    encoding="utf-8",
                )

            graph = _build_graph_json(wiki_dir)
            if graph is None:
                import pytest
                pytest.skip("networkx not installed")
            assert graph is not None
            for node in graph["nodes"]:
                assert "community_id" in node
                assert isinstance(node["community_id"], int)

    def test_node_has_coordinates(self):
        """Every node must have x, y layout coordinates."""
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)
            (wiki_dir / "concept-A.md").write_text(
                '---\ntype: concept\ntitle: A\nsources: ["Ch1"]\n---\n[[concept-B]]', encoding="utf-8"
            )
            (wiki_dir / "concept-B.md").write_text(
                '---\ntype: concept\ntitle: B\nsources: ["Ch1"]\n---\n正文。', encoding="utf-8"
            )

            graph = _build_graph_json(wiki_dir)
            if graph is None:
                import pytest
                pytest.skip("networkx not installed")
            assert graph is not None
            for node in graph["nodes"]:
                assert "x" in node
                assert "y" in node

    def test_outputs_graph_json_file(self):
        """Step 3 must write graph.json to the wiki directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)
            (wiki_dir / "concept-A.md").write_text(
                '---\ntype: concept\ntitle: A\nsources: ["Ch1"]\n---\n[[concept-B]]', encoding="utf-8"
            )
            (wiki_dir / "concept-B.md").write_text(
                '---\ntype: concept\ntitle: B\nsources: ["Ch1"]\n---\n正文。', encoding="utf-8"
            )

            _build_graph_json(wiki_dir)
            graph_path = wiki_dir / "graph.json"
            if not graph_path.exists():
                import pytest
                pytest.skip("networkx not installed — graph.json not written")
            assert graph_path.exists()

            # Verify JSON structure
            data = json.loads(graph_path.read_text(encoding="utf-8"))
            assert "nodes" in data
            assert "edges" in data
            assert len(data["nodes"]) == 2

    def test_no_edge_for_isolated_nodes(self):
        """Two nodes with no wikilinks, different types, and no shared sources → no edge."""
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)
            (wiki_dir / "concept-A.md").write_text(
                '---\ntype: concept\ntitle: A\nsources: ["Ch1"]\n---\n正文A。', encoding="utf-8"
            )
            (wiki_dir / "person-Z.md").write_text(
                '---\ntype: person\ntitle: Z\nsources: ["Ch2"]\n---\n正文Z。', encoding="utf-8"
            )

            graph = _build_graph_json(wiki_dir)
            if graph is None:
                import pytest
                pytest.skip("networkx not installed")
            assert graph is not None
            assert len(graph["edges"]) == 0

    def test_returns_none_for_single_node(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)
            (wiki_dir / "concept-solo.md").write_text(
                '---\ntype: concept\ntitle: Solo\n---\n孤独的节点。', encoding="utf-8"
            )

            graph = _build_graph_json(wiki_dir)
            assert graph is None  # < 2 nodes


# ====================================================================
# PipelineState tests
# ====================================================================

class TestPipelineState:
    """Verify checkpoint/state persistence."""

    def test_save_and_load_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)

            state = PipelineState(
                phase=1,
                total_chapters=10,
                completed_chapters=[0, 1, 2],
                started_at="2024-01-01T00:00:00",
            )
            state.save(wiki_dir)

            loaded = PipelineState.load(wiki_dir)
            assert loaded.phase == 1
            assert loaded.total_chapters == 10
            assert loaded.completed_chapters == [0, 1, 2]

    def test_load_fresh_state(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)
            state = PipelineState.load(wiki_dir)
            assert state.phase == 0
            assert state.total_chapters == 0
            assert state.completed_chapters == []
            assert state.graph_built is False

# ====================================================================
# run as script
# ====================================================================

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
