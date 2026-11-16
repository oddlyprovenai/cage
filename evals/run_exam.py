#!/usr/bin/env python3
"""Runs the finance exam on an OpenAI-compatible local model and saves the score for the dashboard.

  python3 evals/run_exam.py --endpoint http://127.0.0.1:8080/v1 --model qwen3.5-4b --label "Qwen3.5-4B base"

Local endpoints only. Marked correct if the parsed number in the response is within 1% of the ground truth (min 0.01).
Result stored in ~/.cage/evals/<label>.json (0600), which Investments → AI Exam displays directly.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import is_local_url  # noqa: E402

EXAM = Path(__file__).with_name("finanzas_es.jsonl")
HOME = Path(os.environ.get("CAGE_HOME", Path.home() / ".cage"))


def parse_number(text: str) -> float | None:
    m = re.findall(r"-?\d[\d.\s]*(?:,\d+)?|-?\d+(?:\.\d+)?", text.replace(" ", " "))
    if not m:
        return None
    s = m[-1].strip().replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif s.count(".") > 1 or re.fullmatch(r"-?\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def correct(pred: float | None, ans: float, tol: float = 0.01) -> bool:
    return pred is not None and abs(pred - ans) <= max(0.01, tol * abs(ans))


def ask(endpoint: str, model: str, q: str, think: bool = False) -> str:
    body = {"model": model, "temperature": 0, "max_tokens": 3072 if think else 400, "chat_template_kwargs": {"enable_thinking": think},
            "messages": [{"role": "system", "content": "Eres un experto en finanzas personales. Responde solo con el número final."},
                         {"role": "user", "content": q}]}
    req = urllib.request.Request(endpoint.rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=300) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", required=True)
    ap.add_argument("--model", default="local")
    ap.add_argument("--label", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--think", action="store_true", help="enable model thinking (slower)")
    a = ap.parse_args()
    if not is_local_url(a.endpoint):
        sys.exit("local models only")
    rows = [json.loads(x) for x in EXAM.read_text(encoding="utf-8").splitlines() if x.strip()]
    rows = rows[: a.limit] if a.limit else rows
    ok, detail = 0, []
    for row in rows:
        out = ask(a.endpoint, a.model, row["question"], a.think)
        out = out.split("</think>")[-1]  # final answer only
        hit = correct(parse_number(out), row["answer"], row.get("tolerance", 0.01))
        ok += hit
        detail.append({"id": row["id"], "topic": row["topic"], "ok": hit})
    res = {"model": a.label, "n": len(rows), "correct": ok, "date": time.strftime("%Y-%m-%d"), "detail": detail}
    out = HOME / "evals"
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = out / (re.sub(r"[^\w.-]+", "-", a.label) + ".json")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(res, f, ensure_ascii=False)
    print(f"{a.label}: {ok}/{len(rows)} → {path}")


if __name__ == "__main__":
    main()
