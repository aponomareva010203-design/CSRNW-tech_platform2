"""«Запросы компаний» и «Кабинет заказчика»: тип аккаунта, готовность запроса,
публикация только квалифицированного запроса, отклики команд, карта болей."""

import json
from pathlib import Path

import pytest

from api.runtime import challenges
from api.runtime.config import get_settings

ADMIN_LOGIN = "a.ponomareva@csr-nw.ru"
ADMIN_PASSWORD = "1234"
DATA = Path(__file__).resolve().parent.parent / "data"

QUALIFIED = {
    "title": "Жирные стоки: убрать превышения на сбросе",
    "company": "Тестовый комбинат",
    "pain": "После мойки оборудования в стоки уходят жиры, жироуловители не справляются в пиковые смены, пробы показывают превышения.",
    "who_suffers": "Главный инженер и эколог комбината",
    "cost_of_problem": "6 млн ₽ в год штрафов",
    "success_criteria": "Не более 1 превышения в месяц за 3 месяца пилота",
    "freedom": "Способ решения любой: биология, сорбенты, цифровой прогноз",
    "owner_name": "Сергеева И.",
    "owner_role": "Главный эколог",
}


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    from api.routers import auth as auth_router

    monkeypatch.setenv("AIOS_ADMIN_LOGIN", ADMIN_LOGIN)
    monkeypatch.setenv("AIOS_ADMIN_PASSWORD", ADMIN_PASSWORD)
    monkeypatch.setenv("AIOS_RUNTIME_DIR", str(tmp_path / "rt"))
    monkeypatch.setenv("AIOS_SMTP_HOST", "")
    caches = (get_settings, challenges.get_store, auth_router.get_user_store,
              auth_router.get_token_store, auth_router.get_confirmation_store)
    for c in caches:
        c.cache_clear()
    yield
    for c in caches:
        c.cache_clear()


def _client():
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


def _login(client, login, password):
    resp = client.post("/api/auth/login", json={"login": login, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}, resp.json()["user"]


def _user(client, login, account_type="startup"):
    """Зарегистрированный и подтверждённый пользователь нужного типа."""
    from api.routers import auth as auth_router

    resp = client.post("/api/auth/register", json={
        "login": login, "password": "pass1234", "consent_pdn": True, "consent_policy": True,
        "account_type": account_type,
    })
    assert resp.status_code == 201, resp.text
    store = auth_router.get_user_store()
    user = store.get_by_login(login)
    store.confirm(user)
    return _login(client, login, "pass1234")


def test_quality_checklist_requires_qualified_customer():
    empty = challenges.quality({})
    assert empty["score"] == 0 and not empty["qualified"]
    assert "Название запроса" in empty["missing_required"]

    full = challenges.quality(QUALIFIED)
    assert full["qualified"], full["missing_required"]
    assert 0 < full["score"] <= 100

    # результат без числа — не измерим
    vague = challenges.quality({**QUALIFIED, "success_criteria": "Чтобы стало лучше и чище"})
    assert not vague["qualified"]
    assert any("измерим" in m for m in vague["missing_required"])


def test_demo_challenges_are_qualified():
    items = challenges.demo_items()
    assert len(items) >= 3
    raw = json.loads((DATA / "challenges.json").read_text(encoding="utf-8"))
    assert len(raw["items"]) == len(items)
    for card in items:
        assert card["demo"] and card["status"] == "published"
        assert card["format"] in challenges.FORMATS
        assert challenges.quality(card)["qualified"], card["id"]


def test_account_type_on_register_and_switch():
    client = _client()
    h, user = _user(client, "company@example.com", "company")
    assert user["account_type"] == "company"

    h2, user2 = _user(client, "team@example.com")
    assert user2["account_type"] == "startup"

    # сам сменить тип аккаунта нельзя: компания не откроет себе инструменты стартапа
    assert client.patch("/api/auth/account-type", json={"account_type": "startup"}, headers=h).status_code == 403
    assert client.patch("/api/auth/account-type", json={"account_type": "company"}, headers=h2).status_code == 403

    # администратор переключает свой режим и меняет тип другим
    ha, _ = _login(client, ADMIN_LOGIN, ADMIN_PASSWORD)
    resp = client.patch("/api/auth/account-type", json={"account_type": "company"}, headers=ha)
    assert resp.status_code == 200 and resp.json()["account_type"] == "company"
    assert client.patch("/api/auth/account-type", json={"account_type": "investor"}, headers=ha).status_code == 422
    resp = client.patch(f"/api/admin/users/{user2['id']}/account-type", json={"account_type": "company"}, headers=ha)
    assert resp.status_code == 200 and resp.json()["account_type"] == "company"
    assert client.get("/api/auth/me", headers=h2).json()["account_type"] == "company"
    assert client.patch(f"/api/admin/users/{user2['id']}/account-type", json={"account_type": "startup"},
                        headers=h).status_code == 403
    # неизвестный тип при регистрации отклоняется
    bad = client.post("/api/auth/register", json={
        "login": "x@example.com", "password": "pass1234", "consent_pdn": True,
        "consent_policy": True, "account_type": "admin"})
    assert bad.status_code == 422


def test_company_account_gets_only_customer_tools(monkeypatch):
    """Компании-заказчику закрыты инструменты команды стартапа: проекты,
    полигоны, RAG-базы и онтологии, агенты стартапа в чате, отклики на запросы.
    Функционал заказчика (кабинет, запросы, агент для компаний) открыт."""
    from api.routers import chat as chat_router

    client = _client()
    hc, _ = _user(client, "company@example.com", "company")
    ht, _ = _user(client, "team@example.com")

    for path in ("/api/projects", "/api/polygons", "/api/rag", "/api/ontologies"):
        assert client.get(path, headers=hc).status_code == 403, path
        assert client.get(path, headers=ht).status_code == 200, path
    assert client.get("/api/reminders", headers=hc).json() == {"items": []}

    # функционал заказчика доступен
    assert client.get("/api/company", headers=hc).status_code == 200
    assert client.get("/api/challenges", headers=hc).status_code == 200
    assert client.post("/api/challenges", json={"title": "Запрос"}, headers=hc).status_code == 201
    # откликаются только команды стартапов
    resp = client.post("/api/challenges/ch-demo01/responses", json={
        "team": "Отдел", "approach": "Попробуем решить своими силами и силами подрядчика"}, headers=hc)
    assert resp.status_code == 403

    # чат: агенты команды стартапа компании не запускаются
    monkeypatch.setattr(chat_router, "get_provider", lambda *a, **k: object())
    resp = client.post("/api/chat", json={"message": "привет", "skill_ids": ["hypothesis-tester"]}, headers=hc)
    assert resp.status_code == 403

    # подсказки агентов — только агенты для компаний
    q = "помогите сформулировать запрос и проверить гипотезу"
    company_ids = [s["id"] for s in client.get("/api/chat/skills-suggest", params={"q": q}, headers=hc).json()["items"]]
    team_ids = [s["id"] for s in client.get("/api/chat/skills-suggest", params={"q": q}, headers=ht).json()["items"]]
    assert company_ids == ["company-request-architect"]
    assert "hypothesis-tester" in team_ids

    # инструменты стартапа вырезаются из реестра чата компании
    reg = chat_router.get_registry().without(chat_router.STARTUP_ONLY_TOOLS)
    assert not reg.has("get_projects") and not reg.has("run_polygon") and reg.has("search_corpus")


def test_challenge_lifecycle_and_responses():
    client = _client()
    hc, company = _user(client, "company@example.com", "company")
    ht, team = _user(client, "team@example.com")

    # стартап не создаёт запросы
    assert client.post("/api/challenges", json={"title": "x"}, headers=ht).status_code == 403

    card = client.post("/api/challenges", json={"title": "Черновик запроса"}, headers=hc).json()
    cid = card["id"]
    assert card["status"] == "draft" and card["is_owner"]

    # черновик виден только владельцу; демо-запросы видны всем
    team_list = client.get("/api/challenges", headers=ht).json()["items"]
    assert cid not in [c["id"] for c in team_list]
    assert any(c.get("demo") for c in team_list)
    assert client.get(f"/api/challenges/{cid}", headers=ht).status_code == 404

    # неквалифицированный запрос не публикуется
    resp = client.patch(f"/api/challenges/{cid}", json={"status": "published"}, headers=hc)
    assert resp.status_code == 422 and "Не хватает" in resp.json()["detail"]

    # чужой запрос не изменить
    assert client.patch(f"/api/challenges/{cid}", json={"title": "взлом"}, headers=ht).status_code == 403

    resp = client.patch(f"/api/challenges/{cid}", json={**QUALIFIED, "status": "published"}, headers=hc)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "published" and resp.json()["quality"]["qualified"]

    # команда видит и откликается
    assert cid in [c["id"] for c in client.get("/api/challenges", headers=ht).json()["items"]]
    short = client.post(f"/api/challenges/{cid}/responses", json={"team": "ЛузгаСорб", "approach": "коротко"}, headers=ht)
    assert short.status_code == 422
    r = client.post(f"/api/challenges/{cid}/responses", json={
        "team": "ЛузгаСорб", "approach": "Сорбционные кассеты на выпуске плюс прогноз пиковых сбросов по графику моек",
        "needs": "Данные анализов", "stage": "Уровень 5"}, headers=ht)
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    # компания не откликается на свой запрос
    assert client.post(f"/api/challenges/{cid}/responses", json={"team": "x", "approach": "x" * 30}, headers=hc).status_code == 400

    # владелец видит все отклики и меняет статус; команда — только свои
    owner_view = client.get(f"/api/challenges/{cid}/responses", headers=hc).json()["items"]
    assert [x["id"] for x in owner_view] == [rid]
    assert client.patch(f"/api/challenges/{cid}/responses/{rid}", json={"status": "pilot"}, headers=ht).status_code == 403
    upd = client.patch(f"/api/challenges/{cid}/responses/{rid}", json={"status": "pilot", "comment": "Ждём на встречу"}, headers=hc)
    assert upd.status_code == 200 and upd.json()["status"] == "pilot"
    mine = client.get("/api/challenge-responses/mine", headers=ht).json()["items"]
    assert mine[0]["status"] == "pilot" and mine[0]["challenge_title"] == QUALIFIED["title"]

    # отклик на демо-запрос сохраняется, демо не изменить и не удалить
    assert client.post("/api/challenges/ch-demo01/responses", json={
        "team": "ЛузгаСорб", "approach": "Сорбент из лузги для доочистки стоков после жироуловителя"}, headers=ht).status_code == 201
    assert client.patch("/api/challenges/ch-demo01", json={"title": "x"}, headers=hc).status_code == 400
    assert client.delete("/api/challenges/ch-demo01", headers=hc).status_code == 400

    # удаление — только владельцем
    assert client.delete(f"/api/challenges/{cid}", headers=ht).status_code == 403
    assert client.delete(f"/api/challenges/{cid}", headers=hc).json()["ok"] is True


def test_company_profile_and_pain_map():
    client = _client()
    hc, _ = _user(client, "company@example.com", "company")
    ht, _ = _user(client, "team@example.com")

    assert client.get("/api/company", headers=ht).json()["account_type"] == "startup"
    assert client.put("/api/company", json={"pains": []}, headers=ht).status_code == 403

    resp = client.put("/api/company", json={
        "profile": {"name": "Завод", "industry": "Машиностроение", "champion": "Никитин Р."},
        "pains": [
            {"department": "Энергетика", "pain": "Компрессоры работают на полной мощности", "value": 9, "feasibility": "x"},
            {"pain": "   "},
        ],
    }, headers=hc)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["profile"]["name"] == "Завод"
    assert len(data["pains"]) == 1
    pain = data["pains"][0]
    assert pain["value"] == 5 and pain["feasibility"] == 3 and pain["id"].startswith("p-")
    assert client.get("/api/company", headers=hc).json()["pains"][0]["id"] == pain["id"]


def test_quality_endpoint():
    client = _client()
    h, _ = _login(client, ADMIN_LOGIN, ADMIN_PASSWORD)
    q = client.post("/api/challenges/quality", json=QUALIFIED, headers=h).json()
    assert q["qualified"] and q["score"] == 72  # только обязательные пункты
