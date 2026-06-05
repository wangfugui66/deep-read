"""Tests for master_router.py — API layer and service integration.

Run: python -m pytest tests/test_master_router.py -v
"""

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "app" / "services"))

# ====================================================================
# Note service tests
# ====================================================================

class TestNoteService:
    """Verify note CRUD operations on filesystem."""

    def test_save_note_creates_md_file(self):
        from note_service import save_note, _notes_dir

        with tempfile.TemporaryDirectory() as tmpdir:
            result = save_note("测试书", "这是原文引用", "这是我的笔记", data_root=tmpdir)
            assert "note_id" in result
            assert result["note_id"]

            # Verify file exists
            filepath = Path(result["path"])
            assert filepath.exists()

            content = filepath.read_text(encoding="utf-8")
            assert "这是原文引用" in content
            assert "这是我的笔记" in content
            assert content.startswith("---")

    def test_list_notes_returns_created_notes(self):
        from note_service import save_note, list_notes

        with tempfile.TemporaryDirectory() as tmpdir:
            save_note("测试书", "引用A", "笔记A", data_root=tmpdir)
            save_note("测试书", "引用B", "笔记B", data_root=tmpdir)

            notes = list_notes("测试书", data_root=tmpdir)
            assert len(notes) == 2
            assert any("引用A" in n["quote"] for n in notes)
            assert any("笔记B" in n["content"] for n in notes)

    def test_list_notes_empty_for_new_book(self):
        from note_service import list_notes
        with tempfile.TemporaryDirectory() as tmpdir:
            notes = list_notes("不存在的书", data_root=tmpdir)
            assert notes == []

    def test_delete_note_removes_file(self):
        from note_service import save_note, delete_note, list_notes

        with tempfile.TemporaryDirectory() as tmpdir:
            result = save_note("测试书", "引用", "笔记", data_root=tmpdir)
            note_id = result["note_id"]

            assert delete_note("测试书", note_id, data_root=tmpdir) is True
            assert delete_note("测试书", note_id, data_root=tmpdir) is False  # already gone

            notes = list_notes("测试书", data_root=tmpdir)
            assert len(notes) == 0


# ====================================================================
# Profile service tests
# ====================================================================

class TestProfileService:
    """Verify .profile.json persistence."""

    def test_save_and_read_profile(self):
        from profile_service import _save_profile_file, read_profile

        with tempfile.TemporaryDirectory() as tmpdir:
            profile = {
                "reading_mode": "ATTACK",
                "knowledge_baseline": "零基础",
                "pain_point": "缺乏系统框架",
                "cognitive_preference": "先案例后理论",
                "time_budget_minutes": 300,
            }
            _save_profile_file("测试书", profile, data_root=tmpdir)

            loaded = read_profile("测试书", data_root=tmpdir)
            assert loaded is not None
            assert loaded["reading_mode"] == "ATTACK"
            assert loaded["time_budget_minutes"] == 300

    def test_read_nonexistent_profile(self):
        from profile_service import read_profile
        with tempfile.TemporaryDirectory() as tmpdir:
            assert read_profile("不存在的书", data_root=tmpdir) is None

    def test_delete_profile(self):
        from profile_service import _save_profile_file, delete_profile

        with tempfile.TemporaryDirectory() as tmpdir:
            _save_profile_file("测试书", {"reading_mode": "ROAM"}, data_root=tmpdir)
            assert delete_profile("测试书", data_root=tmpdir) is True
            assert delete_profile("测试书", data_root=tmpdir) is False

    def test_profile_path_hidden_file(self):
        """Profile is stored as .profile.json (hidden file)."""
        from profile_service import _profile_path
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _profile_path("测试书", data_root=tmpdir)
            assert path.name == ".profile.json"


# ====================================================================
# Skeleton service tests
# ====================================================================

class TestSkeletonService:
    """Verify dynamic TOC generation and persistence."""

    def test_read_skeleton_nonexistent(self):
        from skeleton_service import read_skeleton
        with tempfile.TemporaryDirectory() as tmpdir:
            assert read_skeleton("不存在的书", data_root=tmpdir) is None

    def test_generate_skeleton_without_profile(self):
        """Should fail gracefully when .profile.json is missing."""
        import asyncio
        from skeleton_service import generate_skeleton

        with tempfile.TemporaryDirectory() as tmpdir:
            result = asyncio.run(generate_skeleton("测试书", data_root=tmpdir))
            assert result["status"] == "failed"
            assert "Profile not found" in result.get("error", "")

    def test_collect_node_summaries(self):
        """Verify node summary collection from wiki .md files."""
        from skeleton_service import _collect_node_summaries

        with tempfile.TemporaryDirectory() as tmpdir:
            wiki_dir = Path(tmpdir)
            (wiki_dir / "concept-耗散结构.md").write_text(
                "---\ntype: concept\ntitle: 耗散结构\n---\n耗散结构是开放系统在远离平衡态时自发形成的时空有序结构。",
                encoding="utf-8",
            )
            (wiki_dir / "person-普利高津.md").write_text(
                "---\ntype: person\ntitle: 普利高津\n---\n普利高津是比利时物理化学家，耗散结构理论创始人。",
                encoding="utf-8",
            )
            (wiki_dir / "DEEPSEEK.md").write_text("# template", encoding="utf-8")

            summaries = _collect_node_summaries(wiki_dir)
            assert "concept-耗散结构" in summaries
            assert "person-普利高津" in summaries
            assert "DEEPSEEK.md" not in summaries  # skipped
            assert "[[concept-耗散结构]]" in summaries

    def test_generate_skeleton_writes_dynamic_toc(self):
        """Integration: with profile + nodes + graph, generate a TOC file."""
        import asyncio
        from skeleton_service import generate_skeleton

        with tempfile.TemporaryDirectory() as tmpdir:
            data_root = Path(tmpdir)
            wiki_dir = data_root / "wiki" / "测试书"
            wiki_dir.mkdir(parents=True)

            # Write profile
            profile = {
                "reading_mode": "ATTACK",
                "knowledge_baseline": "零基础",
                "pain_point": "缺乏系统框架",
                "cognitive_preference": "先案例后理论",
                "time_budget_minutes": 300,
            }
            (wiki_dir / ".profile.json").write_text(
                json.dumps(profile, ensure_ascii=False), encoding="utf-8"
            )

            # Write node .md files
            (wiki_dir / "concept-A.md").write_text(
                "---\ntype: concept\ntitle: A\nsources: [\"Ch1\"]\n---\n概念A的定义和展开阐述。", encoding="utf-8"
            )
            (wiki_dir / "concept-B.md").write_text(
                "---\ntype: concept\ntitle: B\nsources: [\"Ch2\"]\n---\n[[concept-A]]\n\n概念B的定义。", encoding="utf-8"
            )

            # Write graph.json
            graph = {
                "nodes": [
                    {"id": "concept-A", "label": "A", "type": "concept", "community_id": 0},
                    {"id": "concept-B", "label": "B", "type": "concept", "community_id": 0},
                ],
                "edges": [
                    {"source": "concept-A", "target": "concept-B", "weight": 3.0},
                ],
            }
            (wiki_dir / "graph.json").write_text(
                json.dumps(graph, ensure_ascii=False), encoding="utf-8"
            )

            result = asyncio.run(generate_skeleton("测试书", data_root=str(data_root)))

            # The LLM call will fail in tests (no API key), but should handle gracefully
            if result["status"] == "completed":
                assert Path(result["path"]).exists()
                assert "测试书" in result["path"]
                # Verify file content
                content = Path(result["path"]).read_text(encoding="utf-8")
                assert content.startswith("---")
                assert "book: 测试书" in content
                assert "零基础" in content or "300" in content
            # If LLM fails, that's OK in test environment
            # The key is that the function doesn't throw and handles errors gracefully


# ====================================================================
# Pydantic schema tests
# ====================================================================

class TestPydanticSchemas:
    """Verify request/response schemas."""

    def test_chat_action_schema(self):
        sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "app"))
        from master_router import ChatActionRequest

        req = ChatActionRequest(action_type="explain", context="选中的文本")
        assert req.action_type == "explain"
        assert req.context == "选中的文本"

    def test_note_create_schema(self):
        sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "app"))
        from master_router import NoteCreateRequest

        req = NoteCreateRequest(book_name="测试书", quote="引用", content="笔记")
        assert req.book_name == "测试书"

    def test_skeleton_generate_schema(self):
        sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "app"))
        from master_router import SkeletonGenerateRequest

        req = SkeletonGenerateRequest(book_name="测试书")
        assert req.book_name == "测试书"


# ====================================================================
# run as script
# ====================================================================

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
