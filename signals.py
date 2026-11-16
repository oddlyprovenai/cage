"""Facts the dashboard reads by itself, never writes: git activity of each project folder and SPIKE's own records.

Everything here is read-only and local. Money is never inferred: earnings and costs come only from what you enter.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

DAY = 86400


def git_activity(folder: Path, now: float | None = None) -> dict | None:
    """Commits per week for the last 12 weeks, last commit and branch; None when the folder is not a git checkout."""
    if not (folder / ".git").exists():
        return None
    import subprocess

    now = time.time() if now is None else now
    try:
        out = subprocess.run(["git", "-C", str(folder), "log", "--all", f"--since={int(now - 84 * DAY)}",
                              "--format=%ct"], capture_output=True, text=True, timeout=10, check=True).stdout
        branch = subprocess.run(["git", "-C", str(folder), "branch", "--show-current"], capture_output=True,
                                text=True, timeout=10, check=False).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    stamps = [int(x) for x in out.split()]
    weeks = [0] * 12
    for t in stamps:
        weeks[min(11, int((now - t) // (7 * DAY)))] += 1
    return {"weeks": list(reversed(weeks)), "last_commit": max(stamps) if stamps else None, "branch": branch,
            "commits_30d": sum(1 for t in stamps if now - t <= 30 * DAY)}


def spike_status(repo: Path, runs: Path | None = None) -> dict:
    """The team board's counts and each training run's last pipeline line, from SPIKE's own files."""
    status: dict = {"board": None, "training": []}
    tasks = repo / "docs" / "team" / "tasks.json"
    if tasks.is_file():
        rows = json.loads(tasks.read_text(encoding="utf-8"))["tasks"]
        by = {}
        for t in rows:
            by[t["status"]] = by.get(t["status"], 0) + 1
        status["board"] = {"total": len(rows), "by_status": by,
                           "open": [{"id": t["id"], "owner": t["owner"], "title": t["title"], "status": t["status"]}
                                    for t in rows if t["status"] != "done"][:25]}
    for folder in sorted((runs or repo / "training" / "runs").glob("*")):
        log = folder / "pipeline.log" if (folder / "pipeline.log").is_file() else folder / "fix_forgetting.log"
        verdict = None
        final = folder / "sweep" / "final" / "summary.json"
        if final.is_file():
            acc = json.loads(final.read_text(encoding="utf-8")).get("acceptance") or {}
            verdict = "aceptado" if any(v.get("accepted") for v in acc.values()) else "rechazado"
        sweep = folder / "sweep" / "summary.json"
        if verdict is None and sweep.is_file() and not json.loads(sweep.read_text(encoding="utf-8")).get("chosen"):
            verdict = "rechazado"  # a finished sweep that chose no candidate never runs the acceptance suites
        if log.is_file():
            last = log.read_text(encoding="utf-8").strip().splitlines()[-1:] or [""]
            status["training"].append({"specialist": folder.name, "last": last[0][:200], "verdict": verdict})
    return status
