"""HTTP-слой «Запросов компаний» и «Кабинета заказчика».

GET    /api/challenges                      — опубликованные запросы компаний
                                              (+ свои черновики, + демо);
POST   /api/challenges                      — новый черновик запроса (аккаунт
                                              «компания» или администратор);
POST   /api/challenges/quality              — готовность запроса без сохранения
                                              (живой индикатор конструктора);
GET    /api/challenges/{id}                 — один запрос;
PATCH  /api/challenges/{id}                 — правка и смена статуса (владелец
                                              или администратор); публикация —
                                              только квалифицированного запроса;
DELETE /api/challenges/{id}                 — удаление (владелец или админ);
POST   /api/challenges/{id}/responses       — отклик команды стартапа;
GET    /api/challenges/{id}/responses       — отклики: владельцу — все,
                                              остальным — только свои;
PATCH  /api/challenges/{id}/responses/{rid} — статус и комментарий к отклику
                                              (владелец запроса или админ);
GET    /api/challenge-responses/mine        — отклики текущего пользователя;
GET    /api/company                         — профиль компании и карта болей;
PUT    /api/company                         — сохранить профиль и/или боли.
"""

from fastapi import APIRouter, Body, Depends, HTTPException

from ..runtime import challenges
from ..runtime.challenges import ChallengeError
from ..runtime.users import ACCOUNT_COMPANY, ROLE_ADMIN, account_type
from .auth import get_current_user

router = APIRouter(prefix="/api")


def _is_admin(user: dict) -> bool:
    return user.get("role") == ROLE_ADMIN


def _require_company(user: dict) -> None:
    if account_type(user) != ACCOUNT_COMPANY and not _is_admin(user):
        raise HTTPException(
            status_code=403,
            detail="Раздел для компаний-заказчиков: переключите аккаунт в режим компании",
        )


def _public(card: dict, user: dict, store) -> dict:
    out = dict(card)
    q = challenges.quality(card)
    out["quality"] = {"score": q["score"], "qualified": q["qualified"]}
    out["format_title"] = challenges.FORMATS.get(card.get("format"), "")
    out["status_title"] = challenges.STATUSES.get(card.get("status"), "")
    out["is_owner"] = bool(card.get("owner_id")) and card.get("owner_id") == user["id"]
    resp = store.responses(card["id"])
    out["responses_count"] = len(resp)
    out["my_response"] = any(r.get("user_id") == user["id"] for r in resp)
    return out


def _card_or_404(store, cid: str) -> dict:
    card = store.get(cid)
    if card is None:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    return card


def _can_edit(card: dict, user: dict) -> bool:
    return _is_admin(user) or (card.get("owner_id") and card.get("owner_id") == user["id"])


@router.get("/challenges")
def list_challenges(user: dict = Depends(get_current_user)):
    store = challenges.get_store()
    items = [_public(c, user, store) for c in store.visible(user["id"], _is_admin(user))]
    return {
        "items": items,
        "formats": challenges.FORMATS,
        "statuses": challenges.STATUSES,
        "response_statuses": challenges.RESPONSE_STATUSES,
    }


@router.post("/challenges", status_code=201)
def create_challenge(body: dict = Body(default_factory=dict), user: dict = Depends(get_current_user)):
    _require_company(user)
    store = challenges.get_store()
    try:
        card = store.create(user["id"], body)
    except ChallengeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return _public(card, user, store)


@router.post("/challenges/quality")
def challenge_quality(body: dict = Body(default_factory=dict), _: dict = Depends(get_current_user)):
    try:
        card = challenges.clean_card(body)
    except ChallengeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return challenges.quality(card)


@router.get("/challenge-responses/mine")
def my_responses(user: dict = Depends(get_current_user)):
    store = challenges.get_store()
    out = []
    for resp in store.user_responses(user["id"]):
        card = store.get(resp.get("challenge_id", ""))
        item = dict(resp)
        item["challenge_title"] = card.get("title") if card else "Запрос удалён"
        item["company"] = card.get("company") if card else ""
        item["status_title"] = challenges.RESPONSE_STATUSES.get(resp.get("status"), "")
        out.append(item)
    return {"items": out}


@router.get("/challenges/{cid}")
def get_challenge(cid: str, user: dict = Depends(get_current_user)):
    store = challenges.get_store()
    card = _card_or_404(store, cid)
    if card.get("status") == "draft" and not _can_edit(card, user):
        raise HTTPException(status_code=404, detail="Запрос не найден")
    out = _public(card, user, store)
    out["quality"] = challenges.quality(card)
    return out


@router.patch("/challenges/{cid}")
def update_challenge(cid: str, body: dict = Body(default_factory=dict), user: dict = Depends(get_current_user)):
    store = challenges.get_store()
    card = _card_or_404(store, cid)
    if card.get("demo"):
        raise HTTPException(status_code=400, detail="Демо-запрос нельзя изменить — создайте свой")
    if not _can_edit(card, user):
        raise HTTPException(status_code=403, detail="Изменять запрос может только компания-владелец")
    try:
        card = store.update(card, body)
    except ChallengeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return _public(card, user, store)


@router.delete("/challenges/{cid}")
def delete_challenge(cid: str, user: dict = Depends(get_current_user)):
    store = challenges.get_store()
    card = _card_or_404(store, cid)
    if card.get("demo"):
        raise HTTPException(status_code=400, detail="Демо-запрос нельзя удалить")
    if not _can_edit(card, user):
        raise HTTPException(status_code=403, detail="Удалить запрос может только компания-владелец")
    store.delete(cid)
    return {"ok": True}


@router.post("/challenges/{cid}/responses", status_code=201)
def respond(cid: str, body: dict = Body(default_factory=dict), user: dict = Depends(get_current_user)):
    store = challenges.get_store()
    card = _card_or_404(store, cid)
    if card.get("status") not in ("published", "in_pilot"):
        raise HTTPException(status_code=400, detail="Запрос не принимает отклики")
    if card.get("owner_id") == user["id"]:
        raise HTTPException(status_code=400, detail="Нельзя откликнуться на свой запрос")
    try:
        return store.add_response(cid, user, body)
    except ChallengeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/challenges/{cid}/responses")
def list_responses(cid: str, user: dict = Depends(get_current_user)):
    store = challenges.get_store()
    card = _card_or_404(store, cid)
    items = store.responses(cid)
    if not _can_edit(card, user):
        items = [r for r in items if r.get("user_id") == user["id"]]
    return {"items": items, "statuses": challenges.RESPONSE_STATUSES}


@router.patch("/challenges/{cid}/responses/{rid}")
def update_response(cid: str, rid: str, body: dict = Body(default_factory=dict),
                    user: dict = Depends(get_current_user)):
    store = challenges.get_store()
    card = _card_or_404(store, cid)
    if not _can_edit(card, user):
        raise HTTPException(status_code=403, detail="Отклики разбирает компания-владелец запроса")
    try:
        return store.set_response(cid, rid, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="Отклик не найден")
    except ChallengeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/company")
def get_company(user: dict = Depends(get_current_user)):
    data = challenges.get_store().company(user["id"])
    data["account_type"] = account_type(user)
    return data


@router.put("/company")
def save_company(body: dict = Body(default_factory=dict), user: dict = Depends(get_current_user)):
    _require_company(user)
    try:
        data = challenges.get_store().save_company(user["id"], body)
    except ChallengeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    data["account_type"] = account_type(user)
    return data
