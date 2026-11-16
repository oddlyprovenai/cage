"""Backup OUTSIDE Cage's data folder, with rotation and restore test.

- The backup is the vault file as is: already encrypted (AES-256-GCM) and only opens with your password.
- Destination: chosen by you in Cage among available ones (external drive in /Volumes or your iCloud Drive folder).
  By default NO external destination is set: only daily local backups in ~/.cage/backups.
- Restore test: the file is copied to a temporary folder, its structure is checked and that the open
  session key decrypts data (without writing anything outside the temporary folder). The result is saved and shown in Cage.
"""
from __future__ import annotations

import json
import shutil
import tempfile
import time
from pathlib import Path

import vault

CFG = vault.HOME / "offsite.json"
ICLOUD = Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs"
SUB = "Cage-copias"
KEEP = 14


def config() -> dict:
    try:
        return json.loads(CFG.read_text())
    except (OSError, ValueError):
        return {"dest": None, "keep": KEEP}


def _save(c: dict) -> None:
    vault._atomic_write(CFG, json.dumps(c).encode())


def candidates() -> list[dict]:
    out = []
    try:
        for v in sorted(Path("/Volumes").iterdir()):
            if v.is_dir() and not v.is_symlink() and v.name not in ("Macintosh HD", "Recovery", "Preboot", "VM", "Data") and not v.name.startswith("com.apple"):
                out.append({"kind": "external drive", "name": v.name, "path": str(v / SUB)})
    except OSError:
        pass
    if ICLOUD.is_dir():
        out.append({"kind": "iCloud Drive", "name": "iCloud Drive", "path": str(ICLOUD / SUB),
                    "note": "uploaded to iCloud (encrypted: Apple cannot open it without your password)"})
    return out


def set_dest(path: str | None) -> dict:
    c = config()
    if path:
        allowed = {x["path"] for x in candidates()}
        if path not in allowed:
            raise ValueError("choose one of the destinations offered by Cage")
    c["dest"] = path or None
    _save(c)
    return c


def verify(file: Path, dek: bytes | None) -> dict:
    """Restore test in a temporary folder."""
    with tempfile.TemporaryDirectory(prefix="cage-restore-") as tmp:
        t = Path(tmp) / "vault.json"
        shutil.copy2(file, t)
        doc = json.loads(t.read_text())
        assert {"kdf", "keys", "data"} <= set(doc), "incomplete structure"
        assert "password" in doc["keys"], "missing password key"
        ok_data = None
        if dek is not None:
            data = json.loads(vault._open(dek, doc["data"], b"data"))
            ok_data = isinstance(data, dict) and "profile" in data
            assert ok_data, "data not recognized"
    return {"file": file.name, "ok": True, "decrypts": ok_data, "ts": int(time.time())}


def run(dek: bytes | None, force: bool = False) -> dict:
    """Today's backup to destination (if any) + restore test. Once a day unless `force`."""
    c = config()
    today = time.strftime("%Y%m%d")
    res = {"ts": int(time.time()), "dest": c.get("dest")}
    src = vault.daily_backup()
    if src is None:
        raise ValueError("no vault exists yet")
    target = src
    if c.get("dest"):
        d = Path(c["dest"])
        if not d.parent.exists():
            res.update(ok=False, error="destination is not available (drive disconnected?)")
            c["last"] = res
            _save(c)
            return res
        d.mkdir(mode=0o700, exist_ok=True)
        target = d / f"vault-{today}.json"
        if force or not target.exists():
            shutil.copy2(src, target.with_suffix(".tmp"))
            target.with_suffix(".tmp").replace(target)
        for old in sorted(d.glob("vault-*.json"))[:-int(c.get("keep", KEEP))]:
            old.unlink()
        res["copies"] = len(list(d.glob("vault-*.json")))
    try:
        res["check"] = verify(target, dek)
        res["ok"] = True
    except Exception as exc:  # noqa: BLE001 — reported in Cage
        res.update(ok=False, error=f"restore test failed: {str(exc)[:120]}")
    c["last"] = res
    if res.get("ok"):
        c["last_ok"] = res
    _save(c)
    return res


def due() -> bool:
    last = (config().get("last") or {}).get("ts", 0)
    return time.strftime("%Y%m%d", time.localtime(last)) != time.strftime("%Y%m%d")


def info() -> dict:
    c = config()
    return {**vault.backups_info(), "dest": c.get("dest"), "keep": c.get("keep", KEEP), "last": c.get("last"),
            "last_ok": c.get("last_ok"), "candidates": candidates()}
