#!/usr/bin/env python3
"""Generates the Spanish personal finance exam: calculation questions with verifiable numeric answers.

Questions are generated from templates with random numbers (fixed seed) and answers are computed by this script using
standard formulas (compound interest, savings rate, APR, inflation, French amortization loan payment, 4% rule...).
No language model writes or grades questions: this ensures the exam is reproducible and the score is objective.

  python3 evals/make_exam.py            → evals/finanzas_es.jsonl (200 questions)
"""
from __future__ import annotations

import json
import random
from pathlib import Path

OUT = Path(__file__).with_name("finanzas_es.jsonl")


def eur(x: float) -> str:
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " €"


def q_compound(r: random.Random):
    c, i, n = r.choice([1000, 2500, 5000, 10000, 20000]), r.choice([2, 3, 4, 5, 6, 7]), r.choice([5, 10, 15, 20])
    return (f"Inviertes {eur(c)} a un interés compuesto anual del {i} % durante {n} años sin aportar más. "
            "¿Cuánto tendrás al final, en euros?", c * (1 + i / 100) ** n, "interés compuesto")


def q_monthly(r: random.Random):
    m, i, n = r.choice([50, 100, 200, 300, 500]), r.choice([3, 4, 5, 6, 7]), r.choice([10, 15, 20, 25, 30])
    rm = i / 100 / 12
    return (f"Aportas {eur(m)} al final de cada mes durante {n} años a una rentabilidad anual del {i} % con "
            "capitalización mensual. ¿Cuánto tendrás al final, en euros?", m * ((1 + rm) ** (n * 12) - 1) / rm,
            "aportaciones periódicas")


def q_savings(r: random.Random):
    inc = r.choice([1400, 1800, 2200, 2600, 3200]); exp = inc - r.choice([100, 250, 400, 600, 800])
    return (f"Ingresas {eur(inc)} al mes y gastas {eur(exp)}. ¿Cuál es tu tasa de ahorro, en porcentaje?",
            100 * (inc - exp) / inc, "tasa de ahorro")


def q_emergency(r: random.Random):
    g, m = r.choice([900, 1200, 1500, 1800, 2100]), r.choice([3, 4, 6])
    return (f"Tus gastos fijos son {eur(g)} al mes y quieres un fondo de emergencia de {m} meses. "
            "¿Cuántos euros necesitas?", g * m, "fondo de emergencia")


def q_inflation(r: random.Random):
    c, inf, n = r.choice([10000, 20000, 50000]), r.choice([2, 3, 4]), r.choice([5, 10, 20])
    return (f"Con una inflación constante del {inf} % anual, ¿qué poder de compra en euros de hoy tendrán {eur(c)} "
            f"dentro de {n} años?", c / (1 + inf / 100) ** n, "inflación")


def q_loan(r: random.Random):
    p, i, y = r.choice([6000, 10000, 15000, 150000]), r.choice([3, 4, 5, 6, 7, 8]), r.choice([3, 5, 10, 25])
    rm, n = i / 100 / 12, y * 12
    return (f"Pides un préstamo de {eur(p)} al {i} % nominal anual a {y} años con cuota mensual constante "
            "(sistema francés). ¿Cuál es la cuota mensual, en euros?", p * rm / (1 - (1 + rm) ** -n), "préstamos")


def q_tae(r: random.Random):
    tin = r.choice([2, 3, 4, 5, 6])
    return (f"Un depósito ofrece un {tin} % TIN con liquidación mensual de intereses. ¿Cuál es su TAE, en porcentaje?",
            100 * ((1 + tin / 100 / 12) ** 12 - 1), "TAE")


def q_fee(r: random.Random):
    c, i, fee, n = r.choice([10000, 30000]), r.choice([5, 6, 7]), r.choice([0.2, 1.5, 2.0]), r.choice([20, 30])
    return (f"{eur(c)} invertidos {n} años a un {i} % anual bruto con una comisión anual del {fee} % "
            "(rentabilidad neta = bruta − comisión). ¿Cuánto tendrás al final, en euros?",
            c * (1 + (i - fee) / 100) ** n, "comisiones")


def q_fire(r: random.Random):
    g = r.choice([18000, 24000, 30000, 36000])
    return (f"Si gastas {eur(g)} al año y aplicas la regla del 4 % de retirada, ¿qué patrimonio necesitas, en euros?",
            g / 0.04, "independencia financiera")


def q_rule72(r: random.Random):
    i = r.choice([3, 4, 6, 8, 9, 12])
    return (f"Según la regla del 72, ¿en cuántos años se duplica una inversión al {i} % anual?", 72 / i, "regla del 72")


GEN = [q_compound, q_monthly, q_savings, q_emergency, q_inflation, q_loan, q_tae, q_fee, q_fire, q_rule72]


def main(n: int = 200, seed: int = 20261109) -> None:
    r, seen, rows = random.Random(seed), set(), []
    while len(rows) < n:
        q, a, topic = r.choice(GEN)(r)
        if q in seen:
            continue
        seen.add(q)
        rows.append({"id": f"fin-{len(rows) + 1:03d}", "topic": topic, "question": q + " Responde solo con el número.",
                     "answer": round(a, 2), "tolerance": 0.01})
    OUT.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in rows) + "\n", encoding="utf-8")
    print(f"{len(rows)} preguntas → {OUT}")


if __name__ == "__main__":
    main()
