/* ============================================================
   «Кабинет заказчика» (company.html) — инструменты компании,
   которая хочет стать квалифицированным заказчиком для
   студенческих стартапов.

   Проблема: в компаниях почти нет человека или процесса, который
   выявляет боли и формулирует запрос для стартапов. Кабинет
   отлаживает этот процесс в 4 инструментах:
     1. Процесс заказчика — 5 шагов, роли, профиль компании,
        шаблон интервью с подразделениями, пример «до / после»;
     2. Карта болей — сбор болей подразделений и матрица
        «ценность для компании × посильность для студенческой
        команды»;
     3. Конструктор запроса — открытый вызов с чек-листом
        квалифицированного заказчика (публикация — только при
        выполненных обязательных пунктах) и ИИ-агентом
        «Архитектор запроса компании»;
     4. Мои запросы и отклики — статусы запросов и разбор
        откликов команд.

   API: /api/company, /api/challenges* (js/api.js).
   ============================================================ */

(function () {
  var AUTH_KEY = 'aios-auth-v1';
  var API = window.AIOS_API;
  var state = {
    tab: 'process',
    company: { profile: {}, pains: [] },
    items: [],
    formats: {},
    statuses: {},
    respStatuses: {},
    draft: {},        /* редактируемый запрос в конструкторе */
    quality: null,
    openResponses: {} /* id запроса → отклики (раскрыт) */
  };

  /* Поля конструктора по шагам: [ключ, подпись, подсказка, строк (0 — input)] */
  var BUILDER = [
    { title: '1. Боль', note: 'Опишите проблему словами компании: что происходит, где и как часто. Не описывайте решение («нужна нейросеть») — описывайте проблему.', fields: [
      ['title', 'Название запроса', 'Коротко, как заголовок: «Жирные стоки: убрать превышения на сбросе»', 0],
      ['department', 'Подразделение', 'Где живёт боль: служба главного инженера, склад, отдел продаж…', 0],
      ['pain', 'Что происходит', 'Факты: что, где, как часто, с какими последствиями', 4],
      ['who_suffers', 'Кто страдает', 'Какие роли и как именно', 2],
      ['current_solution', 'Как решают сейчас и почему этого мало', 'Текущие способы, их стоимость и ограничения', 2]
    ] },
    { title: '2. Цена и результат', note: 'Без цены проблемы команда не поймёт масштаб, без измеримого результата пилот не превратится в решение о закупке.', fields: [
      ['cost_of_problem', 'Цена проблемы', 'Деньги, время, риски в год: «≈ 6 млн ₽ штрафов в год»', 2],
      ['success_criteria', 'Что компания примет как результат', 'С числом или порогом: «не более 1 превышения в месяц за 3 месяца»', 2]
    ] },
    { title: '3. Свобода и ограничения', note: 'Студенческим командам интересно предлагать своё. Зафиксируйте только то, что действительно нельзя менять, остальное оставьте открытым.', fields: [
      ['freedom', 'Где свобода для команды', 'Какие подходы допустимы: «любой способ — биология, сорбенты, цифровой прогноз»', 3],
      ['fixed', 'Что зафиксировано', 'Ограничения: безопасность, температура, сроки монтажа, данные не покидают контур…', 2]
    ] },
    { title: '4. Ресурсы компании', note: 'Чем больше компания даёт, тем сильнее команды откликнутся: данные, площадка, наставник, деньги на пилот.', fields: [
      ['resources', 'Что даёт компания', 'Данные, доступ на площадку, эксперт-наставник, оборудование', 2],
      ['budget', 'Бюджет пилота или вознаграждение', 'Сумма, приз, стажировка, договор', 0],
      ['timeline', 'Сроки', 'Отбор команд, пилот', 0]
    ] },
    { title: '5. Владелец и решение', note: 'У запроса должен быть владелец в компании, а решение о внедрении — у конкретного человека. Иначе пилот «зависнет».', fields: [
      ['owner_name', 'Владелец запроса (ФИО)', '', 0],
      ['owner_role', 'Должность владельца', '', 0],
      ['decision_maker', 'Кто принимает решение о внедрении', 'Должность: технический директор, операционный директор…', 0],
      ['next_step', 'Что будет при успехе пилота', 'Закупка, тиражирование, совместная заявка на грант, инвестиции', 2],
      ['contact', 'Контакт для команд', 'По умолчанию — через отклики на платформе', 0]
    ] }
  ];

  function el(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function session() {
    try {
      var s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      return s && s.token ? s : null;
    } catch (e) { return null; }
  }

  function token() { var s = session(); return s ? s.token : null; }

  function isCompany() {
    var s = session();
    return !!(s && (s.account_type === 'company' || s.role === 'Администратор'));
  }

  function toast(text) {
    var t = el('coToast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2800);
  }

  function errText(err, fallback) { return err && err.message ? err.message : fallback; }

  function launchArchitect(prompt) {
    document.dispatchEvent(new CustomEvent('aios-launch-skill', {
      detail: { skill_id: 'company-request-architect', name: 'Архитектор запроса компании', prompt: prompt }
    }));
  }

  /* ---------- баннер режима ---------- */

  function renderBanner() {
    var b = el('coBanner');
    var s = session();
    if (s && !isCompany()) {
      b.hidden = false;
      b.innerHTML = 'Вы вошли как <b>команда стартапа</b>. Кабинет — для компаний-заказчиков: процесс ниже полезно знать и командам (так вы поймёте, как говорить с индустриальным партнёром). ' +
        '<button type="button" class="btn-primary" data-switch="company">Перейти в режим компании</button> <a class="btn-register" href="challenges.html">Смотреть запросы компаний</a>';
    } else {
      b.hidden = true;
    }
  }

  function lockedHtml() {
    return '<p class="jr-muted">Инструмент доступен в режиме компании-заказчика. <button type="button" class="btn-primary" data-switch="company">Перейти в режим компании</button></p>';
  }

  /* ---------- 1. Процесс заказчика ---------- */

  var STEPS = [
    ['Назначить владельца процесса', 'Нужен «чемпион» — человек, который 2–4 часа в неделю отвечает за работу со стартапами: менеджер по инновациям, технологическому развитию или руководитель подразделения. Без него запросы не появляются.', 'Профиль компании ниже', 'process'],
    ['Собрать боли подразделений', 'Чемпион проводит 30-минутные интервью с руководителями 5–7 подразделений по шаблону вопросов. Записываем факты и цену проблем, а не идеи решений.', 'Карта болей', 'pains'],
    ['Отобрать боли для стартапов', 'Матрица «ценность для компании × посильность для студенческой команды». Подходят боли, где есть данные или площадка, нет гостайны, а первый результат возможен за 3–6 месяцев.', 'Матрица на карте болей', 'pains'],
    ['Сформулировать открытый вызов', 'Фиксируем проблему, цену и измеримый результат, ресурсы компании и владельца. Способ решения оставляем команде. Публикация открывается, когда запрос проходит чек-лист квалифицированного заказчика.', 'Конструктор запроса', 'builder'],
    ['Отобрать команды и провести пилот', 'Разбираем отклики, встречаемся с 2–3 командами, договариваемся о пилоте с критериями успеха. По итогам — закупка, совместный проект или отказ с честной обратной связью.', 'Мои запросы и отклики', 'requests']
  ];

  var ROLES = [
    ['Чемпион', 'владеет процессом в компании: собирает боли, ведёт запросы, связывает с вузом'],
    ['Владелец запроса', 'руководитель подразделения, у которого болит; отвечает за критерии результата'],
    ['Эксперт-наставник', 'инженер или технолог, который отвечает командам на вопросы 2–4 часа в неделю'],
    ['Лицо, принимающее решение', 'спонсор: решает о пилоте и закупке, его нужно вовлечь до старта пилота']
  ];

  var INTERVIEW = [
    'Какие задачи вашего подразделения за последний год отняли больше всего времени или денег?',
    'Расскажите о последнем случае, когда эта проблема проявилась. Что произошло, чем закончилось?',
    'Как часто это происходит и кто страдает больше всего?',
    'Сколько это стоит компании в год: деньги, часы людей, штрафы, потерянные клиенты?',
    'Что вы уже пробовали? Почему это не сработало или работает не до конца?',
    'Какие данные об этой проблеме у вас есть: журналы, датчики, отчёты, фото?',
    'По какому числу вы поймёте, что проблема решена?',
    'Кто примет решение, если появится работающее решение? Есть ли бюджет?'
  ];

  function renderProcess() {
    var p = state.company.profile || {};
    var locked = !isCompany();
    el('coProcess').innerHTML =
      '<p class="section-lead">Компании редко умеют быть заказчиком для студенческих стартапов: нет человека, который выявляет боли, а запросы звучат как «нужно внедрить ИИ». Пять шагов ниже — это процесс, который превращает внутренние боли в запросы, на которые откликаются команды, а результат пилота — в решение о закупке.</p>' +
      '<ol class="co-steps">' + STEPS.map(function (s, i) {
        return '<li class="co-step"><span class="co-step-n">' + (i + 1) + '</span><div><b>' + esc(s[0]) + '</b><p>' + esc(s[1]) + '</p>' +
          '<button type="button" class="jr-tool" data-goto="' + s[3] + '">' + esc(s[2]) + ' →</button></div></li>';
      }).join('') + '</ol>' +
      '<div class="co-two">' +
        '<div class="co-box"><h3>Роли в компании</h3><ul class="jr-list">' + ROLES.map(function (r) { return '<li><b>' + esc(r[0]) + '</b> — ' + esc(r[1]) + '</li>'; }).join('') + '</ul></div>' +
        '<div class="co-box"><h3>Запрос: до и после</h3>' +
          '<p class="co-bad"><b>Было:</b> «Нужно внедрить искусственный интеллект на производстве».</p>' +
          '<p class="co-good"><b>Стало:</b> «Компрессорная станция тратит 22 % электроэнергии завода (≈ 9 млн ₽ в год перерасхода). Примем результат: −15 % потребления за 4 месяца без падения давления ниже 6 бар. Способ — любой: цифровой двойник, поиск утечек, рекуперация тепла. Даём данные за 2 года, доступ на станцию и эксперта-энергетика. Решение о внедрении — директор по производству».</p></div>' +
      '</div>' +
      '<div class="co-box"><h3>Профиль компании</h3>' +
        (locked ? lockedHtml() :
        '<form class="co-form co-form--grid" id="coProfile">' +
          [['name', 'Название компании'], ['industry', 'Отрасль'], ['city', 'Город'], ['size', 'Размер (сотрудников)'], ['champion', 'Чемпион: кто ведёт работу со стартапами']].map(function (f) {
            return '<label><span>' + esc(f[1]) + '</span><input name="' + f[0] + '" maxlength="160" value="' + esc(p[f[0]] || '') + '"></label>';
          }).join('') +
          '<label class="co-span2"><span>О компании и технологических приоритетах</span><textarea name="about" rows="2" maxlength="1000">' + esc(p.about || '') + '</textarea></label>' +
          '<div class="co-span2"><button type="submit" class="btn-primary">Сохранить профиль</button></div>' +
        '</form>') +
      '</div>';

    var form = el('coProfile');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var prof = {};
        ['name', 'industry', 'city', 'size', 'champion', 'about'].forEach(function (k) { prof[k] = form.elements[k].value; });
        API.companySave(token(), { profile: prof }).then(function (data) {
          state.company = data;
          toast('Профиль сохранён');
        }).catch(function (err) { alert(errText(err, 'Не удалось сохранить профиль')); });
      });
    }
  }

  /* ---------- 2. Карта болей ---------- */

  function savePains(message) {
    return API.companySave(token(), { pains: state.company.pains }).then(function (data) {
      state.company = data;
      renderPains();
      if (message) toast(message);
    }).catch(function (err) { alert(errText(err, 'Не удалось сохранить карту болей')); });
  }

  function quadrant(p) {
    var v = Number(p.value) || 3, f = Number(p.feasibility) || 3;
    if (v >= 3 && f >= 3) return ['ok', 'В запрос для стартапов'];
    if (v >= 3) return ['warn', 'Стратегическая НИОКР с партнёром'];
    if (f >= 3) return ['done', 'Учебный кейс / хакатон'];
    return ['bad', 'Отложить'];
  }

  function matrixSvg(pains) {
    var W = 420, H = 300, pad = 40;
    function x(f) { return pad + (f - 1) / 4 * (W - pad * 2); }
    function y(v) { return H - pad - (v - 1) / 4 * (H - pad * 2); }
    var dots = pains.map(function (p, i) {
      var jitter = (i % 3 - 1) * 7;
      return '<g class="co-dot"><circle cx="' + (x(p.feasibility) + jitter) + '" cy="' + (y(p.value) - jitter) + '" r="12"/>' +
        '<text x="' + (x(p.feasibility) + jitter) + '" y="' + (y(p.value) - jitter + 4) + '">' + (i + 1) + '</text><title>' + esc(p.pain) + '</title></g>';
    }).join('');
    var mx = x(3), my = y(3);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="co-matrix" role="img" aria-label="Матрица болей: ценность для компании и посильность для студенческой команды">' +
      '<rect class="co-q co-q--ok" x="' + mx + '" y="' + pad + '" width="' + (W - pad - mx) + '" height="' + (my - pad) + '"/>' +
      '<rect class="co-q co-q--warn" x="' + pad + '" y="' + pad + '" width="' + (mx - pad) + '" height="' + (my - pad) + '"/>' +
      '<rect class="co-q co-q--done" x="' + mx + '" y="' + my + '" width="' + (W - pad - mx) + '" height="' + (H - pad - my) + '"/>' +
      '<rect class="co-q co-q--bad" x="' + pad + '" y="' + my + '" width="' + (mx - pad) + '" height="' + (H - pad - my) + '"/>' +
      '<text class="co-q-label" x="' + (W - pad - 6) + '" y="' + (pad + 16) + '" text-anchor="end">В запрос для стартапов</text>' +
      '<text class="co-q-label" x="' + (pad + 6) + '" y="' + (pad + 16) + '">НИОКР с партнёром</text>' +
      '<text class="co-q-label" x="' + (W - pad - 6) + '" y="' + (H - pad - 8) + '" text-anchor="end">Учебный кейс</text>' +
      '<text class="co-q-label" x="' + (pad + 6) + '" y="' + (H - pad - 8) + '">Отложить</text>' +
      '<text class="co-axis" x="' + (W / 2) + '" y="' + (H - 10) + '" text-anchor="middle">Посильность для студенческой команды →</text>' +
      '<text class="co-axis" x="14" y="' + (H / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">Ценность для компании →</text>' +
      dots + '</svg>';
  }

  function scoreSelect(name, value, idx) {
    var opts = '';
    for (var i = 1; i <= 5; i++) opts += '<option value="' + i + '"' + (Number(value) === i ? ' selected' : '') + '>' + i + '</option>';
    return '<select data-pain-score="' + name + '" data-idx="' + idx + '" aria-label="' + (name === 'value' ? 'Ценность' : 'Посильность') + '">' + opts + '</select>';
  }

  function renderPains() {
    var box = el('coPains');
    if (!isCompany()) { box.innerHTML = lockedHtml(); return; }
    var pains = state.company.pains || [];
    box.innerHTML =
      '<p class="section-lead">Соберите боли подразделений и оцените каждую по двум шкалам 1–5: <b>ценность</b> для компании (сколько стоит проблема) и <b>посильность</b> для студенческой команды (есть данные или площадка, нет секретности, первый результат за 3–6 месяцев). Правый верхний квадрант — кандидаты в запрос.</p>' +
      '<div class="co-two">' +
        '<div class="co-box"><h3>Новая боль</h3>' +
          '<form class="co-form" id="coPainForm">' +
            '<label><span>Подразделение</span><input name="department" maxlength="120" placeholder="Служба главного энергетика"></label>' +
            '<label><span>Боль — факты</span><textarea name="pain" rows="3" maxlength="600" required placeholder="Что происходит, где, как часто"></textarea></label>' +
            '<label><span>Кто страдает</span><input name="who" maxlength="300"></label>' +
            '<div class="ch-form-row"><label><span>Как часто</span><input name="frequency" maxlength="120" placeholder="2–3 раза в месяц"></label>' +
            '<label><span>Цена в год</span><input name="cost" maxlength="300" placeholder="≈ 6 млн ₽"></label></div>' +
            '<div class="ch-form-row"><label><span>Ценность 1–5</span>' + scoreSelect('value', 3, -1).replace('data-pain-score', 'name="value" data-x') + '</label>' +
            '<label><span>Посильность 1–5</span>' + scoreSelect('feasibility', 3, -1).replace('data-pain-score', 'name="feasibility" data-x') + '</label></div>' +
            '<label class="co-check"><input type="checkbox" name="data_available"> Есть данные или площадка для эксперимента</label>' +
            '<button type="submit" class="btn-primary">Добавить на карту</button>' +
          '</form>' +
          '<details class="co-details"><summary>Шаблон интервью с руководителем подразделения</summary><ol>' +
            INTERVIEW.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol>' +
            '<button type="button" class="btn-register" data-ai="interview">Провести интервью с ИИ-агентом</button></details>' +
        '</div>' +
        '<div class="co-box"><h3>Матрица болей</h3>' + matrixSvg(pains) + '</div>' +
      '</div>' +
      '<div class="co-box"><h3>Карта болей (' + pains.length + ')</h3>' +
        (pains.length ? '<div class="table-wrap"><table class="dtable"><thead><tr><th>#</th><th>Боль</th><th>Цена</th><th>Ценность</th><th>Посильность</th><th>Решение</th><th></th></tr></thead><tbody>' +
          pains.map(function (p, i) {
            var q = quadrant(p);
            return '<tr><td>' + (i + 1) + '</td><td><div class="cell-title">' + esc(p.pain) + '</div><div class="cell-sub">' + esc([p.department, p.who, p.frequency].filter(Boolean).join(' · ')) + (p.data_available ? ' · есть данные' : '') + '</div></td>' +
              '<td>' + esc(p.cost || '—') + '</td><td>' + scoreSelect('value', p.value, i) + '</td><td>' + scoreSelect('feasibility', p.feasibility, i) + '</td>' +
              '<td><span class="pill pill--' + q[0] + '">' + esc(q[1]) + '</span></td>' +
              '<td class="co-actions">' + (p.challenge_id ? '<span class="cell-sub">запрос создан</span>' : '<button type="button" class="jr-tool" data-pain-to-request="' + i + '">→ В запрос</button>') +
              '<button type="button" class="jr-tool jr-tool--danger" data-pain-del="' + i + '" aria-label="Удалить">✕</button></td></tr>';
          }).join('') + '</tbody></table></div>'
          : '<p class="jr-muted">Пока пусто. Начните с интервью с 5–7 руководителями подразделений.</p>') +
      '</div>';

    var form = el('coPainForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      state.company.pains = (state.company.pains || []).concat([{
        department: f.department.value, pain: f.pain.value, who: f.who.value, frequency: f.frequency.value,
        cost: f.cost.value, value: Number(f.value.value), feasibility: Number(f.feasibility.value),
        data_available: f.data_available.checked
      }]);
      savePains('Боль добавлена на карту');
    });
  }

  /* ---------- 3. Конструктор запроса ---------- */

  var qualityTimer = null;

  function collectDraft() {
    var form = el('coBuilderForm');
    if (!form) return state.draft;
    BUILDER.forEach(function (step) {
      step.fields.forEach(function (f) { state.draft[f[0]] = form.elements[f[0]].value; });
    });
    state.draft.format = form.elements.format.value;
    state.draft.company = form.elements.company.value;
    state.draft.industry = form.elements.industry.value;
    return state.draft;
  }

  function refreshQuality() {
    clearTimeout(qualityTimer);
    qualityTimer = setTimeout(function () {
      var data = collectDraft();
      API.challengeQuality(token(), data).then(function (q) {
        state.quality = q;
        renderQuality();
      }).catch(function () { /* сервер недоступен — индикатор не обновится */ });
    }, 350);
  }

  function renderQuality() {
    var box = el('coQuality');
    if (!box) return;
    var q = state.quality || { score: 0, items: [], qualified: false, missing_required: [] };
    box.innerHTML =
      '<div class="co-meter"><div class="co-meter-val">' + q.score + ' %</div><div class="co-meter-label">готовность запроса</div></div>' +
      '<div class="jr-bar"><span style="width:' + q.score + '%"></span></div>' +
      '<p class="' + (q.qualified ? 'jr-ok' : 'jr-muted') + '">' + (q.qualified ? 'Запрос квалифицирован — можно публиковать.' : 'Чтобы опубликовать, выполните обязательные пункты (отмечены *).') + '</p>' +
      '<ul class="co-quality">' + (q.items || []).map(function (it) {
        return '<li class="' + (it.ok ? 'is-ok' : '') + '"><span>' + (it.ok ? '✓' : '○') + '</span>' + esc(it.label) + (it.required ? ' *' : '') + '</li>';
      }).join('') + '</ul>';
    var pub = el('coPublish');
    if (pub) pub.disabled = !q.qualified;
  }

  function renderBuilder() {
    var box = el('coBuilder');
    if (!isCompany()) { box.innerHTML = lockedHtml(); return; }
    var d = state.draft;
    var prof = state.company.profile || {};
    var own = state.items.filter(function (c) { return c.is_owner; });
    var formats = Object.keys(state.formats).map(function (k) {
      return '<option value="' + esc(k) + '"' + ((d.format || 'challenge') === k ? ' selected' : '') + '>' + esc(state.formats[k]) + '</option>';
    }).join('');

    box.innerHTML =
      '<div class="co-builder-head">' +
        '<p class="section-lead">Открытый вызов фиксирует <b>проблему и результат</b>, а не решение. Справа — чек-лист квалифицированного заказчика: публикация откроется, когда обязательные пункты выполнены.</p>' +
        '<div class="co-builder-pick"><label><span>Запрос</span><select id="coPick"><option value="">+ Новый запрос</option>' +
          own.map(function (c) { return '<option value="' + esc(c.id) + '"' + (d.id === c.id ? ' selected' : '') + '>' + esc(c.title) + ' (' + esc(c.status_title) + ')</option>'; }).join('') +
        '</select></label></div>' +
      '</div>' +
      '<div class="co-builder">' +
        '<form class="co-form" id="coBuilderForm">' +
          '<div class="co-box"><h3>0. Компания и формат</h3><div class="ch-form-row">' +
            '<label><span>Компания</span><input name="company" maxlength="160" value="' + esc(d.company || prof.name || '') + '"></label>' +
            '<label><span>Отрасль</span><input name="industry" maxlength="80" value="' + esc(d.industry || prof.industry || '') + '"></label></div>' +
            '<label><span>Формат сотрудничества</span><select name="format">' + formats + '</select></label></div>' +
          BUILDER.map(function (step) {
            return '<div class="co-box"><h3>' + esc(step.title) + '</h3><p class="cell-sub">' + esc(step.note) + '</p>' +
              step.fields.map(function (f) {
                var v = d[f[0]] || '';
                var input = f[3]
                  ? '<textarea name="' + f[0] + '" rows="' + f[3] + '" placeholder="' + esc(f[2]) + '">' + esc(v) + '</textarea>'
                  : '<input name="' + f[0] + '" value="' + esc(v) + '" placeholder="' + esc(f[2]) + '">';
                return '<label><span>' + esc(f[1]) + '</span>' + input + '</label>';
              }).join('') + '</div>';
          }).join('') +
        '</form>' +
        '<aside class="co-side">' +
          '<div class="co-box co-sticky"><div id="coQuality"></div>' +
            '<div class="co-side-actions">' +
              '<button type="button" class="btn-register" id="coSave">Сохранить черновик</button>' +
              '<button type="button" class="btn-primary" id="coPublish" disabled>Опубликовать для команд</button>' +
              '<button type="button" class="btn-register" data-ai="builder">Доработать с ИИ-агентом</button>' +
            '</div>' +
            '<p class="cell-sub">ИИ-агент «Архитектор запроса компании» задаст вопросы владельцу запроса и предложит формулировки для каждого поля.</p>' +
          '</div>' +
        '</aside>' +
      '</div>';

    el('coBuilderForm').addEventListener('input', refreshQuality);
    el('coBuilderForm').addEventListener('change', refreshQuality);
    el('coPick').addEventListener('change', function () {
      var id = this.value;
      state.draft = id ? JSON.parse(JSON.stringify(state.items.filter(function (c) { return c.id === id; })[0] || {})) : {};
      renderBuilder();
    });
    el('coSave').addEventListener('click', function () { saveDraft(null); });
    el('coPublish').addEventListener('click', function () { saveDraft('published'); });
    renderQuality();
    refreshQuality();
  }

  var FIELDS_TO_SEND = ['title', 'company', 'industry', 'department', 'format', 'pain', 'who_suffers', 'current_solution',
    'cost_of_problem', 'success_criteria', 'fixed', 'freedom', 'resources', 'budget', 'timeline', 'owner_name',
    'owner_role', 'decision_maker', 'next_step', 'contact', 'pain_id'];

  function saveDraft(status) {
    var d = collectDraft();
    var body = {};
    FIELDS_TO_SEND.forEach(function (k) { if (d[k] != null) body[k] = d[k]; });
    var p = d.id ? Promise.resolve({ id: d.id }) : API.challengeCreate(token(), { title: body.title || 'Новый запрос' });
    p.then(function (created) {
      if (status) body.status = status;
      return API.challengeUpdate(token(), created.id, body);
    }).then(function (card) {
      state.draft = JSON.parse(JSON.stringify(card));
      /* боль с карты → отмечаем, что по ней создан запрос */
      if (card.pain_id) {
        (state.company.pains || []).forEach(function (pn) { if (pn.id === card.pain_id) pn.challenge_id = card.id; });
        API.companySave(token(), { pains: state.company.pains }).catch(function () {});
      }
      toast(status === 'published' ? 'Запрос опубликован — команды его видят' : 'Черновик сохранён');
      return loadItems().then(renderBuilder);
    }).catch(function (err) { alert(errText(err, 'Не удалось сохранить запрос')); });
  }

  /* ---------- 4. Мои запросы и отклики ---------- */

  function renderRequests() {
    var box = el('coRequests');
    if (!isCompany()) { box.innerHTML = lockedHtml(); return; }
    var own = state.items.filter(function (c) { return c.is_owner; });
    var pill = { draft: 'bad', published: 'ok', in_pilot: 'warn', closed: 'done' };
    box.innerHTML = own.length ? own.map(function (c) {
      var resp = state.openResponses[c.id];
      return '<article class="co-box co-req">' +
        '<div class="co-req-head"><div><span class="pill pill--' + (pill[c.status] || 'done') + '">' + esc(c.status_title) + '</span> ' +
          '<span class="cell-sub">' + esc(c.format_title) + ' · готовность ' + esc(c.quality.score) + ' %</span>' +
          '<h3>' + esc(c.title) + '</h3></div>' +
          '<div class="co-actions">' +
            '<button type="button" class="jr-tool" data-edit="' + esc(c.id) + '">Редактировать</button>' +
            (c.status === 'draft' ? '' : '<a class="jr-tool" href="challenges.html#' + esc(c.id) + '">Как видят команды →</a>') +
            '<select data-status="' + esc(c.id) + '" aria-label="Статус запроса">' + Object.keys(state.statuses).map(function (k) {
              return '<option value="' + k + '"' + (c.status === k ? ' selected' : '') + '>' + esc(state.statuses[k]) + '</option>';
            }).join('') + '</select>' +
            '<button type="button" class="jr-tool jr-tool--danger" data-del="' + esc(c.id) + '">Удалить</button>' +
          '</div></div>' +
        '<button type="button" class="dash-btn" data-responses="' + esc(c.id) + '">' + (resp ? 'Скрыть отклики' : 'Отклики команд: ' + c.responses_count) + '</button>' +
        (resp ? renderResponses(c, resp) : '') +
      '</article>';
    }).join('') : '<p class="jr-muted">У вас пока нет запросов. Начните с карты болей или сразу откройте конструктор запроса.</p>' +
      '<button type="button" class="btn-primary" data-goto="builder">Открыть конструктор запроса</button>';
  }

  function renderResponses(c, items) {
    if (!items.length) return '<p class="jr-muted">Откликов пока нет. Поделитесь ссылкой на запрос с вузом-партнёром или стартап-студией.</p>';
    return '<div class="table-wrap"><table class="dtable"><thead><tr><th>Команда</th><th>Подход</th><th>Что нужно от вас</th><th>Статус и комментарий</th></tr></thead><tbody>' +
      items.map(function (r) {
        return '<tr><td><div class="cell-title">' + esc(r.team) + '</div><div class="cell-sub">' + esc([r.stage, r.contact || r.user_name].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td>' + esc(r.approach) + '</td><td>' + esc(r.needs || '—') + '</td>' +
          '<td><select data-resp-status="' + esc(c.id) + '|' + esc(r.id) + '">' + Object.keys(state.respStatuses).map(function (k) {
            return '<option value="' + k + '"' + (r.status === k ? ' selected' : '') + '>' + esc(state.respStatuses[k]) + '</option>';
          }).join('') + '</select>' +
          '<textarea rows="2" data-resp-comment="' + esc(c.id) + '|' + esc(r.id) + '" placeholder="Комментарий для команды">' + esc(r.comment || '') + '</textarea></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- вкладки и события ---------- */

  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.co-tab').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-tab') === tab); });
    var panes = { process: 'coProcess', pains: 'coPains', builder: 'coBuilder', requests: 'coRequests' };
    Object.keys(panes).forEach(function (k) { el(panes[k]).hidden = k !== tab; });
    if (tab === 'process') renderProcess();
    if (tab === 'pains') renderPains();
    if (tab === 'builder') renderBuilder();
    if (tab === 'requests') renderRequests();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('co-tab')) { showTab(b.getAttribute('data-tab')); return; }
    if (b.hasAttribute('data-goto')) { showTab(b.getAttribute('data-goto')); window.scrollTo(0, 0); return; }
    if (b.hasAttribute('data-switch')) {
      if (!window.AIOS_SET_ACCOUNT_TYPE) return;
      window.AIOS_SET_ACCOUNT_TYPE('company').then(function () { renderBanner(); load(); })
        .catch(function (err) { alert(errText(err, 'Не удалось сменить режим')); });
      return;
    }
    if (b.hasAttribute('data-ai')) {
      var kind = b.getAttribute('data-ai');
      var prof = state.company.profile || {};
      if (kind === 'interview') {
        launchArchitect('Запусти навык «Архитектор запроса компании» в режиме интервью: я — представитель компании «' + (prof.name || 'не указана') +
          '». Проведи со мной интервью руководителя подразделения по шаблону, чтобы выявить 3–5 болей с ценой проблемы, и в конце дай таблицу болей с оценкой ценности и посильности для студенческой команды.');
      } else {
        var d = collectDraft();
        var filled = FIELDS_TO_SEND.filter(function (k) { return d[k]; }).map(function (k) { return k + ': ' + d[k]; }).join('; ');
        launchArchitect('Запусти навык «Архитектор запроса компании»: помоги доработать запрос для студенческих стартапов до квалифицированного. Текущий черновик — ' +
          (filled || 'пока пустой') + '. Задай недостающие вопросы и предложи формулировки для каждого поля конструктора.');
      }
      return;
    }
    if (b.hasAttribute('data-pain-del')) {
      var i = Number(b.getAttribute('data-pain-del'));
      if (!confirm('Удалить боль с карты?')) return;
      state.company.pains.splice(i, 1);
      savePains('Боль удалена');
      return;
    }
    if (b.hasAttribute('data-pain-to-request')) {
      var pn = state.company.pains[Number(b.getAttribute('data-pain-to-request'))];
      var prof2 = state.company.profile || {};
      state.draft = {
        title: String(pn.pain || '').slice(0, 120), department: pn.department, pain: pn.pain,
        who_suffers: pn.who, cost_of_problem: pn.cost, company: prof2.name, industry: prof2.industry, pain_id: pn.id,
        owner_name: '', format: 'challenge'
      };
      showTab('builder');
      window.scrollTo(0, 0);
      toast('Боль перенесена в конструктор — дополните результат, свободу и ресурсы');
      return;
    }
    if (b.hasAttribute('data-edit')) {
      var id = b.getAttribute('data-edit');
      state.draft = JSON.parse(JSON.stringify(state.items.filter(function (c) { return c.id === id; })[0] || {}));
      showTab('builder');
      window.scrollTo(0, 0);
      return;
    }
    if (b.hasAttribute('data-del')) {
      var did = b.getAttribute('data-del');
      if (!confirm('Удалить запрос вместе с откликами?')) return;
      API.challengeDelete(token(), did).then(function () {
        if (state.draft.id === did) state.draft = {};
        return loadItems();
      }).then(renderRequests).catch(function (err) { alert(errText(err, 'Не удалось удалить')); });
      return;
    }
    if (b.hasAttribute('data-responses')) {
      var rid = b.getAttribute('data-responses');
      if (state.openResponses[rid]) { delete state.openResponses[rid]; renderRequests(); return; }
      API.challengeResponses(token(), rid).then(function (data) {
        state.openResponses[rid] = data.items || [];
        renderRequests();
      }).catch(function (err) { alert(errText(err, 'Не удалось загрузить отклики')); });
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-pain-score')) {
      var i = Number(t.getAttribute('data-idx'));
      if (i < 0) return;
      state.company.pains[i][t.getAttribute('data-pain-score')] = Number(t.value);
      savePains();
    } else if (t.hasAttribute && t.hasAttribute('data-status')) {
      var cid = t.getAttribute('data-status');
      API.challengeUpdate(token(), cid, { status: t.value }).then(function () {
        toast('Статус запроса обновлён');
        return loadItems();
      }).then(renderRequests).catch(function (err) {
        alert(errText(err, 'Не удалось сменить статус'));
        renderRequests();
      });
    } else if (t.hasAttribute && (t.hasAttribute('data-resp-status') || t.hasAttribute('data-resp-comment'))) {
      var key = (t.getAttribute('data-resp-status') || t.getAttribute('data-resp-comment')).split('|');
      var body = t.hasAttribute('data-resp-status') ? { status: t.value } : { comment: t.value };
      API.challengeResponseUpdate(token(), key[0], key[1], body).then(function (r) {
        var list = state.openResponses[key[0]] || [];
        list.forEach(function (x, idx) { if (x.id === r.id) list[idx] = r; });
        toast('Отклик обновлён — команда увидит статус');
      }).catch(function (err) { alert(errText(err, 'Не удалось обновить отклик')); });
    }
  });

  /* ---------- загрузка ---------- */

  function loadItems() {
    return API.challengesList(token()).then(function (data) {
      state.items = data.items || [];
      state.formats = data.formats || {};
      state.statuses = data.statuses || {};
      state.respStatuses = data.response_statuses || {};
    });
  }

  function load() {
    if (!API || !token()) {
      el('coProcess').innerHTML = '<p class="jr-muted">Войдите, чтобы открыть кабинет.</p>';
      return;
    }
    Promise.all([
      API.companyGet(token()).then(function (d) { state.company = d; }),
      loadItems()
    ]).then(function () { showTab(state.tab); })
      .catch(function (err) { el('coProcess').innerHTML = '<p class="jr-muted">' + esc(errText(err, 'Не удалось загрузить кабинет')) + '</p>'; });
  }

  window.addEventListener('aios-auth-change', function () { renderBanner(); });
  renderBanner();
  load();
})();
