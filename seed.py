"""Initial data for a new Cage vault: empty and generic. Nothing is preloaded except one empty "Personal" project
(several screens need at least one project). Projects can also come from `~/.cage/settings.json` if it exists.
Goals are TARGETS, never results: they are always shown as goals and never count as income.
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path


def _id() -> str:
    return uuid.uuid4().hex[:10]


DEFAULT_PROJECTS = [{"id": "personal", "name": "Personal", "kind": "manual", "color": "#3E5BDB", "description": ""}]
KINDS = {"spike": "Open-source AI", "invest": "Investing", "git": "Software", "manual": "Project"}


def settings_projects(settings_path: Path) -> list[dict]:
    try:
        rows = json.loads(settings_path.read_text(encoding="utf-8")).get("projects") or []
    except (OSError, ValueError):
        rows = []
    return [r for r in rows if isinstance(r, dict) and r.get("id") and r.get("name")] or DEFAULT_PROJECTS


def seed(name: str = "you", settings_path: Path | None = None) -> dict:
    projects = []
    for r in settings_projects(settings_path or Path.home() / ".cage" / "settings.json"):
        folder = r.get("path") or ""
        projects.append({"id": r["id"], "name": r["name"], "letter": r["name"][0].upper(), "color": r.get("color") or "#3E5BDB",
                         "status": "active", "kind": KINDS.get(r.get("kind"), "Project"), "description": r.get("description") or "",
                         "folder": folder, "repo_paths": [folder] if folder and (Path(folder) / ".git").exists() else [],
                         "spike": r.get("kind") == "spike", "runs": r.get("runs") or "",
                         "links": [], "kpis": [], "milestones": [], "tasks": []})
    return {
        "schema": 1,
        "profile": {"name": name, "currency": "EUR"},
        "settings": {"idle_minutes": 15, "ai": {"endpoint": "http://127.0.0.1:8080/v1", "model": "", "enabled": True}},
        "projects": projects,
        "goals": [],
        "accounts": [], "budgets": [], "subscriptions": [],
        "health": {"profile": {}, "weights": [], "meals": [], "foods": [], "water": [], "exercise": [], "sleep": [], "plan": {}},
        "habits": [],
        "ledger": [],
        "portfolio": {"cash": 0, "holdings": [], "paper_trades": [], "paper_start": 10000},
        "chats": [],
        "notes": "",
        "audit": [],
        "created": time.strftime("%Y-%m-%d"),
    }
