"""Read committed fixture evidence, never re-execute its Worker or provider calls."""
import json
from pathlib import Path
import time


def wait_for_phase_snapshot(path: Path, previous_mtime_ns: int, process, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('owned_process_exited')
        try:
            if path.stat().st_mtime_ns != previous_mtime_ns:
                # Jackson can create/truncate a file before flushing its last byte.
                # File existence and nonzero length are not completion evidence.
                value = json.loads(path.read_text())
                if isinstance(value, dict):
                    return value
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise RuntimeError('bounded_phase_snapshot_timeout')
