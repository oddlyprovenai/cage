"""Obsidian notes by project, in READ-ONLY mode: never written to the vault.

Looks for Proyectos/<folder>/*.md, matches each folder to a Cage project by name (ignoring accents and
stop words) and returns status, open next steps, last log lines, and an obsidian:// link.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from urllib.parse import quote

STOP = {"de", "del", "la", "el", "los", "las", "y", "app", "ai", "ia", "the", "of", "and"}
MAX_BYTES = 256 * 1024


def _tokens(name: str) -> set[str]:
    plain = unicodedata.normalize("NFD", name.lower())
    plain = "".join(c for c in plain if unicodedata.category(c) != "Mn")
    words = set(re.findall(r"[a-z0-9]+", plain))
    return (words - STOP) or words


def match_folder(project_name: str, folders: list[str]) -> str | None:
    want = _tokens(project_name)
    best, score = None, 0.0
    for f in folders:
        have = _tokens(f)
        s = len(want & have) / max(1, len(want | have))
        if s > score:
            best, score = f, s
    return best if score >= 0.5 else None


def obsidian_url(vault: Path, note: Path) -> str:
    rel = note.relative_to(vault).with_suffix("").as_posix()
    return f"obsidian://open?vault={quote(vault.name, safe='')}&file={quote(rel, safe='')}"


def _section(text: str, title: str) -> list[str]:
    m = re.search(rf"^##\s+{re.escape(title)}[^\n]*\n(.*?)(?=^##\s|\Z)", text, re.M | re.S | re.I)
    return [ln.strip() for ln in m.group(1).splitlines() if ln.strip()] if m else []


def _plain(md: str) -> str:
    """Text stripped of Markdown marks and [[wiki]] links (displayed as text, never as HTML)."""
    md = re.sub(r"\[\[([^\]|]+)\|?([^\]]*)\]\]", lambda m: m.group(2) or m.group(1), md)
    return re.sub(r"[*_`]{1,3}", "", md).strip()


def summarize(vault: Path, note: Path) -> dict:
    text = note.read_bytes()[:MAX_BYTES].decode("utf-8", "replace")
    front = re.match(r"^---\n(.*?)\n---", text, re.S)
    estado = ""
    if front:
        m = re.search(r"^estado:\s*(.+)$", front.group(1), re.M)
        estado = m.group(1).strip() if m else ""
    steps = [re.sub(r"^- \[ \]\s*", "", ln) for ln in (_section(text, "Next steps") or _section(text, "Siguientes pasos")) if ln.startswith("- [ ]")]
    log = [ln.lstrip("- ").strip() for ln in (_section(text, "Log") or _section(text, "Registro")) if ln.startswith("-")]
    steps, log = [_plain(x) for x in steps], [_plain(x) for x in log]
    return {"title": note.stem, "url": obsidian_url(vault, note), "mtime": int(note.stat().st_mtime),
            "estado": estado, "steps": steps[:8], "log": log[-4:][::-1]}


def project_notes(vault: Path, projects: list[dict]) -> dict:
    if not vault.is_dir():
        return {"vault": str(vault), "error": "Obsidian vault not found", "projects": {}, "recent": []}
    base = vault / "Proyectos"
    folders = sorted(p.name for p in base.iterdir() if p.is_dir()) if base.is_dir() else []
    out: dict[str, dict] = {}
    for p in projects:
        f = match_folder(p.get("name", ""), folders)
        if not f:
            continue
        notes = sorted((base / f).glob("*.md"), key=lambda n: n.stat().st_mtime, reverse=True)
        main = next((n for n in notes if n.stem == f), notes[0] if notes else None)
        if main:
            out[p["id"]] = {"folder": f, "main": summarize(vault, main),
                            "notes": [{"title": n.stem, "url": obsidian_url(vault, n), "mtime": int(n.stat().st_mtime)}
                                      for n in notes[:6]]}
    recent = sorted((n for n in vault.rglob("*.md") if not ({".trash", ".obsidian", "Plantillas"} & set(n.parts))),
                    key=lambda n: n.stat().st_mtime, reverse=True)[:8]
    return {"vault": str(vault), "name": vault.name, "projects": out,
            "recent": [{"title": n.stem, "url": obsidian_url(vault, n), "mtime": int(n.stat().st_mtime),
                        "where": n.parent.relative_to(vault).as_posix()} for n in recent]}
