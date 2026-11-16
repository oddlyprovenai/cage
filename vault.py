"""Cage encrypted vault.

Envelope encryption: a random 256-bit data encryption key (DEK) encrypts
data with AES-256-GCM. The DEK is stored wrapped (also with AES-GCM) by:
  - your password (KEK derived with scrypt), and
  - optionally, an agent token (for Claude to configure via the CLI).
Without password or token, the file is unreadable.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import tempfile
import time
from pathlib import Path



def AESGCM(key: bytes):  # noqa: N802 - lazy import: cryptography (~5 MB) is only loaded when unlocking or creating
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM as _AESGCM

    return _AESGCM(key)

HOME = Path(os.environ.get("CAGE_HOME", Path.home() / ".cage"))
VAULT = HOME / "vault.json"
AGENT_KEY = HOME / "agent.key"
BACKUPS = HOME / "backups"
SCRYPT = {"n": 2 ** 15, "r": 8, "p": 1}
MIN_PASSWORD = 12


class VaultError(Exception):
    pass


def b64e(b: bytes) -> str:
    return base64.b64encode(b).decode()


def b64d(s: str) -> bytes:
    return base64.b64decode(s.encode())


def ensure_home() -> None:
    HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(HOME, 0o700)
    BACKUPS.mkdir(mode=0o700, exist_ok=True)


_SCRYPT_CHILD = ("import sys,json,hashlib,base64;a=json.loads(sys.stdin.read());"
                 "sys.stdout.write(base64.b64encode(hashlib.scrypt(a['pw'].encode(),salt=base64.b64decode(a['salt']),"
                 "n=a['n'],r=a['r'],p=a['p'],maxmem=134217728,dklen=32)).decode())")


def _kek_password(password: str, salt: bytes, p: dict) -> bytes:
    """scrypt needs 32 MB that the process does not return to the system; it is calculated in an ephemeral child
    process (the password travels via stdin, never in arguments) to keep the server small. If the child fails, in-process."""
    import subprocess
    import sys

    try:
        out = subprocess.run([sys.executable, "-I", "-S", "-c", _SCRYPT_CHILD], capture_output=True, timeout=60,
                             check=True, input=json.dumps({"pw": password, "salt": b64e(salt), "n": p["n"],
                                                           "r": p["r"], "p": p["p"]}).encode())
        key = b64d(out.stdout.decode())
        if len(key) == 32:
            return key
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=p["n"], r=p["r"], p=p["p"],
                          maxmem=128 * 1024 * 1024, dklen=32)


def _kek_agent(token: bytes, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", token, salt + b"cage-agent", 1, 32)


def _seal(key: bytes, plaintext: bytes, aad: bytes) -> str:
    nonce = secrets.token_bytes(12)
    return b64e(nonce + AESGCM(key).encrypt(nonce, plaintext, aad))


def _open(key: bytes, blob: str, aad: bytes) -> bytes:
    raw = b64d(blob)
    try:
        return AESGCM(key).decrypt(raw[:12], raw[12:], aad)
    except Exception as exc:  # InvalidTag
        raise VaultError("incorrect password or altered file") from exc


def _atomic_write(path: Path, data: bytes) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def exists() -> bool:
    return VAULT.exists()


def read_raw() -> dict:
    return json.loads(VAULT.read_text())


def mtime() -> float:
    return VAULT.stat().st_mtime_ns if VAULT.exists() else 0


def create(password: str, data: dict) -> bytes:
    if len(password) < MIN_PASSWORD:
        raise VaultError(f"password must have at least {MIN_PASSWORD} characters")
    if exists():
        raise VaultError("vault already exists")
    ensure_home()
    dek = secrets.token_bytes(32)
    salt = secrets.token_bytes(16)
    doc = {
        "v": 1,
        "kdf": {"name": "scrypt", **SCRYPT, "salt": b64e(salt)},
        "keys": {"password": _seal(_kek_password(password, salt, SCRYPT), dek, b"key:password")},
        "created": int(time.time()),
    }
    _write(doc, dek, data)
    return dek


def _write(doc: dict, dek: bytes, data: dict) -> None:
    doc["data"] = _seal(dek, json.dumps(data, ensure_ascii=False).encode(), b"data")
    doc["updated"] = int(time.time())
    _atomic_write(VAULT, json.dumps(doc).encode())


def unlock_password(password: str) -> bytes:
    doc = read_raw()
    k = doc["kdf"]
    kek = _kek_password(password, b64d(k["salt"]), k)
    return _open(kek, doc["keys"]["password"], b"key:password")


def unlock_agent(token: bytes) -> bytes:
    doc = read_raw()
    if "agent" not in doc["keys"]:
        raise VaultError("agent access is disabled")
    return _open(_kek_agent(token, b64d(doc["kdf"]["salt"])), doc["keys"]["agent"], b"key:agent")


def load(dek: bytes) -> dict:
    return json.loads(_open(dek, read_raw()["data"], b"data"))


def save(dek: bytes, data: dict) -> None:
    doc = read_raw()
    _open(dek, doc["data"], b"data")  # verify that the DEK belongs to this vault
    backup()
    _write(doc, dek, data)


def backup(keep: int = 10) -> None:
    if not VAULT.exists():
        return
    ensure_home()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dst = BACKUPS / f"vault-{stamp}.json"
    if not dst.exists():
        _atomic_write(dst, VAULT.read_bytes())
    olds = sorted(BACKUPS.glob("vault-*.json"))
    for p in olds[:-keep]:
        p.unlink()


def daily_backup(keep: int = 30, today: str | None = None) -> Path | None:
    """Encrypted backup of the day (one per date) in backups/daily; the most recent `keep` copies are preserved."""
    if not VAULT.exists():
        return None
    ensure_home()
    daily = BACKUPS / "daily"
    daily.mkdir(mode=0o700, exist_ok=True)
    dst = daily / f"vault-{today or time.strftime('%Y%m%d')}.json"
    if not dst.exists():
        _atomic_write(dst, VAULT.read_bytes())
    for old in sorted(daily.glob("vault-*.json"))[:-keep]:
        old.unlink()
    return dst


def backups_info() -> dict:
    daily = sorted((BACKUPS / "daily").glob("vault-*.json")) if (BACKUPS / "daily").is_dir() else []
    return {"daily": len(daily), "last": daily[-1].name[6:14] if daily else None, "dir": str(BACKUPS)}


def change_password(dek: bytes, new_password: str) -> None:
    if len(new_password) < MIN_PASSWORD:
        raise VaultError(f"password must have at least {MIN_PASSWORD} characters")
    doc = read_raw()
    _open(dek, doc["data"], b"data")
    salt_old = b64d(doc["kdf"]["salt"])
    # New salt: invalidates old password and agent token (regenerated if it existed).
    salt = secrets.token_bytes(16)
    doc["kdf"] = {"name": "scrypt", **SCRYPT, "salt": b64e(salt)}
    doc["keys"]["password"] = _seal(_kek_password(new_password, salt, SCRYPT), dek, b"key:password")
    if "agent" in doc["keys"] and AGENT_KEY.exists():
        token = b64d(AGENT_KEY.read_text().strip())
        doc["keys"]["agent"] = _seal(_kek_agent(token, salt), dek, b"key:agent")
    elif "agent" in doc["keys"]:
        del doc["keys"]["agent"]
    del salt_old
    backup()
    _atomic_write(VAULT, json.dumps(doc).encode())


def set_agent(dek: bytes, enabled: bool) -> None:
    doc = read_raw()
    _open(dek, doc["data"], b"data")
    if enabled:
        ensure_home()
        token = secrets.token_bytes(32)
        _atomic_write(AGENT_KEY, b64e(token).encode())
        doc["keys"]["agent"] = _seal(_kek_agent(token, b64d(doc["kdf"]["salt"])), dek, b"key:agent")
    else:
        doc["keys"].pop("agent", None)
        if AGENT_KEY.exists():
            AGENT_KEY.unlink()
    _atomic_write(VAULT, json.dumps(doc).encode())


def agent_enabled() -> bool:
    return exists() and "agent" in read_raw().get("keys", {}) and AGENT_KEY.exists()
