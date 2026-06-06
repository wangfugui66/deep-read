"""Atomic file-system operations for the "filesystem-as-database" architecture.

All JSON writes MUST use atomic_write_json() to prevent data corruption
from concurrent reader/writer scenarios (e.g. background indexer colliding
with foreground profile updates).
"""

import json as _json
import time as _time
from pathlib import Path
from typing import Union

# Windows high-frequency read/write collisions (e.g. 2s polling) can trigger
# PermissionError on os.replace(). A linear backoff retry resolves this safely.
_MAX_REPLACE_RETRIES = 6


def atomic_write_json(file_path: Union[Path, str], data: Union[dict, list]) -> None:
    """Write JSON data atomically via temp-file + replace with linear-backoff retry.

    1. Serialize ``data`` to a ``.tmp`` file alongside the target.
    2. Atomically rename (Path.replace) it over the target path.
    3. On PermissionError (Windows file lock), retry up to 6 times with
       linearly growing delay (0.05 s → 0.30 s).

    If all retries fail the exception is re-raised.  The temp file is
    cleaned up and the target file is never left in a partially-written state.
    """
    target = Path(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)

    tmp = target.with_suffix(target.suffix + ".tmp")

    try:
        tmp.write_text(
            _json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # ── Replace with linear-backoff retry for Windows file locks ──
        for attempt in range(_MAX_REPLACE_RETRIES):
            try:
                tmp.replace(target)
                break
            except PermissionError:
                if attempt == _MAX_REPLACE_RETRIES - 1:
                    raise
                _time.sleep(0.05 * (attempt + 1))  # 50 ms → 100 → 150 → … → 300 ms
    except Exception:
        # Best-effort cleanup — swallow errors so the original exception surfaces
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        raise
