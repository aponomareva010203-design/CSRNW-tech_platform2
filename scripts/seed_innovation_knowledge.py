#!/usr/bin/env python3
"""Пересобирает демо-содержимое раздела «Данные и знания» по теме платформы.

Тема — университетский технологический стартап (рабочая среда команды:
гипотезы и CustDev, рынок, экономика продукта, инвестиции, права на
технологию вуза, меры поддержки). Скрипт пишет:

  - data/ontologies.json и data/ontologies/objects/{id}.json — онтологии из
    scripts/seed_knowledge/ontologies.py (граф проверяется validate_graph);
  - data/rag_bases.json — карточки RAG-баз; корпуса документов лежат в
    data/rag/corpus/{rag_id}/*.md и ищутся инструментом search_corpus
    (Qdrant, если он поднят и проиндексирован, иначе — текстовый поиск);
  - data/icons/{id}.svg — логотипы новых карточек;

и удаляет логотипы и графы онтологий/RAG-баз, которых больше нет в каталоге.
Повторный запуск идемпотентен.

Запуск из корня проекта:
    python3 scripts/seed_innovation_knowledge.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from api.runtime.ontologies import validate_graph  # noqa: E402
from seed_knowledge.ontologies import ONTOLOGIES  # noqa: E402

DATA = ROOT / "data"
CORPUS = DATA / "rag" / "corpus"
ARTIFACT_RE = re.compile(r"^(onto|rag)-[a-f0-9]{8,12}$")

RAG_BASES = [
    {
        "id": "rag-1a0e5c0101",
        "name": "Права на технологию вуза: служебный РИД, лицензия, МТК",
        "domain": "Как стартапу оформить права на технологию, созданную в университете",
        "description_ru": (
            "Методические конспекты для команд: служебные РИД и сроки решения работодателя "
            "(ст. 1370 ГК РФ), лицензия и отчуждение (ст. 1234–1235), вклад права в капитал "
            "хозобщества (ст. 103 273-ФЗ), пошаговый путь стартапа к лицензии от вуза и чек-лист "
            "вопросов для ЦТТ."
        ),
        "tags": ["права на технологию", "лицензия", "МТК", "ЦТТ", "служебный РИД"],
        "ontology_id": "onto-1a0e5c0003",
        "references": [
            {"title": "ГК РФ, часть четвёртая", "url": "https://www.consultant.ru/document/cons_doc_LAW_64629/"},
            {"title": "273-ФЗ «Об образовании в РФ», ст. 103", "url": "https://www.consultant.ru/document/cons_doc_LAW_140174/"},
            {"title": "ФИПС — открытые реестры", "url": "https://new.fips.ru/registers-web/"},
        ],
    },
    {
        "id": "rag-1a0e5c0102",
        "name": "Уровни готовности: УГТ/TRL, IRL и экспертиза проектов",
        "domain": "Самооценка зрелости технологии и стартапа по шкалам готовности",
        "description_ru": (
            "Шкала УГТ 1–9 по ГОСТ Р 58048-2017, смежные шкалы IRL/MRL/CRL, правило «застоя» "
            "проекта, оценочный лист экспертного совета и решения Go/Pivot/Hold/Kill — чтобы "
            "команда оценила свой уровень готовности так же, как это сделает эксперт."
        ),
        "tags": ["УГТ", "TRL", "IRL", "экспертиза"],
        "ontology_id": "onto-1a0e5c0002",
        "references": [
            {"title": "ГОСТ Р 58048-2017 «Трансфер технологий. Методические указания по оценке уровня зрелости технологий»", "url": ""},
            {"title": "ЕГИСУ НИОКТР", "url": "https://www.rosrid.ru/"},
        ],
    },
    {
        "id": "rag-1a0e5c0103",
        "name": "Меры поддержки: Фонд содействия инновациям, Платформа УТП, «Приоритет-2030»",
        "domain": "Государственная поддержка университетских проектов и стартапов",
        "description_ru": (
            "Лестница программ Фонда содействия инновациям («УМНИК», «Студенческий стартап», "
            "«Старт», «Развитие», «Коммерциализация»), Платформа университетского "
            "технологического предпринимательства и «Стартап как диплом», «Приоритет-2030» и ПИШ, "
            "федеральный проект «Технологии», сеть университетских стартап-студий и статус малой "
            "технологической компании (478-ФЗ)."
        ),
        "tags": ["гранты", "Фонд содействия инновациям", "Приоритет-2030", "Стартап как диплом", "МТК"],
        "ontology_id": "onto-1a0e5c0004",
        "references": [
            {"title": "Фонд содействия инновациям", "url": "https://fasie.ru/"},
            {"title": "Платформа университетского технологического предпринимательства", "url": "https://univertechpred.ru/"},
            {"title": "Программа «Приоритет-2030»", "url": "https://priority2030.ru/"},
            {"title": "478-ФЗ «О развитии технологических компаний в РФ»",
             "url": "https://legalacts.ru/doc/federalnyi-zakon-ot-04082023-n-478-fz-o-razvitii-tekhnologicheskikh/"},
        ],
    },
    {
        "id": "rag-1a0e5c0104",
        "name": "Методики стартап-студии и акселерации",
        "domain": "Создание и развитие университетских стартапов",
        "description_ru": (
            "Трек стартап-студии по этапам с контрольными точками, роль трекера, формулировка и "
            "проверка гипотез (CustDev, MVP, пилот), юнит-экономика, подготовка к инвестициям и "
            "управление рисками стартапа (реестр, вероятность × влияние, меры)."
        ),
        "tags": ["стартап-студия", "гипотезы", "CustDev", "инвестиции"],
        "ontology_id": "onto-1a0e5c0002",
    },
    {
        "id": "rag-1a0e5c0105",
        "name": "Анализ рынка и конкурентов",
        "domain": "Оценка размера рынка, сегментов и конкурентной среды технологического стартапа",
        "description_ru": (
            "TAM / SAM / SOM методом «снизу вверх» с примером расчёта и чек-листом проверки, "
            "четыре типа альтернатив и карта конкурентов, позиционирование и защитимость, "
            "открытые источники данных о рынке РФ (Росстат, ЕМИСС, ФНС, ГИР БО, ЕИС закупок, ФИПС). "
            "Основа агента «Аналитик рынка»."
        ),
        "tags": ["рынок", "TAM SAM SOM", "конкуренты", "источники данных"],
        "ontology_id": "onto-1a0e5c0001",
        "references": [
            {"title": "Росстат", "url": "https://rosstat.gov.ru/"},
            {"title": "ЕМИСС", "url": "https://www.fedstat.ru/"},
            {"title": "ЕИС в сфере закупок", "url": "https://zakupki.gov.ru/"},
            {"title": "ГИР БО — бухгалтерская отчётность организаций", "url": "https://bo.nalog.ru/"},
        ],
    },
    {
        "id": "rag-1a0e5c0106",
        "name": "Оценка интеллектуальных активов: стандарты и методики",
        "domain": "Оценка интеллектуальных активов: как вуз и инвестор оценивают технологию стартапа",
        "description_ru": (
            "Что считать интеллектуальным активом вуза (шире, чем РИД), стандарты оценки и учёта "
            "(ФСО № 11, ФСО I–VI, ФСБУ 14/2022, СГС «НМА», ISO 56005, IVS 210, Рекомендация ЕС "
            "2023/499), подходы и методы стоимостной оценки (освобождение от роялти, DCF, реальные "
            "опционы), неденежный скоринг РИД и шаблон методики оценки ИА вуза с критериями, весами "
            "и порогами решений. Помогает команде понять, как вуз и инвестор оценивают технологию "
            "при передаче её стартапу."
        ),
        "tags": ["интеллектуальные активы", "оценка РИД", "методика оценки", "НМА", "ФСО № 11", "ISO 56005"],
        "ontology_id": "onto-1a0e5c0005",
        "references": [
            {"title": "ФСО № 11 (приказ Минэкономразвития от 22.06.2015 № 385)",
             "url": "https://legalacts.ru/doc/prikaz-minekonomrazvitija-rossii-ot-22062015-n-385/"},
            {"title": "ФСБУ 14/2022 «Нематериальные активы»", "url": "https://glavkniga.ru/docs/13129"},
            {"title": "Рекомендация ЕС 2023/499 — Кодекс практики по управлению интеллектуальными активами",
             "url": "https://eur-lex.europa.eu/eli/reco/2023/499"},
            {"title": "ISO 56005:2020", "url": "https://standards.iteh.ai/catalog/standards/cen/367993cb-4cf9-4213-bbf3-8f5a9e3bed8c/en-iso-56005-2021"},
        ],
    },
    {
        "id": "rag-1a0e5c0107",
        "name": "Предпринимательская экосистема вуза: механизмы поддержки и самооценка",
        "domain": "Выбор и оценка механизмов поддержки техпреда под сформированный актив вуза и выход в МТК",
        "description_ru": (
            "Смена цели поддержки техпреда: от вовлечения и охвата к фокусировке на сформированном "
            "активе вуза и выходу в МТК. Каталог механизмов поддержки по контурам экосистемы, "
            "метрики их эффективности, самооценка по рамке HEInnovate (ЕК/ОЭСР) и путь «РИД → "
            "хозобщество → статус МТК». Справочник для «Витрины механизмов поддержки»."
        ),
        "tags": ["экосистема", "механизмы поддержки", "витрина", "МТК", "HEInnovate", "самооценка"],
        "ontology_id": "onto-1a0e5c0004",
        "references": [
            {"title": "HEInnovate — самооценка предпринимательского вуза", "url": "https://heinnovate.eu/"},
            {"title": "HEInnovate Action Cards (PDF)", "url": "https://www.heinnovate.eu/sites/default/files/2025-10/HEInnovate-Action-Cards.pdf"},
            {"title": "Платформа университетского технологического предпринимательства", "url": "https://univertechpred.ru/"},
            {"title": "478-ФЗ «О развитии технологических компаний в РФ»",
             "url": "https://legalacts.ru/doc/federalnyi-zakon-ot-04082023-n-478-fz-o-razvitii-tekhnologicheskikh/"},
        ],
    },
    {
        "id": "rag-1a0e5c0108",
        "name": "Проверка гипотез и CustDev",
        "domain": "Формулировка и проверка гипотез стартапа, интервью с клиентами, эксперименты и пилоты",
        "description_ru": (
            "Формула гипотезы и критерий успеха, типы гипотез и порядок проверки, приоритет "
            "«риск × неопределённость», статистика малых выборок; правила проблемного интервью и "
            "таблица «плохой вопрос → хороший вопрос», сигналы спроса; эксперименты и MVP "
            "(лендинг, LOI, консьерж-MVP, пилот); B2B-продажи и пилоты с индустрией. Основа агентов "
            "«Проверка гипотез» и «CustDev-интервьюер»."
        ),
        "tags": ["гипотезы", "CustDev", "интервью", "MVP", "пилот", "B2B"],
        "ontology_id": "onto-1a0e5c0002",
    },
    {
        "id": "rag-1a0e5c0109",
        "name": "Экономика продукта и финансы стартапа",
        "domain": "Юнит-экономика, финансовая модель, runway и ценообразование технологического стартапа",
        "description_ru": (
            "Показатели юнит-экономики (ARPA, маржа, LTV, CAC, окупаемость) с примером расчёта и "
            "рычагами, помесячная финансовая модель из воронки продаж, burn и runway, сценарии и "
            "типичные ошибки, подходы к ценообразованию и модели оплаты. Основа агента "
            "«Юнит-экономист» и полигона «Runway до pre-seed раунда»."
        ),
        "tags": ["юнит-экономика", "LTV", "CAC", "финмодель", "runway", "цена"],
        "ontology_id": "onto-1a0e5c0001",
    },
    {
        "id": "rag-1a0e5c0110",
        "name": "Инвестиции и питч",
        "domain": "Подготовка стартапа к разговору с инвестором, грантовым фондом и индустриальным партнёром",
        "description_ru": (
            "Структура питч-дека на 10–12 слайдов под разные аудитории и одностраничник, шкала "
            "инвестиционной готовности (IRL), что проверяет инвестор (due diligence) и красные "
            "флаги, комната данных, таблица капитала, вестинг, раунды и размывание долей, доля "
            "вуза, оценка стоимости стартапа на ранней стадии (Беркус, факторы риска, скоринговый "
            "и венчурный методы). Основа агентов «Питч-коуч» и «Оценщик стоимости стартапа»."
        ),
        "tags": ["питч", "инвестиции", "IRL", "cap table", "раунд", "due diligence", "оценка стоимости"],
        "ontology_id": "onto-1a0e5c0002",
    },
    {
        "id": "rag-1a0e5c0111",
        "name": "Запросы индустрии: как компании формулируют задачи для стартапов",
        "domain": "Компания как квалифицированный заказчик студенческих стартапов",
        "description_ru": (
            "Почему компании редко становятся заказчиками студенческих стартапов и что такое "
            "квалифицированный заказчик; открытый вызов вместо технического задания; форматы "
            "сотрудничества; процесс формулирования запроса в компании в пять шагов — роли, "
            "интервью с подразделениями, матрица отбора болей, поля запроса, пилот и решение. "
            "Основа «Кабинета заказчика» и агента «Архитектор запроса компании»."
        ),
        "tags": ["запросы компаний", "открытый вызов", "заказчик", "пилот", "открытые инновации"],
        "ontology_id": "onto-1a0e5c0001",
    },
]


ICON_COLORS = ["#1F5AA6", "#2E9D5B", "#B26A00", "#7A3FB0", "#C0392B", "#117A8B", "#5D6D7E"]


def onto_icon(i: int) -> str:
    c = ICON_COLORS[i % len(ICON_COLORS)]
    return f"""<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g stroke="{c}" stroke-width="2" fill="none" stroke-linecap="round">
    <line x1="32" y1="30" x2="16" y2="18" /><line x1="32" y1="30" x2="48" y2="18" />
    <line x1="32" y1="30" x2="18" y2="46" /><line x1="32" y1="30" x2="46" y2="46" />
    <line x1="16" y1="18" x2="48" y2="18" />
  </g>
  <circle cx="16" cy="18" r="4.5" fill="#F2F6FC" stroke="{c}" stroke-width="2" />
  <circle cx="48" cy="18" r="4.5" fill="#F2F6FC" stroke="{c}" stroke-width="2" />
  <circle cx="18" cy="46" r="4.5" fill="#F2F6FC" stroke="{c}" stroke-width="2" />
  <circle cx="46" cy="46" r="4.5" fill="#F2F6FC" stroke="{c}" stroke-width="2" />
  <circle cx="32" cy="30" r="6.5" fill="{c}" />
</svg>
"""


def rag_icon(i: int) -> str:
    c = ICON_COLORS[i % len(ICON_COLORS)]
    return f"""<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g stroke="{c}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="28" cy="16" rx="14" ry="5" />
    <path d="M14 16v28c0 2.8 6.3 5 14 5s14-2.2 14-5V16" />
    <path d="M14 30c0 2.8 6.3 5 14 5s14-2.2 14-5" />
    <circle cx="44" cy="42" r="7" fill="#F2F6FC" />
    <line x1="49" y1="47" x2="54" y2="52" />
  </g>
</svg>
"""


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    icons = DATA / "icons"
    objects = DATA / "ontologies" / "objects"
    keep: set = set()

    onto_items = []
    for i, graph in enumerate(ONTOLOGIES):
        problems = validate_graph(graph, require_complete=True)
        if problems:
            raise SystemExit(f"{graph['id']}: " + "; ".join(problems))
        graph = dict(graph, status="active")
        write_json(objects / f"{graph['id']}.json", graph)
        (icons / f"{graph['id']}.svg").write_text(onto_icon(i), encoding="utf-8")
        keep.add(graph["id"])
        onto_items.append({
            "id": graph["id"],
            "name": graph["name"],
            "image_url": f"/data/icons/{graph['id']}.svg",
            "domain": graph["domain"],
            "description_ru": graph["description"],
            "author": graph["author"],
            "format": "JSON",
            "classes_count": len(graph["classes"]),
            "relations_count": len(graph["relations"]),
            "projects": [],
            "project_ids": [],
            "status": "Готова",
            "file_url": f"/data/ontologies/objects/{graph['id']}.json",
            "tags": graph["tags"],
            "references": graph.get("references", []),
        })
    write_json(DATA / "ontologies.json", {"items": onto_items})

    rag_items = []
    for i, base in enumerate(RAG_BASES):
        docs = sorted((CORPUS / base["id"]).glob("*.md"))
        if not docs:
            raise SystemExit(f"{base['id']}: нет документов в {CORPUS / base['id']}")
        (icons / f"{base['id']}.svg").write_text(rag_icon(i), encoding="utf-8")
        keep.add(base["id"])
        rag_items.append({
            "id": base["id"],
            "name": base["name"],
            "image_url": f"/data/icons/{base['id']}.svg",
            "project": "",
            "domain": base["domain"],
            "description_ru": base["description_ru"],
            "documents_count": len(docs),
            "documents": [d.name for d in docs],
            "vector_db": "Qdrant",
            "embedding_model": "text-embedding-3-small",
            "status": "Активна",
            "access_url": "",
            "tags": base["tags"],
            "ontology_id": base["ontology_id"],
            "project_id": "",
            "sensitive": False,
            "corpus": f"/data/rag/corpus/{base['id']}/",
            "references": base.get("references", []),
        })
    write_json(DATA / "rag_bases.json", {"items": rag_items})

    # логотипы и графы удалённых онтологий/RAG-баз прежней платформы
    removed = 0
    for path in list(icons.glob("onto-*.svg")) + list(icons.glob("rag-*.svg")):
        # только логотипы артефактов (onto-/rag- + hex); rag-builder.svg и т.п. — навыки
        if ARTIFACT_RE.match(path.stem) and path.stem not in keep:
            path.unlink()
            removed += 1
    if objects.is_dir():
        for path in objects.glob("*.json"):
            if path.name.split(".")[0] not in keep:
                path.unlink()
                removed += 1
    print(f"онтологий: {len(onto_items)}, RAG-баз: {len(rag_items)}, удалено старых файлов: {removed}")


if __name__ == "__main__":
    main()
