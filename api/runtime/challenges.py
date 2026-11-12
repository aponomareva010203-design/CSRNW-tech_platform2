"""Запросы компаний для студенческих стартапов («Кабинет заказчика»).

Проблема, которую решает раздел: идеи студентов часто не релевантны рынку,
а компании почти никогда не умеют выступить квалифицированным заказчиком —
в них нет человека или процесса, который выявляет боли и формулирует задачу.
Поэтому запрос здесь — не техническое задание, а «открытый вызов»:

* компания фиксирует боль, её цену и измеримый результат, а также
  ресурсы, которые даст (данные, площадка, эксперт, бюджет пилота);
* отдельно описывает, что зафиксировано (ограничения), и где у команды
  свобода — способ решения остаётся за студентами (их интерес к своему,
  творческому решению сохраняется);
* у запроса есть владелец в компании и тот, кто принимает решение о
  внедрении, — без них пилот не превратится в закупку.

Готовность запроса считается чек-листом quality(): опубликовать запрос
можно, только когда выполнены обязательные пункты «квалифицированного
заказчика». Так процесс формулирования запроса отлаживается в компании.

Хранилище — JSON-файлы в AIOS_RUNTIME_DIR/challenges:
  items/{id}.json        — запросы компаний (владелец — owner_id);
  responses/{id}.json    — отклики команд на запрос (в т.ч. на демо-запросы);
  companies/{user}.json  — профиль компании и её карта болей.
Демо-запросы (только чтение) — data/challenges.json.
"""

import json
import re
import secrets
import time
from functools import lru_cache
from pathlib import Path

from .config import get_settings

DEMO_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "challenges.json"

ID_RE = re.compile(r"^ch-[a-z0-9]{6,16}$")
RESP_ID_RE = re.compile(r"^r-[a-f0-9]{8}$")
USER_ID_RE = re.compile(r"^[a-f0-9]{12}$")

# Поле → лимит символов. Порядок совпадает с шагами конструктора запроса.
TEXT_FIELDS = {
    "title": 160,
    "company": 160,
    "industry": 80,
    "department": 120,
    "pain": 2000,              # что происходит: боль словами компании
    "who_suffers": 600,        # кто страдает и как часто
    "current_solution": 1000,  # как решают сейчас и почему этого мало
    "cost_of_problem": 600,    # цена проблемы: деньги, время, риски
    "success_criteria": 1000,  # что компания примет как результат (измеримо)
    "fixed": 1000,             # что зафиксировано: ограничения, требования
    "freedom": 1000,           # где свобода для команды: способ решения открыт
    "resources": 1000,         # что даёт компания: данные, площадка, эксперт
    "budget": 300,             # бюджет пилота или форма вознаграждения
    "timeline": 200,           # сроки
    "owner_name": 120,         # владелец запроса в компании («чемпион»)
    "owner_role": 160,
    "decision_maker": 200,     # кто принимает решение о внедрении/закупке
    "next_step": 600,          # что будет при успехе: закупка, инвестиции, найм
    "contact": 200,
}

FORMATS = {
    "challenge": "Открытый вызов",
    "pilot": "Пилот на площадке компании",
    "rnd": "Совместная НИОКР",
    "data": "Кейс с данными компании",
    "venture": "Совместный стартап / корпоративный венчур",
}
STATUSES = {
    "draft": "Черновик",
    "published": "Опубликован",
    "in_pilot": "Идёт пилот",
    "closed": "Закрыт",
}
RESPONSE_STATUSES = {
    "new": "Новый",
    "interested": "Интересно — назначить встречу",
    "pilot": "Договорились о пилоте",
    "declined": "Не подходит",
}
RESPONSE_FIELDS = {
    "team": 160,      # название команды / стартапа
    "approach": 2000, # идея подхода — свободно, своими словами
    "needs": 1000,    # что нужно от компании
    "stage": 120,     # уровень на «Пути стартапа» или стадия
    "contact": 200,
    "comment": 1000,  # комментарий компании к отклику
}
PAIN_FIELDS = {
    "department": 120,
    "pain": 600,
    "who": 300,
    "frequency": 120,
    "cost": 300,
}
PROFILE_FIELDS = {
    "name": 160,
    "industry": 80,
    "city": 80,
    "size": 80,
    "champion": 160,   # кто в компании отвечает за работу со стартапами
    "about": 1000,
}
MAX_PAINS = 60
MAX_RESPONSES = 300

# Чек-лист квалифицированного заказчика: (ключ, подпись, вес, обязателен?).
QUALITY = (
    ("pain", "Боль описана словами компании (что происходит, где, как часто)", 15, True),
    ("who_suffers", "Понятно, кто страдает от проблемы", 8, True),
    ("cost_of_problem", "Есть цена проблемы: деньги, время или риски", 12, True),
    ("success_criteria", "Результат измерим: есть число или порог", 15, True),
    ("freedom", "Указано, где у команды свобода решения", 12, True),
    ("owner", "Есть владелец запроса в компании (имя и должность)", 10, True),
    ("decision_maker", "Известно, кто принимает решение о внедрении", 8, False),
    ("resources", "Компания даёт ресурсы: данные, площадку, эксперта", 8, False),
    ("current_solution", "Описано, как решают сейчас", 5, False),
    ("fixed", "Названы ограничения и обязательные требования", 3, False),
    ("budget", "Указан бюджет пилота или форма вознаграждения", 2, False),
    ("next_step", "Понятно, что будет при успехе пилота", 2, False),
)
DIGIT_RE = re.compile(r"\d")


class ChallengeError(ValueError):
    """Некорректные данные запроса, отклика или профиля."""


def _clean(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _filled(card: dict, key: str, min_len: int = 10) -> bool:
    return len(str(card.get(key) or "").strip()) >= min_len


def quality(card: dict) -> dict:
    """Готовность запроса: баллы 0–100, чек-лист и недостающие обязательные пункты."""
    checks = {
        "pain": _filled(card, "pain", 60),
        "who_suffers": _filled(card, "who_suffers"),
        "cost_of_problem": _filled(card, "cost_of_problem", 5),
        "success_criteria": _filled(card, "success_criteria") and bool(DIGIT_RE.search(card.get("success_criteria") or "")),
        "freedom": _filled(card, "freedom", 20),
        "owner": _filled(card, "owner_name", 3) and _filled(card, "owner_role", 3),
        "decision_maker": _filled(card, "decision_maker", 3),
        "resources": _filled(card, "resources"),
        "current_solution": _filled(card, "current_solution"),
        "fixed": _filled(card, "fixed"),
        "budget": _filled(card, "budget", 2),
        "next_step": _filled(card, "next_step"),
    }
    items, score, missing = [], 0, []
    for key, label, weight, required in QUALITY:
        ok = bool(checks.get(key))
        score += weight if ok else 0
        items.append({"key": key, "label": label, "ok": ok, "required": required, "weight": weight})
        if required and not ok:
            missing.append(label)
    if not _filled(card, "title", 5):
        missing.insert(0, "Название запроса")
    return {"score": score, "items": items, "missing_required": missing, "qualified": not missing}


def clean_card(raw: dict, base: dict | None = None) -> dict:
    """Поля запроса из тела запроса (частичное обновление поверх base)."""
    card = dict(base or {})
    for key, limit in TEXT_FIELDS.items():
        if key in raw:
            card[key] = _clean(raw.get(key), limit)
    if "format" in raw:
        fmt = str(raw.get("format") or "")
        if fmt not in FORMATS:
            raise ChallengeError("Неизвестный формат сотрудничества")
        card["format"] = fmt
    if "tags" in raw:
        tags = raw.get("tags") or []
        if not isinstance(tags, list):
            raise ChallengeError("tags — список строк")
        card["tags"] = [_clean(t, 40) for t in tags if str(t or "").strip()][:8]
    if "pain_id" in raw:
        card["pain_id"] = _clean(raw.get("pain_id"), 20)
    card.setdefault("format", "challenge")
    card.setdefault("tags", [])
    return card


def _read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def demo_items() -> list:
    """Демо-запросы компаний (data/challenges.json, только чтение)."""
    data = _read(DEMO_PATH) or {}
    items = []
    for raw in data.get("items", []):
        if not ID_RE.match(str(raw.get("id") or "")):
            continue
        card = clean_card(raw)
        card.update({
            "id": raw["id"],
            "owner_id": "",
            "status": raw.get("status") if raw.get("status") in STATUSES else "published",
            "demo": True,
            "created_at": raw.get("created_at") or 0,
            "updated_at": raw.get("created_at") or 0,
        })
        items.append(card)
    return items


class ChallengeStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        for sub in ("items", "responses", "companies"):
            (root / sub).mkdir(parents=True, exist_ok=True)

    # ---------- запросы ----------

    def _item_path(self, cid: str) -> Path:
        if not ID_RE.match(cid or ""):
            raise ChallengeError("Некорректный идентификатор запроса")
        return self.root / "items" / f"{cid}.json"

    def own_items(self) -> list:
        out = []
        for path in sorted((self.root / "items").glob("ch-*.json")):
            card = _read(path)
            if isinstance(card, dict) and card.get("id"):
                out.append(card)
        return out

    def get(self, cid: str) -> dict | None:
        try:
            path = self._item_path(cid)
        except ChallengeError:
            return None
        card = _read(path)
        if isinstance(card, dict):
            return card
        for demo in demo_items():
            if demo["id"] == cid:
                return demo
        return None

    def create(self, owner_id: str, raw: dict) -> dict:
        card = clean_card(raw)
        now = time.time()
        card.update({
            "id": "ch-" + secrets.token_hex(5),
            "owner_id": owner_id,
            "status": "draft",
            "demo": False,
            "created_at": now,
            "updated_at": now,
        })
        if not card.get("title"):
            card["title"] = "Новый запрос"
        _write(self._item_path(card["id"]), card)
        return card

    def update(self, card: dict, raw: dict) -> dict:
        if card.get("demo"):
            raise ChallengeError("Демо-запрос нельзя изменить")
        new = clean_card(raw, base=card)
        if "status" in raw:
            status = str(raw.get("status") or "")
            if status not in STATUSES:
                raise ChallengeError("Неизвестный статус запроса")
            if status != "draft":
                q = quality(new)
                if not q["qualified"]:
                    raise ChallengeError(
                        "Запрос ещё не готов к публикации. Не хватает: " + "; ".join(q["missing_required"])
                    )
            new["status"] = status
            if status == "published" and not new.get("published_at"):
                new["published_at"] = time.time()
        new["updated_at"] = time.time()
        _write(self._item_path(new["id"]), new)
        return new

    def delete(self, cid: str) -> bool:
        path = self._item_path(cid)
        if not path.exists():
            return False
        path.unlink()
        return True

    def visible(self, user_id: str, is_admin: bool = False) -> list:
        """Опубликованные запросы всех компаний + свои черновики + демо."""
        items = [c for c in self.own_items()
                 if c.get("status") != "draft" or c.get("owner_id") == user_id or is_admin]
        items.sort(key=lambda c: c.get("updated_at") or 0, reverse=True)
        return items + demo_items()

    # ---------- отклики команд ----------

    def _resp_path(self, cid: str) -> Path:
        self._item_path(cid)  # проверка формата id
        return self.root / "responses" / f"{cid}.json"

    def responses(self, cid: str) -> list:
        data = _read(self._resp_path(cid))
        return data if isinstance(data, list) else []

    def add_response(self, cid: str, user: dict, raw: dict) -> dict:
        approach = _clean(raw.get("approach"), RESPONSE_FIELDS["approach"])
        team = _clean(raw.get("team"), RESPONSE_FIELDS["team"])
        if len(approach) < 20:
            raise ChallengeError("Опишите идею подхода хотя бы в паре предложений")
        if not team:
            raise ChallengeError("Укажите команду или стартап")
        items = self.responses(cid)
        if len(items) >= MAX_RESPONSES:
            raise ChallengeError("Слишком много откликов на этот запрос")
        resp = {
            "id": "r-" + secrets.token_hex(4),
            "challenge_id": cid,
            "user_id": user["id"],
            "user_name": user.get("name") or user.get("login") or "",
            "team": team,
            "approach": approach,
            "needs": _clean(raw.get("needs"), RESPONSE_FIELDS["needs"]),
            "stage": _clean(raw.get("stage"), RESPONSE_FIELDS["stage"]),
            "contact": _clean(raw.get("contact"), RESPONSE_FIELDS["contact"]),
            "status": "new",
            "comment": "",
            "created_at": time.time(),
        }
        items.append(resp)
        _write(self._resp_path(cid), items)
        return resp

    def set_response(self, cid: str, rid: str, raw: dict) -> dict:
        if not RESP_ID_RE.match(rid or ""):
            raise ChallengeError("Некорректный идентификатор отклика")
        items = self.responses(cid)
        for resp in items:
            if resp.get("id") == rid:
                if "status" in raw:
                    status = str(raw.get("status") or "")
                    if status not in RESPONSE_STATUSES:
                        raise ChallengeError("Неизвестный статус отклика")
                    resp["status"] = status
                if "comment" in raw:
                    resp["comment"] = _clean(raw.get("comment"), RESPONSE_FIELDS["comment"])
                resp["updated_at"] = time.time()
                _write(self._resp_path(cid), items)
                return resp
        raise KeyError(rid)

    def user_responses(self, user_id: str) -> list:
        out = []
        for path in (self.root / "responses").glob("ch-*.json"):
            data = _read(path)
            if isinstance(data, list):
                out.extend(r for r in data if r.get("user_id") == user_id)
        out.sort(key=lambda r: r.get("created_at") or 0, reverse=True)
        return out

    # ---------- профиль компании и карта болей ----------

    def _company_path(self, user_id: str) -> Path:
        if not USER_ID_RE.match(user_id or ""):
            raise ChallengeError("Некорректный пользователь")
        return self.root / "companies" / f"{user_id}.json"

    def company(self, user_id: str) -> dict:
        data = _read(self._company_path(user_id))
        if not isinstance(data, dict):
            data = {}
        return {"profile": data.get("profile") or {}, "pains": data.get("pains") or []}

    def save_company(self, user_id: str, raw: dict) -> dict:
        current = self.company(user_id)
        if "profile" in raw:
            prof = raw.get("profile") or {}
            if not isinstance(prof, dict):
                raise ChallengeError("profile — объект")
            current["profile"] = {k: _clean(prof.get(k), lim) for k, lim in PROFILE_FIELDS.items()}
        if "pains" in raw:
            pains = raw.get("pains") or []
            if not isinstance(pains, list) or len(pains) > MAX_PAINS:
                raise ChallengeError(f"pains — список до {MAX_PAINS} болей")
            cleaned = []
            for p in pains:
                if not isinstance(p, dict) or not str(p.get("pain") or "").strip():
                    continue
                item = {k: _clean(p.get(k), lim) for k, lim in PAIN_FIELDS.items()}
                pid = str(p.get("id") or "")
                item["id"] = pid if re.match(r"^p-[a-f0-9]{6}$", pid) else "p-" + secrets.token_hex(3)
                for score in ("value", "feasibility"):
                    try:
                        item[score] = max(1, min(5, int(p.get(score) or 3)))
                    except (TypeError, ValueError):
                        item[score] = 3
                item["data_available"] = bool(p.get("data_available"))
                item["challenge_id"] = _clean(p.get("challenge_id"), 20)
                cleaned.append(item)
            current["pains"] = cleaned
        _write(self._company_path(user_id), current)
        return current


@lru_cache(maxsize=1)
def get_store() -> ChallengeStore:
    """Синглтон хранилища запросов; в тестах сбрасывается cache_clear()."""
    return ChallengeStore(get_settings().runtime_dir / "challenges")
