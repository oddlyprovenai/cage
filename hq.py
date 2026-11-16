#!/usr/bin/env python3
"""Cage CLI for Claude to configure the dashboard.

Only works if you enabled "Claude access" under Account (creates ~/.cage/agent.key).
You can revoke it at any time from the same toggle.

  hq.py status                     dashboard status
  hq.py get [file.json]            dumps data (to stdout or a 0600 file)
  hq.py set file.json              replaces data (validates and creates a backup first)
  hq.py ai ENDPOINT [MODEL]        configures local AI (127.0.0.1/localhost only)
  hq.py bandeja                    pending requests left by you or your AI for Claude
  hq.py responder ID TEXT          answers a request (visible in the dashboard) and marks it done
  hq.py memoria                    index of shared memory (~/Downloads/Cage/memoria)
  hq.py recordar [--fuente claude|gemini|ia-local] [--tema T] [--proyecto ID] [--ref R] TEXT
                                   adds a fact to memory (stays "unverified" until you verify it)
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vault
from server import is_local_url


def dek() -> bytes:
    if not vault.agent_enabled():
        sys.exit("Claude access disabled: you must enable it in Account > Security.")
    return vault.unlock_agent(vault.b64d(vault.AGENT_KEY.read_text().strip()))


def audit(d: dict, ev: str) -> None:
    d.setdefault("audit", []).append({"ts": int(time.time()), "event": f"Claude (CLI): {ev}"})
    d["audit"] = d["audit"][-300:]


def main(argv: list[str]) -> None:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return
    cmd = argv[0]
    if cmd == "status":
        print(json.dumps({"vault": vault.exists(), "agent": vault.agent_enabled(),
                          "home": str(vault.HOME)}, indent=2))
        return
    k = dek()
    d = vault.load(k)
    if cmd == "get":
        out = json.dumps({k: v for k, v in d.items() if k not in ("_secrets", "mail", "health_apple")}, ensure_ascii=False, indent=2)  # Claude never sees secrets or emails
        if len(argv) > 1:
            fd = os.open(argv[1], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(out)
        else:
            print(out)
        return
    if cmd == "set":
        new = json.loads(Path(argv[1]).read_text())
        need = {"profile", "settings", "projects", "ledger", "portfolio"}
        if not need <= new.keys():
            sys.exit(f"missing keys: {need - new.keys()}")
        if not is_local_url(new["settings"]["ai"]["endpoint"]):
            sys.exit("non-local AI endpoint")
        new["audit"] = d.get("audit", [])
        new["_secrets"] = d.get("_secrets", {})  # CLI cannot read or replace secrets
        for key in ("mail", "health_apple"):
            if key in d:
                new[key] = d[key]  # nor emails (it cannot see them, so it cannot delete them on save)
        audit(new, "data updated")
        vault.save(k, new)
        print("ok")
        return
    if cmd == "memoria":
        import memory
        p = memory.shared_dir() / "INDICE.md"
        print(p.read_text() if p.is_file() else "No memory exported yet: open Cage once.")
        return
    if cmd == "recordar":
        import memory
        opts, words, i = {"--fuente": "claude", "--tema": "general", "--proyecto": "", "--ref": ""}, [], 1
        while i < len(argv):
            if argv[i] in opts and i + 1 < len(argv):
                opts[argv[i]] = argv[i + 1]
                i += 2
            else:
                words.append(argv[i])
                i += 1
        if opts["--fuente"] == "owner":
            sys.exit("the CLI cannot write as the user")
        f = memory.add_fact(d, " ".join(words), opts["--fuente"], opts["--tema"], opts["--ref"], opts["--proyecto"])
        audit(d, f"memory: {opts['--fuente']} added a fact")
        vault.save(k, d)
        try:
            memory.export(d)
        except Exception:  # noqa: BLE001
            pass
        print("ok", f["id"])
        return
    if cmd == "bandeja":
        rows = [m for m in d.get("claude_inbox", []) if m.get("status") != "respondida"]
        for m in rows:
            print(f"[{m['id']}] {time.strftime('%Y-%m-%d %H:%M', time.localtime(m['ts']))} · {m.get('from', 'user')}: {m['text']}")
        if not rows:
            print("Inbox empty.")
        return
    if cmd == "responder":
        if len(argv) < 3:
            sys.exit("usage: hq.py responder ID TEXT")
        m = next((x for x in d.get("claude_inbox", []) if x["id"] == argv[1]), None)
        if not m:
            sys.exit("request not found")
        m.update(status="respondida", reply=" ".join(argv[2:])[:4000], replied=int(time.time()))
        audit(d, f"reply to inbox {argv[1]}")
        vault.save(k, d)
        print("ok")
        return
    if cmd == "ai":
        if not is_local_url(argv[1]):
            sys.exit("local endpoints only")
        d["settings"]["ai"]["endpoint"] = argv[1]
        if len(argv) > 2:
            d["settings"]["ai"]["model"] = argv[2]
        audit(d, f"local AI -> {argv[1]}")
        vault.save(k, d)
        print("ok")
        return
    sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
