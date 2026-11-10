"""Полигоны — симуляционная среда команды стартапа для проверки гипотез (api/runtime/polygons.py).

Полигон — сохранённая финансовая модель стартапа и набор сценариев, на
которых проверяется гипотеза («деньги не закончатся до раунда», «через
интегратора CAC ниже — и мы выйдем в операционный плюс за 12 месяцев»).
Два режима:

  1. Сценарная модель (simulate): помесячная модель стартапа. Каждый месяц
     бюджет на продажи и маркетинг приводит новых клиентов (в среднем
     marketing / CAC, после задержки цикла продаж sales_lag_months), часть
     клиентов уходит (отток churn), клиенты платят price в месяц с валовой
     маржой gross_margin, команда тратит fixed_costs (растут на
     fixed_growth % в месяц). Грант и инвестиционный раунд приходят в свой
     месяц с заданной вероятностью; раунд — только если к этому месяцу
     выручка в месяц (MRR) не ниже round_min_mrr. Если деньги ушли в минус —
     кассовый разрыв, компания «умирает» в этом прогоне.
     Неопределённость: CAC и отток в каждом прогоне случайно отклоняются от
     ожиданий (cac_spread, churn_spread), приток клиентов — пуассоновский.
     Монте-Карло (runs прогонов) даёт среднее и коридор p10–p90, а гипотеза
     проверяется как доля прогонов, в которых метрика достигла цели.
     Считается без LLM, детерминированно при заданном seed.
  2. ИИ-фокус-группа (panel_prompts / parse_opinion): виртуальные инвестор,
     бизнес-ангел, эксперт фонда, клиенты и трекер акселератора оценивают
     идею, гипотезу или питч — вызов LLM делает роутер api/routers/polygons.py.

Суммы — тыс. ₽, время — месяцы.

Хранение — как у остальных артефактов: примеры платформы в data/polygons/*.json
(в git, только чтение), свои полигоны — AIOS_RUNTIME_DIR/polygons/{user_id}/{pg-…}.json.
"""

from __future__ import annotations

import json
import math
import random
import re
import secrets
import time
from functools import lru_cache
from pathlib import Path

from .config import get_settings

USER_ID_RE = re.compile(r"^[a-f0-9]{12}$")
POLYGON_ID_RE = re.compile(r"^pg-[a-f0-9]{10}$")

MAX_MONTHS = 60
MAX_RUNS = 1000
MAX_SCENARIOS = 6
MAX_CUSTOMERS = 100_000  # предохранитель: клиентов в одном прогоне

METRICS = {
    "survived": "Доля прогонов без кассового разрыва (0–1)",
    "cash": "Деньги на счёте в конце, тыс. ₽",
    "min_cash": "Минимум денег на счёте, тыс. ₽",
    "runway": "Месяцев до кассового разрыва (горизонт — если не было)",
    "customers": "Клиенты в конце горизонта",
    "mrr": "Выручка в месяц (MRR) в конце, тыс. ₽",
    "revenue": "Выручка за весь горизонт, тыс. ₽",
    "raised": "Привлечено грантов и инвестиций, тыс. ₽",
    "breakeven": "Месяц выхода в операционный плюс (горизонт + 1 — не вышли)",
    "ltv_cac": "LTV / CAC",
}
SERIES = ("customers", "mrr", "cash", "alive")
OPS = (">=", "<=")


class PolygonError(ValueError):
    """Некорректные параметры полигона."""


def _num(value, default, lo, hi, integer=False):
    try:
        x = float(value)
    except (TypeError, ValueError):
        x = float(default)
    if math.isnan(x) or math.isinf(x):
        x = float(default)
    x = max(lo, min(hi, x))
    return int(round(x)) if integer else x


def _text(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


# ---------------------------------------------------------------------------
# Параметры
# ---------------------------------------------------------------------------

# (ключ, значение по умолчанию, минимум, максимум, целое)
PARAM_SPEC = (
    ("horizon_months", 18, 3, MAX_MONTHS, True),
    ("runs", 400, 20, MAX_RUNS, True),
    ("seed", 2030, 0, 10**9, True),
    ("start_cash", 4200, 0, 10_000_000, False),        # деньги на старте
    ("fixed_costs", 450, 0, 1_000_000, False),         # команда, аренда, сервисы в месяц
    ("fixed_growth", 2, -20, 50, False),               # рост постоянных расходов, % в месяц
    ("marketing", 150, 0, 1_000_000, False),           # продажи и маркетинг в месяц
    ("cac", 380, 0.01, 1_000_000, False),              # ожидаемая стоимость привлечения клиента
    ("cac_spread", 30, 0, 200, False),                 # неопределённость CAC, %
    ("price", 180, 0, 1_000_000, False),               # выручка с клиента в месяц (ARPA)
    ("gross_margin", 0.62, -1, 1, False),              # валовая маржа, доля
    ("churn", 0.03, 0, 1, False),                      # отток клиентов в месяц, доля
    ("churn_spread", 30, 0, 200, False),               # неопределённость оттока, %
    ("initial_customers", 1, 0, MAX_CUSTOMERS, True),
    ("sales_lag_months", 3, 0, 24, True),              # цикл сделки: когда маркетинг начнёт приводить клиентов
    ("grant_amount", 0, 0, 10_000_000, False),
    ("grant_month", 6, 1, MAX_MONTHS, True),
    ("grant_prob", 0.5, 0, 1, False),
    ("round_amount", 0, 0, 10_000_000_000, False),
    ("round_month", 12, 1, MAX_MONTHS, True),
    ("round_prob", 0.3, 0, 1, False),
    ("round_min_mrr", 0, 0, 1_000_000_000, False),     # раунд закрывается, только если MRR не ниже
)
PARAM_DEFAULTS = {key: default for key, default, *_ in PARAM_SPEC}

# сценарий: относительные изменения, % (price_change: +20 — цена выше на 20 %)
SCENARIO_RELATIVE = ("price_change", "cac_change", "churn_change")
# сценарий: абсолютные значения вместо базовых (пусто — как в базе)
SCENARIO_ABSOLUTE = ("marketing", "fixed_costs", "start_cash", "sales_lag_months", "gross_margin",
                     "grant_amount", "grant_prob", "round_amount", "round_prob", "round_min_mrr")


def normalize_params(raw: dict | None) -> dict:
    """Параметры модели с ограничениями; недостающее — значения по умолчанию."""
    raw = raw if isinstance(raw, dict) else {}
    params = {key: _num(raw.get(key), default, lo, hi, integer)
              for key, default, lo, hi, integer in PARAM_SPEC}
    if params["initial_customers"] > MAX_CUSTOMERS:
        raise PolygonError(f"Клиентов на старте больше {MAX_CUSTOMERS}")
    return params


def _spec(key):
    for item in PARAM_SPEC:
        if item[0] == key:
            return item
    raise KeyError(key)


def normalize_scenario(raw: dict | None, i: int) -> dict:
    """Сценарий — правки базовых параметров: цена, CAC, отток, бюджеты, грант, раунд."""
    raw = raw if isinstance(raw, dict) else {}
    sc = {
        "id": _text(raw.get("id"), 40) or f"s{i + 1}",
        "name": _text(raw.get("name"), 120) or f"Сценарий {i + 1}",
        "description": _text(raw.get("description"), 600),
    }
    for key in SCENARIO_RELATIVE:
        sc[key] = _num(raw.get(key), 0, -90, 500)
    for key in SCENARIO_ABSOLUTE:
        if raw.get(key) not in (None, ""):
            _, default, lo, hi, integer = _spec(key)
            sc[key] = _num(raw.get(key), default, lo, hi, integer)
    return sc


def apply_scenario(params: dict, sc: dict) -> dict:
    p = dict(params)
    for key in SCENARIO_ABSOLUTE:
        if key in sc:
            p[key] = sc[key]
    p["price"] = max(0.0, p["price"] * (1 + sc.get("price_change", 0) / 100))
    p["cac"] = max(0.01, p["cac"] * (1 + sc.get("cac_change", 0) / 100))
    p["churn"] = min(1.0, max(0.0, p["churn"] * (1 + sc.get("churn_change", 0) / 100)))
    return p


def normalize_hypothesis(raw: dict | None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    metric = raw.get("metric") if raw.get("metric") in METRICS else "survived"
    op = raw.get("op") if raw.get("op") in OPS else ">="
    return {
        "statement": _text(raw.get("statement"), 600),
        "metric": metric,
        "op": op,
        "value": _num(raw.get("value"), 0, -1e12, 1e12),
        "scenario_id": _text(raw.get("scenario_id"), 40),
    }


# ---------------------------------------------------------------------------
# Симуляция
# ---------------------------------------------------------------------------


def _poisson(rng: random.Random, lam: float) -> int:
    """Пуассоновская случайная величина: Кнут для малых λ, нормальное приближение — для больших."""
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, int(round(rng.gauss(lam, math.sqrt(lam)))))
    limit, k, prod = math.exp(-lam), 0, rng.random()
    while prod > limit:
        k += 1
        prod *= rng.random()
    return k


def _binomial(rng: random.Random, n: int, p: float) -> int:
    if n <= 0 or p <= 0:
        return 0
    if p >= 1:
        return n
    if n > 60:
        mean, sd = n * p, math.sqrt(n * p * (1 - p))
        return min(n, max(0, int(round(rng.gauss(mean, sd)))))
    return sum(1 for _ in range(n) if rng.random() < p)


def _wobble(rng: random.Random, value: float, spread_pct: float) -> float:
    """Значение с неопределённостью: логнормальный множитель, медиана — само значение."""
    if spread_pct <= 0:
        return value
    return value * math.exp(rng.gauss(0, spread_pct / 100))


def _one_run(p: dict, rng: random.Random) -> dict:
    """Один прогон, шаг — месяц."""
    cac = max(0.01, _wobble(rng, p["cac"], p["cac_spread"]))
    churn = min(1.0, max(0.0, _wobble(rng, p["churn"], p["churn_spread"])))
    grant_ok = rng.random() < p["grant_prob"]
    round_ok = rng.random() < p["round_prob"]
    customers = p["initial_customers"]
    cash = p["start_cash"]
    min_cash = cash
    revenue = raised = 0.0
    fixed = p["fixed_costs"]
    alive = True
    dead_month = None
    breakeven = None
    monthly = []
    for month in range(1, p["horizon_months"] + 1):
        if alive:
            if month > p["sales_lag_months"]:
                customers += _poisson(rng, p["marketing"] / cac)
            customers -= _binomial(rng, customers, churn)
            customers = min(customers, MAX_CUSTOMERS)
            mrr = customers * p["price"]
            gross = mrr * p["gross_margin"]
            costs = fixed + p["marketing"]
            if breakeven is None and gross >= costs and costs > 0:
                breakeven = month
            inflow = 0.0
            if p["grant_amount"] and month == p["grant_month"] and grant_ok:
                inflow += p["grant_amount"]
            if p["round_amount"] and month == p["round_month"] and round_ok and mrr >= p["round_min_mrr"]:
                inflow += p["round_amount"]
            raised += inflow
            revenue += mrr
            cash += gross - costs + inflow
            fixed *= 1 + p["fixed_growth"] / 100
            min_cash = min(min_cash, cash)
            if cash < 0:
                alive = False
                dead_month = month
        else:
            mrr = 0.0
        monthly.append({"customers": customers if alive else 0, "mrr": mrr if alive else 0.0,
                        "cash": cash, "alive": 1.0 if alive else 0.0})
    final_mrr = monthly[-1]["mrr"] if monthly else 0.0
    ltv = p["price"] * p["gross_margin"] / churn if churn > 0 else p["price"] * p["gross_margin"] * p["horizon_months"]
    final = {
        "survived": 1.0 if alive else 0.0,
        "cash": cash,
        "min_cash": min_cash,
        "runway": float(dead_month - 1 if dead_month else p["horizon_months"]),
        "customers": float(monthly[-1]["customers"] if monthly else 0),
        "mrr": final_mrr,
        "revenue": revenue,
        "raised": raised,
        "breakeven": float(breakeven or p["horizon_months"] + 1),
        "ltv_cac": ltv / cac,
    }
    return {"monthly": monthly, "final": final}


def _quantile(sorted_vals: list, q: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(idx), math.ceil(idx)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


def _stats(values: list) -> dict:
    s = sorted(values)
    mean = sum(s) / len(s) if s else 0.0
    return {"mean": round(mean, 3), "p10": round(_quantile(s, 0.1), 3), "p90": round(_quantile(s, 0.9), 3)}


def _check(value: float, hyp: dict) -> bool:
    return value >= hyp["value"] if hyp["op"] == ">=" else value <= hyp["value"]


def simulate(params_raw: dict, scenarios_raw: list | None = None, hypothesis_raw: dict | None = None) -> dict:
    """Монте-Карло по базовому сценарию и каждому из сценариев полигона."""
    params = normalize_params(params_raw)
    scenarios = [normalize_scenario({"id": "base", "name": "Базовый сценарий"}, 0)]
    for i, sc in enumerate((scenarios_raw or [])[:MAX_SCENARIOS]):
        sc = normalize_scenario(sc, i + 1)
        if sc["id"] == "base":
            sc["id"] = f"s{i + 1}"
        scenarios.append(sc)
    hyp = normalize_hypothesis(hypothesis_raw)
    started = time.perf_counter()
    results = []
    for sc in scenarios:
        p = apply_scenario(params, sc)
        rng = random.Random(params["seed"])  # одинаковые случайные числа — честное сравнение
        runs = [_one_run(p, rng) for _ in range(params["runs"])]
        months = params["horizon_months"]
        series = {m: [_stats([r["monthly"][t][m] for r in runs]) for t in range(months)] for m in SERIES}
        final = {m: _stats([r["final"].get(m, 0) for r in runs]) for m in METRICS}
        hit = None
        if hyp["statement"] or hyp["value"]:
            hit = round(sum(1 for r in runs if _check(r["final"].get(hyp["metric"], 0), hyp)) / len(runs), 3)
        results.append({
            "id": sc["id"], "name": sc["name"], "description": sc["description"],
            "series": series, "final": final, "hypothesis_probability": hit,
        })
    return {
        "params": params,
        "scenarios": scenarios,
        "hypothesis": hyp,
        "metrics": METRICS,
        "results": results,
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }


# ---------------------------------------------------------------------------
# ИИ-фокус-группа
# ---------------------------------------------------------------------------

DEFAULT_PANEL = [
    {"id": "investor", "name": "Венчурный инвестор",
     "persona": "партнёр посевного фонда; смотрит на команду, размер рынка, тракшн, юнит-экономику, права на технологию и долю вуза в компании"},
    {"id": "angel", "name": "Бизнес-ангел из отрасли",
     "persona": "бывший топ-менеджер отраслевой компании, инвестирует свои деньги; важны понимание клиента, скорость продаж, первые деньги от клиентов"},
    {"id": "fund", "name": "Эксперт Фонда содействия инновациям",
     "persona": "эксперт грантовых конкурсов; оценивает научно-техническую новизну, реалистичность плана и бюджета, команду и соответствие требованиям программы"},
    {"id": "customer", "name": "Клиент — лицо, принимающее решение",
     "persona": "руководитель службы в компании целевого сегмента; важны реальная боль, экономия денег или времени, риски внедрения, кто будет поддерживать решение"},
    {"id": "cfo", "name": "Финансовый директор клиента",
     "persona": "отвечает за бюджет компании-клиента; важны окупаемость, понятная цена, условия оплаты и договора, надёжность маленького поставщика"},
    {"id": "tracker", "name": "Трекер акселератора",
     "persona": "ведёт команды университетских стартапов; смотрит на скорость проверки гипотез, фокус на сегменте, распределение ролей в команде и следующую веху"},
]
MAX_PANEL = 8
VERDICTS = ("поддержать", "доработать", "отклонить")


def normalize_panel(raw) -> list:
    if not isinstance(raw, list) or not raw:
        return [dict(r) for r in DEFAULT_PANEL]
    roles = []
    for i, r in enumerate(raw[:MAX_PANEL]):
        if not isinstance(r, dict):
            continue
        name = _text(r.get("name"), 80)
        if not name:
            continue
        roles.append({"id": _text(r.get("id"), 40) or f"r{i + 1}", "name": name,
                      "persona": _text(r.get("persona"), 400)})
    return roles or [dict(r) for r in DEFAULT_PANEL]


def panel_messages(role: dict, idea: str, context: str = "") -> list:
    system = (
        f"Ты — {role['name']} ({role['persona']}). Ты участвуешь в фокус-группе на платформе "
        "команды университетского технологического стартапа и оцениваешь идею, гипотезу, продукт "
        "или питч стартапа. Отвечай строго от лица своей роли, по-русски, конкретно и "
        "критично, без выдуманных фактов о стартапе и рынке. Верни ТОЛЬКО JSON без пояснений вида "
        '{"score": <целое 1-10>, "verdict": "поддержать|доработать|отклонить", '
        '"pros": ["..."], "cons": ["..."], "condition": "при каком условии поддержишь", '
        '"question": "главный вопрос к авторам"}. В pros и cons — по 2–3 коротких пункта.'
    )
    user = f"Идея / гипотеза для оценки:\n{idea[:4000]}"
    if context:
        user += f"\n\nРезультаты сценарной модели полигона:\n{context[:3000]}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def parse_opinion(text: str, role: dict) -> dict:
    """Мнение роли из ответа модели; без валидного JSON — текст как есть."""
    raw = (text or "").strip()
    m = re.search(r"\{.*\}", raw, re.S)
    data = None
    if m:
        try:
            data = json.loads(m.group(0))
        except ValueError:
            data = None
    if not isinstance(data, dict):
        return {"role": role["name"], "role_id": role["id"], "score": None, "verdict": "",
                "pros": [], "cons": [], "condition": "", "question": "", "text": raw[:2000]}
    verdict = str(data.get("verdict") or "").strip().lower()
    score = data.get("score")
    try:
        score = max(1, min(10, int(round(float(score)))))
    except (TypeError, ValueError):
        score = None

    def lst(v):
        return [_text(x, 300) for x in (v if isinstance(v, list) else [v]) if _text(x, 300)][:4]

    return {
        "role": role["name"], "role_id": role["id"], "score": score,
        "verdict": verdict if verdict in VERDICTS else "",
        "pros": lst(data.get("pros")), "cons": lst(data.get("cons")),
        "condition": _text(data.get("condition"), 500), "question": _text(data.get("question"), 500),
    }


def summarize_panel(opinions: list) -> dict:
    scores = [o["score"] for o in opinions if isinstance(o.get("score"), int)]
    votes = {v: sum(1 for o in opinions if o.get("verdict") == v) for v in VERDICTS}
    avg = round(sum(scores) / len(scores), 1) if scores else None
    if avg is None:
        decision = "нет оценок"
    elif votes["отклонить"] * 2 >= len(opinions) or avg < 4.5:
        decision = "идея не прошла фокус-группу"
    elif votes["поддержать"] * 2 > len(opinions) and avg >= 7:
        decision = "идею поддерживают"
    else:
        decision = "идею стоит доработать"
    return {"average_score": avg, "votes": votes, "decision": decision}


def results_context(sim: dict) -> str:
    """Короткая текстовая сводка результатов симуляции — контекст для фокус-группы."""
    lines = []
    for r in sim.get("results", []):
        f = r["final"]
        lines.append(
            f"{r['name']}: без кассового разрыва в {f['survived']['mean'] * 100:.0f} % прогонов, "
            f"клиентов {f['customers']['mean']:.1f}, MRR {f['mrr']['mean']:.0f} тыс. ₽, "
            f"деньги в конце {f['cash']['mean']:.0f} тыс. ₽"
            + (f", гипотеза подтверждается в {r['hypothesis_probability'] * 100:.0f} % прогонов"
               if r.get("hypothesis_probability") is not None else "")
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Хранилище
# ---------------------------------------------------------------------------


def clean_polygon(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise PolygonError("Ожидается объект полигона")
    name = _text(raw.get("name"), 200)
    if not name:
        raise PolygonError("Нужно название полигона")
    scenarios = [normalize_scenario(s, i) for i, s in enumerate((raw.get("scenarios") or [])[:MAX_SCENARIOS])]
    return {
        "name": name,
        "description": _text(raw.get("description"), 2000),
        "hypothesis": normalize_hypothesis(raw.get("hypothesis")),
        "params": normalize_params(raw.get("params")),
        "scenarios": scenarios,
        "panel": normalize_panel(raw.get("panel")),
        "idea": _text(raw.get("idea"), 4000),
        "tags": [_text(t, 40) for t in (raw.get("tags") or [])[:8] if _text(t, 40)],
        "project_id": _text(raw.get("project_id"), 20),
    }


class PolygonStore:
    def __init__(self, root: Path, examples_dir: Path) -> None:
        self.root = Path(root)
        self.examples_dir = Path(examples_dir)

    def _dir(self, user_id: str) -> Path:
        if not USER_ID_RE.match(user_id or ""):
            raise PolygonError("Некорректный пользователь")
        return self.root / user_id

    def examples(self) -> list:
        items = []
        if self.examples_dir.is_dir():
            for path in sorted(self.examples_dir.glob("pg-*.json")):
                try:
                    card = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                card["example"] = True
                items.append(card)
        return items

    def list(self, user_id: str) -> list:
        folder = self._dir(user_id)
        items = []
        if folder.is_dir():
            for path in folder.glob("pg-*.json"):
                try:
                    items.append(json.loads(path.read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    continue
        items.sort(key=lambda c: c.get("updated_at", 0), reverse=True)
        return items

    def get(self, polygon_id: str, user_id: str | None = None) -> dict | None:
        if not POLYGON_ID_RE.match(polygon_id or ""):
            return None
        for card in self.examples():
            if card.get("id") == polygon_id:
                return card
        if user_id:
            path = self._dir(user_id) / f"{polygon_id}.json"
            if path.is_file():
                try:
                    return json.loads(path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    return None
        return None

    def save(self, user_id: str, raw: dict, author: str = "") -> dict:
        data = clean_polygon(raw)
        folder = self._dir(user_id)
        pid = str(raw.get("id") or "")
        existing = None
        if POLYGON_ID_RE.match(pid):
            path = folder / f"{pid}.json"
            if path.is_file():
                existing = json.loads(path.read_text(encoding="utf-8"))
        if existing is None:
            pid = "pg-" + secrets.token_hex(5)
        now = int(time.time())
        card = {
            "id": pid,
            "owner_id": user_id,
            "author": (existing or {}).get("author") or author,
            "created_at": (existing or {}).get("created_at") or now,
            "updated_at": now,
            **data,
        }
        for key in ("last_run", "last_panel"):
            if key in raw and isinstance(raw[key], dict):
                card[key] = raw[key]
            elif existing and key in existing:
                card[key] = existing[key]
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / f".{pid}.tmp"
        tmp.write_text(json.dumps(card, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(folder / f"{pid}.json")
        return card

    def delete(self, user_id: str, polygon_id: str) -> bool:
        if not POLYGON_ID_RE.match(polygon_id or ""):
            return False
        path = self._dir(user_id) / f"{polygon_id}.json"
        if path.is_file():
            path.unlink()
            return True
        return False


EXAMPLES_DIR = Path(__file__).resolve().parents[2] / "data" / "polygons"


@lru_cache(maxsize=1)
def get_store() -> PolygonStore:
    return PolygonStore(get_settings().runtime_dir / "polygons", EXAMPLES_DIR)
