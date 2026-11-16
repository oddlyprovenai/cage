"""SPIKE specialists' own benchmark + study coach (low resource: only reads measured results).

Rules agreed with SPIKE's builder (each with its test in tests/test_benchmark.py):
1. SINGLE source: `docs/results/specialists.json` on main ("spike-specialist-results-v1" format), read as is in
   read-only mode and never edited. Null `questions` or empty `topics` are displayed as "sin dato": never filled in.
2. Leading models: only PUBLISHED scores matching dataset, split, config/subset, and metric, with
   link, date, and protocol (shots, reasoning). Everything else: "sin dato comparable". Ours is a seeded,
   zero-shot, greedy sample: its ci95 is displayed.
3. Always show "unparsed". If the base model has many unread responses, the comparison carries a visible note.
4. No promise that a 4B specialist will outperform leading models: only the measured difference.
5. Coach: names topics and error types; never copies evaluation questions or their IDs. "Always
   learning" = one measured round after another, not continuous background training. Does not launch training runs.
"""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

import vault

ROOT = Path(__file__).resolve().parent
CACHE = vault.HOME / "spike_specialists.json"
PUBLISHED = ROOT / "benchmarks" / "published.json"
FORMAT = "spike-specialist-results-v1"
REPO = "oddlyprovenai/spike"
NAME = {"medicine": "Medicine", "finance": "Finance", "marketing": "Marketing", "law": "Law", "math": "Mathematics",
        "science": "Science", "code": "Code", "data": "Data", "education": "Education", "writing": "Writing",
        "business": "Business", "security": "Security"}
UNPARSED_WARN = 0.10  # más de un 10 % sin leer hunde la nota: se avisa al lado
LEARNING = ("\"Always learning\" means one measured round after another: each round trains, is measured on the same exam and "
            "is kept only if it improves without losing general knowledge. There is no continuous background training.")
NO_PROMISE = ("A 4B specialist is not guaranteed to beat the leading models: this page only shows the measured difference "
              "on the same exam, when a comparable published score exists.")


def _get(url: str, timeout: int = 30) -> str:
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Cage (read-only)", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def commit_of_main() -> str | None:
    """Short commit id and date of SPIKE's main (optional: the public API is rate-limited)."""
    try:
        c = json.loads(_get(f"https://api.github.com/repos/{REPO}/commits/main"))
        return f"{c['sha'][:8]} {c['commit']['committer']['date']}"
    except Exception:  # noqa: BLE001
        return None


def results(cache_h: float = 6) -> dict:
    """specialists.json de main, cacheado. Se guarda tal cual: Cage nunca lo modifica."""
    import os
    try:
        cur = json.loads(CACHE.read_text())
    except (OSError, ValueError):
        cur = {}
    if os.environ.get("CAGE_OFFLINE") or (cur and time.time() - cur.get("fetched", 0) < cache_h * 3600):
        return cur
    try:  # public GitHub, no account or `gh` needed
        doc = json.loads(_get(f"https://raw.githubusercontent.com/{REPO}/main/docs/results/specialists.json"))
    except Exception as exc:  # noqa: BLE001
        return cur or {"error": f"could not read specialists.json from main: {str(exc)[:120]}"}
    if doc.get("format") != FORMAT:
        return cur or {"error": f"unexpected format: {doc.get('format')}"}
    sha = commit_of_main()
    out = {"fetched": int(time.time()), "commit": sha, "doc": doc}
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    vault._atomic_write(CACHE, json.dumps(out).encode())
    return out


def published() -> tuple[list[dict], list[str]]:
    """Notas publicadas (recopiladas por Gemini, revisadas). Fuera las que no traen enlace, cita, fecha o protocolo."""
    try:
        rows = json.loads(PUBLISHED.read_text())
    except (OSError, ValueError):
        return [], []
    ok, bad = [], []
    need = ("source_url", "quote", "retrieved", "published", "dataset", "split", "metric", "protocol")
    for r in rows if isinstance(rows, list) else []:
        if r.get("score") is None:
            continue
        miss = [k for k in need if not r.get(k)]
        if miss or not str(r.get("source_url", "")).startswith("http"):
            bad.append(f"{r.get('model')} · {r.get('exam')}: missing {', '.join(miss) or 'a valid link'}")
        else:
            ok.append(r)
    return ok, bad


def comparable(pub: dict, bench: dict | None) -> tuple[bool, str]:
    """Rule 2: same dataset, split, subset (config/categories) and metric as our task."""
    if not bench:
        return False, "unknown exam"
    if pub.get("dataset") != bench.get("dataset"):
        return False, f"different dataset ({pub.get('dataset')})"
    if (pub.get("split") or None) != (bench.get("split") or None):
        return False, f"different split ({pub.get('split')})"
    if (pub.get("config") or None) != (bench.get("config") or None):
        return False, f"different subset ({pub.get('config')})"
    if sorted(pub.get("categories") or []) != sorted(bench.get("categories") or []):
        return False, "different categories (e.g. overall MMLU-Pro vs a single category)"
    if str(pub.get("metric", "")).lower() not in ("accuracy", "exact match accuracy"):
        return False, f"different metric ({pub.get('metric')})"
    return True, ""


def _side(x: dict | None) -> dict | None:
    if not x:
        return None
    n = x.get("n") or 0
    return {**x, "unparsed_rate": (x.get("unparsed") or 0) / n if n else None}


def build() -> dict:
    st = results()
    doc = st.get("doc") or {}
    benches = doc.get("benchmarks") or {}
    pub, rejected = published()
    specs = []
    for sid, s in (doc.get("specialists") or {}).items():
        rounds = []
        for r in s.get("rounds") or []:
            fin = r.get("final") or {}
            tasks = {}
            for tid, t in (fin.get("tasks") or {}).items():
                b, a = _side(t.get("base")), _side(t.get("adapter"))
                warn = None
                if b and b.get("unparsed_rate") and b["unparsed_rate"] > UNPARSED_WARN:
                    warn = (f"Base score pulled down by the answer extractor: {b['unparsed']} of {b['n']} answers unparsed "
                            "(counted as wrong; re-scoring pending). The gap to the specialist is inflated by this.")
                peers = []
                for p in pub:
                    if p.get("exam") != tid:
                        continue
                    ok, why = comparable(p, benches.get(tid))
                    peers.append({**p, "comparable": ok, "why_not": why})
                tasks[tid] = {"bench": benches.get(tid), "base": b, "adapter": a, "delta_points": t.get("delta_points"),
                              "p_value": t.get("p_value"), "warn": warn,
                              "peers": [p for p in peers if p["comparable"]],
                              "peers_rejected": [f"{p['model']}: {p['why_not']}" for p in peers if not p["comparable"]]}
            rounds.append({"round": r.get("round"), "sweep": r.get("sweep"), "verdict": r.get("verdict"), "reasons": r.get("reasons") or [],
                           "candidates": [{"name": c.get("name"), "passes": c.get("passes"), "reasons": c.get("reasons") or []} for c in r.get("candidates") or []],
                           "chosen": r.get("chosen"), "protocol": fin.get("protocol"), "tasks": tasks,
                           "questions": "sin dato" if not fin.get("questions") else f"{len(fin['questions'])} respuestas",
                           "topics": "sin dato" if not fin.get("topics") else fin["topics"],
                           "trained": (r.get("trained_utc") or {}).get("finished")})
        specs.append({"id": sid, "name": NAME.get(sid, sid), "status": s.get("status"), "accepted": s.get("accepted"), "rounds": rounds})
    order = {"adapter_accepted": 0}
    specs.sort(key=lambda x: (order.get(x["status"], 1), -len(x["rounds"]), x["name"]))
    return {"ts": int(time.time()), "commit": st.get("commit"), "fetched": st.get("fetched"), "error": st.get("error"),
            "source": f"github.com/{REPO} · main · docs/results/specialists.json", "base_model": doc.get("base_model"),
            "about": doc.get("about"), "specialists": specs, "published_ok": len(pub), "published_rejected": rejected,
            "learning": LEARNING, "no_promise": NO_PROMISE,
            "protocol_note": "Ours is a seeded sample, zero-shot and greedy (no reasoning); its 95 % confidence interval is shown."}


# ---------------------------------------------------------------- evaluador de estudio (regla 5)
def local_exams() -> list[dict]:
    out = []
    d = vault.HOME / "evals"
    for p in sorted(d.glob("*.json")) if d.is_dir() else []:
        try:
            r = json.loads(p.read_text())
        except ValueError:
            continue
        by = {}
        for x in r.get("detail", []):
            t = by.setdefault(x.get("topic", "?"), [0, 0])
            t[0] += bool(x.get("ok"))
            t[1] += 1
        out.append({"model": r.get("model", p.stem), "n": r.get("n"), "correct": r.get("correct"), "date": r.get("date"),
                    "score": (r["correct"] / r["n"]) if r.get("n") else None, "topics": by, "file": p.name})
    return out


def coach() -> dict:
    """Topics and error types, never questions or their ids (they must never end up in training data)."""
    ex = local_exams()
    plan, prog, text = [], [], []
    if ex:
        last = max(ex, key=lambda x: (x.get("date") or "", x["file"]))
        try:
            qs = [json.loads(x) for x in (ROOT / "evals" / "finanzas_es.jsonl").read_text().splitlines() if x.strip()]
        except OSError:
            qs = []
        numeric = {q["topic"] for q in qs if isinstance(q.get("answer"), (int, float))}
        weak = sorted(((t, c / n, n) for t, (c, n) in last["topics"].items() if n), key=lambda x: x[1])
        for t, acc, n in weak[:6]:
            plan.append({"topic": t, "accuracy": acc, "n": n,
                         "error_type": "numeric calculation (formula and exact arithmetic)" if t in numeric else "concepts and rules"})
        prog = [{"date": x["date"], "model": x["model"], "score": x["score"]} for x in sorted(ex, key=lambda x: x.get("date") or "")]
        text.append(f"Cage finance exam: {last['model']} {last['correct']}/{last['n']} ({last['date']}).")
        text.append("Weakest topics: " + "; ".join(f"{p['topic']} {round(100 * p['accuracy'])} % → {p['error_type']} errors" for p in plan) + ".")
        text.append("For the SPIKE builder: strengthen those topics with your own reasoned, checked data (never outputs of "
                    "Claude, GPT or Gemini, nor exam questions); measure before and after on the same exam. " + LEARNING)
    return {"plan": plan, "progress": prog, "text": " ".join(text), "learning": LEARNING}
