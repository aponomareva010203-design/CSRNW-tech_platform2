"""«Путь стартапа», новые агенты команды и демо-кейс «Рабочего стола стартапа».

Карта пути (data/startup-journey.json) читается фронтендом без сервера,
поэтому её целостность проверяем здесь: уровни по порядку, уникальные id
квестов и ворот, известные правила автопроверки, существующие агенты."""

import json
import re
from pathlib import Path

from api.runtime import datarepo

DATA = Path(__file__).resolve().parent.parent / "data"
FRONT = Path(__file__).resolve().parent.parent / "frontend"

NEW_AGENTS = {
    "hypothesis-sprinter": "Генератор и быстрая проверка гипотез",
    "startup-tracker": "Трекер-наставник",
    "funding-scout": "Фандрайзер",
    "risk-manager": "Риск-менеджер",
    "valuation-advisor": "Оценщик стоимости стартапа",
    "company-request-architect": "Архитектор запроса компании",
}
AUTO_RE = re.compile(r"^(interviews|loi|paid|trl|crl|irl|ltv_cac|payback|runway):\d+(\.\d+)?$|^hyp:(problem|segment|value|price|channel|growth)$|^milestone:.+$")


def _load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def test_journey_map_is_consistent():
    j = _load("startup-journey.json")
    skills = {s["id"] for s in _load("skills.json")["items"]}
    worlds = {w["key"] for w in j["worlds"]}
    levels = j["levels"]
    assert [lv["n"] for lv in levels] == list(range(1, 11))
    ids = []
    for lv in levels:
        assert lv["world"] in worlds
        for key in ("title", "what_happens", "goal", "duration", "readiness"):
            assert lv[key], (lv["n"], key)
        assert len(lv["quests"]) >= 4 and len(lv["gates"]) >= 2, lv["n"]
        for q in lv["quests"]:
            ids.append(q["id"])
            tool = q.get("tool")
            if tool and tool.get("agent"):
                assert tool["agent"] in skills, tool["agent"]
            elif tool:
                page = tool["href"].split("#")[0]
                assert (FRONT / page).is_file(), page
        for g in lv["gates"]:
            ids.append(g["id"])
            if g.get("auto"):
                assert AUTO_RE.match(g["auto"]), g["auto"]
        for agent in lv["agents"]:
            assert agent in skills, agent
    assert len(ids) == len(set(ids)), "id квестов и ворот должны быть уникальны"
    # самооценка указывает на существующие уровни, ранги — по возрастанию очков
    assert {d["level"] for d in j["diagnostic"]} <= {lv["n"] for lv in levels}
    xps = [r["xp"] for r in j["ranks"]]
    assert xps == sorted(xps) and xps[0] == 0


def test_new_agents_in_catalog_with_full_template():
    from api.runtime.prompts import SKILL_BODY_LIMIT

    for skill_id, name in NEW_AGENTS.items():
        skill = datarepo.get_skill(skill_id)
        assert skill, skill_id
        meta = datarepo.skill_meta(skill_id)
        assert meta.get("name", "").startswith(name), skill_id
        assert meta.get("triggers"), skill_id
        body = datarepo.skill_body(skill, limit=SKILL_BODY_LIMIT)
        for section in ("## Назначение", "## Роль", "## Навыки (skills)", "## Входные данные",
                        "## Выходные данные", "## Ограничения"):
            assert section in body, (skill_id, section)
        assert (DATA / "icons" / f"{skill_id}.svg").is_file()
    assert datarepo.get_skill("company-request-architect")["category"] == "company"
    cats = {c["key"] for c in _load("skills.json")["categories"]}
    assert "company" in cats


def test_new_agents_are_suggested_by_triggers():
    found = datarepo.suggest_skills("Помогите собрать реестр рисков нашего стартапа")
    assert "risk-manager" in [s["id"] for s in found]
    found = datarepo.suggest_skills("Сколько стоит наш стартап перед раундом?")
    assert "valuation-advisor" in [s["id"] for s in found]
    found = datarepo.suggest_skills("Как нам сформулировать запрос для студенческих стартапов?")
    assert "company-request-architect" in [s["id"] for s in found]


def test_dashboard_demo_case_is_eco_and_has_risks():
    d = _load("dashboard.json")
    assert "ЛузгаСорб" in d["startup"] and "демо" in d["startup"]
    blob = json.dumps(d, ensure_ascii=False)
    assert "ВиброСенс" not in blob
    assert d["risks"], "блок risks для виджета «Риски стартапа»"
    for r in d["risks"]:
        assert r["category"] in {"tech", "market", "finance", "legal", "team", "regulatory"}
        assert 1 <= r["probability"] <= 5 and 1 <= r["impact"] <= 5
        assert r["status"] in {"open", "mitigating", "closed"}
    # демо-полигоны — на том же кейсе
    for pg in ("pg-1a0e5c0201.json", "pg-1a0e5c0202.json"):
        text = (DATA / "polygons" / pg).read_text(encoding="utf-8")
        assert "ЛузгаСорб" in text and "ВиброСенс" not in text
