/* ============================================================
   «Запросы компаний» (challenges.html) — витрина открытых
   вызовов компаний для студенческих стартапов.

   Запрос — не техническое задание: компания фиксирует боль, её
   цену и измеримый результат, а способ решения оставляет команде
   (поле «Где свобода для команды»). Команда читает запрос,
   при желании генерирует гипотезы решения с ИИ-агентом и
   откликается своей идеей подхода. Статус отклика ставит
   компания в «Кабинете заказчика» (company.html).

   API: /api/challenges, /api/challenges/{id}/responses,
   /api/challenge-responses/mine (js/api.js).
   ============================================================ */

(function () {
  var AUTH_KEY = 'aios-auth-v1';
  var API = window.AIOS_API;
  var state = { items: [], formats: {}, format: 'all', q: '', tab: 'all' };

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

  /* компания-заказчик смотрит запросы, но не откликается и не пользуется
     инструментами команды стартапа (генерация гипотез, «Мои отклики») */
  function isCompany() { var s = session(); return !!(s && s.account_type === 'company'); }

  function short(text, n) {
    text = String(text || '');
    return text.length > n ? text.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : text;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts * 1000);
    return isNaN(d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* уровень команды на «Пути стартапа» (js/journey.js) — подсказка в отклик */
  function journeyStage() {
    var s = session();
    try {
      var p = JSON.parse(localStorage.getItem('aios-journey-v1:' + (s && s.login ? s.login : 'guest')) || 'null');
      return p && p.level ? 'Уровень ' + p.level + ' из 10 на «Пути стартапа»' : '';
    } catch (e) { return ''; }
  }

  function dashStartup() {
    try {
      var d = JSON.parse(localStorage.getItem('aios-startup-dashboard-v1') || 'null');
      return d && d.startup ? String(d.startup) : '';
    } catch (e) { return ''; }
  }

  /* ---------- баннер режима ---------- */

  function renderBanner() {
    var s = session();
    var b = el('chBanner');
    if (!b) return;
    if (s && s.account_type === 'company') {
      b.hidden = false;
      b.innerHTML = 'Вы вошли как <b>компания-заказчик</b>: здесь можно посмотреть, как выглядят опубликованные запросы. Свой запрос создаётся в <a href="company.html">Кабинете заказчика</a> — там же отклики команд.';
      var mineTab = document.querySelector('.ch-tabs');
      if (mineTab) mineTab.hidden = true;
    } else {
      b.hidden = false;
      b.innerHTML = 'Не нашли подходящего вызова? Запросы появляются, когда компании проходят процесс формулирования в <a href="company.html">Кабинете заказчика</a>. ' +
        'Пригласите туда индустриального партнёра своей команды.';
    }
  }

  /* ---------- список ---------- */

  function renderFormats() {
    var box = el('chFormats');
    var keys = Object.keys(state.formats);
    box.innerHTML = '<button type="button" class="chip' + (state.format === 'all' ? ' is-on' : '') + '" data-format="all">Все форматы</button>' +
      keys.map(function (k) {
        return '<button type="button" class="chip' + (state.format === k ? ' is-on' : '') + '" data-format="' + esc(k) + '">' + esc(state.formats[k]) + '</button>';
      }).join('');
  }

  function matches(c) {
    if (c.status === 'draft' && !c.is_owner) return false;
    if (state.format !== 'all' && c.format !== state.format) return false;
    if (!state.q) return true;
    var blob = [c.title, c.company, c.industry, c.pain, c.freedom, (c.tags || []).join(' ')].join(' ').toLowerCase();
    return blob.indexOf(state.q) >= 0;
  }

  function renderGrid() {
    var list = state.items.filter(matches);
    el('chGrid').innerHTML = list.length ? list.map(function (c) {
      var q = c.quality || {};
      return '<article class="ch-card" data-id="' + esc(c.id) + '">' +
        '<div class="ch-card-top"><span class="pill pill--done">' + esc(c.format_title || '') + '</span>' +
          (c.demo ? '<span class="pill pill--warn">демо</span>' : '') +
          (c.status === 'draft' ? '<span class="pill pill--bad">черновик</span>' : '') +
          (c.status === 'in_pilot' ? '<span class="pill pill--ok">идёт пилот</span>' : '') +
          '<span class="ch-score" title="Готовность запроса по чек-листу квалифицированного заказчика">' + (q.qualified ? '✓ ' : '') + esc(q.score || 0) + ' %</span></div>' +
        '<div class="ch-company">' + esc(c.company || 'Компания') + (c.industry ? ' · ' + esc(c.industry) : '') + '</div>' +
        '<h3 class="ch-title">' + esc(c.title) + '</h3>' +
        '<p class="ch-pain">' + esc(short(c.pain, 220)) + '</p>' +
        (c.freedom ? '<div class="ch-freedom"><b>Свобода для команды:</b> ' + esc(short(c.freedom, 170)) + '</div>' : '') +
        '<div class="ch-meta">' +
          (c.cost_of_problem ? '<span><b>Цена проблемы:</b> ' + esc(short(c.cost_of_problem, 90)) + '</span>' : '') +
          (c.budget ? '<span><b>Компания даёт:</b> ' + esc(short(c.budget, 90)) + '</span>' : '') +
        '</div>' +
        '<div class="ch-card-foot"><span class="cell-sub">' + (c.responses_count || 0) + ' откликов' + (c.my_response ? ' · вы откликнулись' : '') + '</span>' +
          '<button type="button" class="btn-primary ch-open" data-open="' + esc(c.id) + '">Подробнее и откликнуться</button></div>' +
      '</article>';
    }).join('') : '<p class="jr-muted">Нет запросов по этому фильтру.</p>';
  }

  /* ---------- карточка запроса ---------- */

  function row(label, value) {
    return value ? '<div class="ch-row"><div class="ch-row-label">' + esc(label) + '</div><div>' + esc(value) + '</div></div>' : '';
  }

  function openCard(id) {
    var c = state.items.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var dlg = el('chDialog');
    var company = isCompany();
    var canRespond = !company && !c.is_owner && (c.status === 'published' || c.status === 'in_pilot');
    el('chDialogBody').innerHTML =
      '<button type="button" class="modal-close" data-close="1" aria-label="Закрыть">✕</button>' +
      '<div class="ch-card-top"><span class="pill pill--done">' + esc(c.format_title || '') + '</span>' + (c.demo ? '<span class="pill pill--warn">демо-запрос</span>' : '') + '</div>' +
      '<div class="ch-company">' + esc(c.company) + (c.department ? ' · ' + esc(c.department) : '') + '</div>' +
      '<h2>' + esc(c.title) + '</h2>' +
      '<div class="ch-rows">' +
        row('Что происходит', c.pain) +
        row('Кто страдает', c.who_suffers) +
        row('Как решают сейчас', c.current_solution) +
        row('Цена проблемы', c.cost_of_problem) +
        row('Что примем как результат', c.success_criteria) +
        '<div class="ch-row ch-row--free"><div class="ch-row-label">Где свобода для команды</div><div>' + esc(c.freedom || '—') + '</div></div>' +
        row('Что зафиксировано', c.fixed) +
        row('Что даёт компания', c.resources) +
        row('Бюджет и вознаграждение', c.budget) +
        row('Сроки', c.timeline) +
        row('Владелец запроса', [c.owner_name, c.owner_role].filter(Boolean).join(', ')) +
        row('Решение о внедрении принимает', c.decision_maker) +
        row('Что будет при успехе', c.next_step) +
      '</div>' +
      (company ? '' : '<div class="ch-ai"><button type="button" class="btn-register" data-sprint="' + esc(c.id) + '">Сгенерировать гипотезы решения с ИИ-агентом</button>' +
        '<span class="cell-sub">Агент «Генератор и быстрая проверка гипотез» предложит 5–10 подходов и быстрые проверки — до отклика.</span></div>') +
      (canRespond ? (
        '<form class="ch-form" id="chForm">' +
          '<h3>Откликнуться</h3>' +
          (c.my_response ? '<p class="cell-sub">Вы уже откликались на этот запрос — можно отправить уточнённый вариант.</p>' : '') +
          '<label><span>Команда / стартап</span><input name="team" required maxlength="160" value="' + esc(dashStartup()) + '" placeholder="Например: ЛузгаСорб"></label>' +
          '<label><span>Идея подхода — своими словами</span><textarea name="approach" rows="5" required maxlength="2000" placeholder="Как вы видите решение, почему ваша технология подходит, как быстро проверить идею"></textarea></label>' +
          '<label><span>Что нужно от компании</span><textarea name="needs" rows="2" maxlength="1000" placeholder="Данные, доступ на площадку, встреча с экспертом…"></textarea></label>' +
          '<div class="ch-form-row"><label><span>Стадия</span><input name="stage" maxlength="120" value="' + esc(journeyStage()) + '"></label>' +
          '<label><span>Контакт</span><input name="contact" maxlength="200" placeholder="e-mail или телеграм"></label></div>' +
          '<p class="login-msg" id="chFormMsg" hidden></p>' +
          '<button type="submit" class="btn-primary">Отправить отклик</button>' +
        '</form>')
        : (c.is_owner ? '<p class="cell-sub">Это ваш запрос — отклики разбираются в <a href="company.html">Кабинете заказчика</a>.</p>'
          : (company ? '<p class="cell-sub">На запросы откликаются команды стартапов.</p>' : '<p class="cell-sub">Запрос сейчас не принимает отклики.</p>')));

    var form = el('chForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = el('chFormMsg');
        var data = {
          team: form.elements.team.value, approach: form.elements.approach.value,
          needs: form.elements.needs.value, stage: form.elements.stage.value, contact: form.elements.contact.value
        };
        API.challengeRespond(token(), c.id, data).then(function () {
          msg.className = 'login-msg login-msg--note';
          msg.textContent = 'Отклик отправлен. Статус появится во вкладке «Мои отклики», когда компания его рассмотрит.';
          msg.hidden = false;
          form.querySelector('button[type="submit"]').disabled = true;
          load();
        }).catch(function (err) {
          msg.className = 'login-msg login-msg--error';
          msg.textContent = err && err.message ? err.message : 'Не удалось отправить отклик';
          msg.hidden = false;
        });
      });
    }
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function launchSprinter(c) {
    var prompt = 'Запусти навык «Генератор и быстрая проверка гипотез»: работай строго по его алгоритму. ' +
      'Исходные данные — открытый вызов компании «' + (c.company || '') + '»: «' + c.title + '». Боль: ' + (c.pain || '') +
      ' Цена проблемы: ' + (c.cost_of_problem || 'не указана') + '. Результат, который примет компания: ' + (c.success_criteria || '') +
      '. Свобода решения: ' + (c.freedom || '') + '. Ограничения: ' + (c.fixed || 'нет') +
      '. Предложи подходы к решению с учётом нашей технологии и быстрые проверки до отклика.';
    var dlg = el('chDialog');
    if (dlg.open) dlg.close();
    document.dispatchEvent(new CustomEvent('aios-launch-skill', {
      detail: { skill_id: 'hypothesis-sprinter', name: 'Генератор и быстрая проверка гипотез', prompt: prompt }
    }));
  }

  /* ---------- мои отклики ---------- */

  function renderMine() {
    var box = el('chMine');
    box.innerHTML = 'Загрузка…';
    API.myChallengeResponses(token()).then(function (data) {
      var items = data.items || [];
      var pill = { new: 'done', interested: 'warn', pilot: 'ok', declined: 'bad' };
      box.innerHTML = items.length ? '<div class="table-wrap"><table class="dtable"><thead><tr><th>Запрос</th><th>Команда и подход</th><th>Статус</th><th>Комментарий компании</th></tr></thead><tbody>' +
        items.map(function (r) {
          return '<tr><td><div class="cell-title">' + esc(r.challenge_title) + '</div><div class="cell-sub">' + esc(r.company) + ' · ' + fmtDate(r.created_at) + '</div></td>' +
            '<td><div class="cell-title">' + esc(r.team) + '</div><div class="cell-sub">' + esc(short(r.approach, 160)) + '</div></td>' +
            '<td><span class="pill pill--' + (pill[r.status] || 'done') + '">' + esc(r.status_title || r.status) + '</span></td>' +
            '<td>' + esc(r.comment || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<p class="jr-muted">Вы ещё не откликались на запросы компаний.</p>';
    }).catch(function (err) {
      box.innerHTML = '<p class="jr-muted">' + esc(err && err.message ? err.message : 'Не удалось загрузить отклики') + '</p>';
    });
  }

  /* ---------- события ---------- */

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-open')) openCard(t.getAttribute('data-open'));
    else if (t.hasAttribute('data-close')) el('chDialog').close();
    else if (t.hasAttribute('data-format')) { state.format = t.getAttribute('data-format'); renderFormats(); renderGrid(); }
    else if (t.hasAttribute('data-sprint')) {
      var c = state.items.filter(function (x) { return x.id === t.getAttribute('data-sprint'); })[0];
      if (c) launchSprinter(c);
    } else if (t.hasAttribute('data-tab')) {
      state.tab = t.getAttribute('data-tab');
      document.querySelectorAll('.ch-tabs .chip').forEach(function (b) { b.classList.toggle('is-on', b === t); });
      el('chGrid').hidden = state.tab !== 'all';
      el('chFormats').hidden = state.tab !== 'all';
      el('chSearch').hidden = state.tab !== 'all';
      el('chMine').hidden = state.tab !== 'mine';
      if (state.tab === 'mine') renderMine();
    }
  });

  el('chSearch').addEventListener('input', function () {
    state.q = this.value.trim().toLowerCase();
    renderGrid();
  });

  function load() {
    if (!API || !token()) {
      el('chGrid').innerHTML = '<p class="jr-muted">Войдите, чтобы увидеть запросы компаний.</p>';
      return;
    }
    API.challengesList(token()).then(function (data) {
      state.items = data.items || [];
      state.formats = data.formats || {};
      renderFormats();
      renderGrid();
      var hash = location.hash.replace('#', '');
      if (hash && state.items.some(function (c) { return c.id === hash; })) {
        openCard(hash);
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }
    }).catch(function (err) {
      el('chGrid').innerHTML = '<p class="jr-muted">' + esc(err && err.message ? err.message : 'Не удалось загрузить запросы') + '</p>';
    });
  }

  window.addEventListener('aios-auth-change', function () { renderBanner(); load(); });
  renderBanner();
  load();
})();
