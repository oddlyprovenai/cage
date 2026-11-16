"""Benchmark: una prueba por cada regla acordada con el constructor de SPIKE."""
from __future__ import annotations

import copy
import importlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DOC = {"format": "spike-specialist-results-v1", "base_model": "Qwen3.5-4B Q4_K_M (llama.cpp)",
       "benchmarks": {"medmcqa-val": {"dataset": "openlifescienceai/medmcqa", "config": None, "split": "validation", "categories": None},
                      "mmlu-pro-health": {"dataset": "TIGER-Lab/MMLU-Pro", "config": None, "split": "test", "categories": ["health"]}},
       "specialists": {"finance": {"status": "base_profile", "accepted": None, "rounds": []},
                       "medicine": {"status": "adapter_accepted", "accepted": {"date": "2026-11-05"}, "rounds": [{
                           "round": 2, "sweep": "sweep", "verdict": "accepted", "chosen": "c", "reasons": ["medicine: +35.07 pts"],
                           "candidates": [{"name": "c", "passes": True, "reasons": []}],
                           "final": {"protocol": {"decoding": "greedy", "thinking": False, "max_tokens": 2048, "seed": 0, "prompt": "zero-shot"},
                                     "tasks": {"medmcqa-val": {"base": {"n": 1000, "correct": 276, "accuracy": 0.276, "ci95": [0.249, 0.305], "unparsed": 409, "truncated": 24},
                                                               "adapter": {"n": 1000, "correct": 643, "accuracy": 0.643, "ci95": [0.613, 0.672], "unparsed": 26, "truncated": 34},
                                                               "delta_points": 36.7, "p_value": 0.0},
                                               "mmlu-pro-health": {"base": {"n": 818, "correct": 253, "accuracy": 0.309, "ci95": [0.28, 0.34], "unparsed": 41, "truncated": 27},
                                                                   "adapter": {"n": 818, "correct": 508, "accuracy": 0.621, "ci95": [0.59, 0.65], "unparsed": 16, "truncated": 31},
                                                                   "delta_points": 31.17, "p_value": 0.0}},
                                     "questions": None, "topics": {}}}]}}}
PUB_OK = {"exam": "mmlu-pro-health", "model": "Modelo A", "score": 0.80, "metric": "accuracy", "dataset": "TIGER-Lab/MMLU-Pro",
          "split": "test", "config": None, "categories": ["health"], "protocol": "5-shot CoT", "source_url": "https://ejemplo.org/a",
          "source_name": "x", "published": "2026-10-01", "retrieved": "2026-11-14", "quote": "Modelo A 80.0"}


@pytest.fixture()
def B(tmp_path, monkeypatch):
    monkeypatch.setenv("CAGE_HOME", str(tmp_path))
    monkeypatch.setenv("CAGE_OFFLINE", "1")
    import vault
    importlib.reload(vault)
    import benchmark
    importlib.reload(benchmark)
    monkeypatch.setattr(benchmark, "PUBLISHED", tmp_path / "pub.json")
    doc = copy.deepcopy(DOC)
    monkeypatch.setattr(benchmark, "results", lambda: {"doc": doc, "commit": "29d3d79", "fetched": 1})
    benchmark._doc = doc
    return benchmark


def test_rule1_single_source_read_as_is_and_null_is_sin_dato(B):
    before = json.dumps(B._doc, sort_keys=True)
    b = B.build()
    assert json.dumps(B._doc, sort_keys=True) == before  # nunca se modifica
    med = next(s for s in b["specialists"] if s["id"] == "medicine")
    r = med["rounds"][0]
    assert r["questions"] == "sin dato" and r["topics"] == "sin dato"
    assert r["tasks"]["medmcqa-val"]["adapter"]["ci95"] == [0.613, 0.672]  # ci95 tal cual
    fin = next(s for s in b["specialists"] if s["id"] == "finance")
    assert fin["rounds"] == [] and fin["status"] == "base_profile"  # sin rellenar desde otras copias
    assert "specialists.json" in b["source"]


def test_rule2_only_comparable_published_scores(B, tmp_path):
    bad_global = {**PUB_OK, "model": "Global", "categories": []}  # MMLU-Pro global frente a salud: NO
    incomplete = {**PUB_OK, "model": "SinProtocolo", "protocol": ""}
    other_split = {**PUB_OK, "exam": "medmcqa-val", "model": "OtraParticion", "dataset": "openlifescienceai/medmcqa", "split": "test", "categories": None}
    (tmp_path / "pub.json").write_text(json.dumps([PUB_OK, bad_global, incomplete, other_split]))
    b = B.build()
    t = next(s for s in b["specialists"] if s["id"] == "medicine")["rounds"][0]["tasks"]
    assert [p["model"] for p in t["mmlu-pro-health"]["peers"]] == ["Modelo A"]
    assert any("Global" in x and "categories" in x for x in t["mmlu-pro-health"]["peers_rejected"])
    assert t["medmcqa-val"]["peers"] == [] and any("split" in x for x in t["medmcqa-val"]["peers_rejected"])
    assert any("SinProtocolo" in x for x in b["published_rejected"])
    assert "seeded" in b["protocol_note"] and "zero-shot" in b["protocol_note"]


def test_rule3_unparsed_always_present_and_warning_when_base_sunk(B):
    t = next(s for s in B.build()["specialists"] if s["id"] == "medicine")["rounds"][0]["tasks"]
    assert t["medmcqa-val"]["base"]["unparsed"] == 409 and t["medmcqa-val"]["adapter"]["unparsed"] == 26
    assert "409 of 1000" in t["medmcqa-val"]["warn"]
    assert t["mmlu-pro-health"]["warn"] is None  # 41/818 = 5 %: sin aviso
    js = (Path(B.__file__).parent / "web" / "bench.js").read_text()
    assert "unparsed ${x.unparsed}" in js and "t.warn" in js  # la pantalla siempre lo pinta


def test_rule4_no_promise_only_measured_difference(B):
    b = B.build()
    assert "not guaranteed" in b["no_promise"]
    js = (Path(B.__file__).parent / "web" / "bench.js").read_text().lower()
    for forbidden in ("will beat", "beats gpt", "better than gpt", "better than claude", "guaranteed to beat"):
        assert forbidden not in js
    assert "measured difference" in js


def test_rule5_coach_names_topics_never_questions(B, tmp_path):
    (tmp_path / "evals").mkdir()
    (tmp_path / "evals" / "m.json").write_text(json.dumps({"model": "m", "n": 4, "correct": 2, "date": "2026-11-11", "detail": [
        {"id": "fin-003", "topic": "préstamos", "ok": False}, {"id": "fin-004", "topic": "préstamos", "ok": False},
        {"id": "fin-001", "topic": "inflación", "ok": True}, {"id": "fin-002", "topic": "inflación", "ok": True}]}))
    c = B.coach()
    blob = json.dumps(c, ensure_ascii=False)
    assert c["plan"][0]["topic"] == "préstamos"
    assert "fin-00" not in blob  # ningún identificador de pregunta
    qs = [json.loads(x) for x in (Path(B.__file__).parent / "evals" / "finanzas_es.jsonl").read_text().splitlines()[:50] if x.strip()]
    assert not any(q["question"][:40] in blob for q in qs)  # ningún enunciado
    assert "one measured round after another" in c["learning"] and "background" in c["learning"]
