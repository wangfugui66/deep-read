"""Single source of truth for project-wide paths.

Every module MUST import DATA_ROOT from here instead of computing
Path(__file__).resolve().parent... / "data" locally.
"""

from pathlib import Path

# Always resolves to <project_root>/data/ (e.g. D:\DeepRead-v2\data)
DATA_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "data"
