/* ============================================================
   «Рабочий стол стартапа» (index.html).

   Данные — data/dashboard.json (демо-данные стартапа «ЛузгаСорб» —
   сорбент из лузги подсолнечника для очистки ливневых стоков).
   Команда меняет их под свой стартап двумя способами:
     1) правит data/dashboard.json в репозитории (видят все);
     2) кнопкой «Загрузить свои данные» подставляет свой JSON той же
        структуры — он хранится только в этом браузере (localStorage).

   Виджеты:
     - Доска гипотез: бэклог → проверяется → подтверждена / опровергнута,
       фильтр по типу гипотезы (проблема, сегмент, ценность, цена, канал, рост);
     - Воронка CustDev и продаж: контакты → интервью → … → платящие клиенты,
       конверсия между шагами, «узкое место» подсвечивается;
     - Размер рынка: TAM / SAM / SOM и сегменты;
     - Юнит-экономика: LTV, CAC, LTV/CAC, срок окупаемости CAC;
     - Деньги и runway: выручка и расходы по месяцам (факт / план),
       остаток денег и месяц, когда они закончатся;
     - Конкуренты и альтернативы; команда и доли;
     - Вехи (контрольные точки) со статусами;
     - Путь стартапа: уровень команды на игровом поле (journey.html,
       прогресс — localStorage aios-journey-v1:<логин>) и ближайшие квесты;
     - Риски: тепловая карта «вероятность × влияние» и реестр рисков.
   ============================================================ */

(function () {
  var DATA_URL = '/data/dashboard.json';
  var LOCAL_KEY = 'aios-startup-dashboard-v1';

  var HYP_TYPES = {
    problem: 'Проблема',
    segment: 'Сегмент',
    value: 'Ценность',
    price: 'Цена',
    channel: 'Канал',
    growth: 'Рост'
  };
  var HYP_STATUS = [
    { key: 'backlog', title: 'Бэклог', pill: 'done' },
    { key: 'testing', title: 'Проверяется', pill: 'warn' },
    { key: 'confirmed', title: 'Подтверждена', pill: 'ok' },
    { key: 'refuted', title: 'Опровергнута', pill: 'bad' }
  ];
  var MS_STATUS = {
    on_track: 'В графике',
    risk: 'Риск',
    overdue: 'Просрочено',
    done: 'Выполнено'
  };

  var state = {
    data: null,
    source: 'demo',
    hypType: 'all',
    funnelStep: null,
    msFilter: 'all'
  };

  /* ---------- утилиты ---------- */

  function el(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* суммы в данных — тыс. ₽ */
  function money(thousands) {
    var n = Number(thousands) || 0;
    var a = Math.abs(n);
    if (a >= 1000000) return (n / 1000000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млрд ₽';
    if (a >= 1000) return (n / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн ₽';
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' тыс. ₽';
  }

  function num(v, digits) {
    return (Number(v) || 0).toLocaleString('ru-RU', { maximumFractionDigits: digits == null ? 1 : digits });
  }

  function plural(n, one, few, many) {
    n = Math.abs(Math.floor(n));
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtMonth(ym) {
    var d = new Date(String(ym) + '-01');
    if (isNaN(d)) return esc(ym);
    return d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '') + ' ' + String(d.getFullYear()).slice(2);
  }

  function today() {
    var asOf = state.data && state.data.as_of ? new Date(state.data.as_of) : null;
    return asOf && !isNaN(asOf) ? asOf : new Date();
  }

  function arr(key) {
    var v = state.data && state.data[key];
    return Array.isArray(v) ? v : [];
  }

  function obj(key) {
    var v = state.data && state.data[key];
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  /* Статус вехи: явный из данных, иначе — по прогрессу и сроку */
  function msStatus(row) {
    if ((Number(row.progress) || 0) >= 100) return 'done';
    if (row.status && MS_STATUS[row.status] && row.status !== 'done') {
      var d0 = new Date(row.due);
      if (!isNaN(d0) && d0 < today()) return 'overdue';
      return row.status;
    }
    var due = new Date(row.due);
    if (!isNaN(due) && due < today()) return 'overdue';
    return (Number(row.progress) || 0) < 30 ? 'risk' : 'on_track';
  }

  /* ---------- расчёты ---------- */

  /* Юнит-экономика: всё в тыс. ₽ */
  function unitEconomics() {
    var u = obj('unit_economics');
    var arpa = (Number(u.price_month) || 0) * (Number(u.units_per_customer) || 1); // выручка с клиента в месяц
    var gm = Math.max(0, Math.min(1, Number(u.gross_margin) || 0));
    var margin = arpa * gm;                                        // маржа с клиента в месяц
    var life = Number(u.lifetime_months) || 0;
    var cac = Number(u.cac) || 0;
    var ltv = margin * life;
    return {
      arpa: arpa,
      margin: margin,
      ltv: ltv,
      cac: cac,
      ratio: cac ? ltv / cac : 0,
      payback: margin ? cac / margin : Infinity,
      model: u.model || '',
      note: u.note || ''
    };
  }

  /* Runway: остаток денег, движение по месяцам после даты остатка */
  function runway() {
    var cash = obj('cash');
    var balance = Number(cash.balance) || 0;
    var since = String(cash.balance_date || '').slice(0, 7);
    var flows = arr('cashflow');
    var future = flows.filter(function (f) { return !since || String(f.month) >= since; });
    var past = flows.filter(function (f) { return f.fact; }).slice(-3);
    var burn = past.length
      ? past.reduce(function (s, f) { return s + (Number(f.costs) || 0) - (Number(f.revenue) || 0); }, 0) / past.length
      : 0;
    var left = balance;
    var zeroMonth = null;
    var series = [];
    future.forEach(function (f) {
      left += (Number(f.revenue) || 0) - (Number(f.costs) || 0);
      series.push({ month: f.month, balance: left });
      if (left < 0 && !zeroMonth) zeroMonth = f.month;
    });
    return {
      balance: balance,
      burn: burn,
      months: burn > 0 ? balance / burn : Infinity,
      zeroMonth: zeroMonth,
      series: series,
      note: cash.note || ''
    };
  }

  /* ---------- тултип ---------- */

  var tip = el('dashTip');

  function showTip(evt, html) {
    if (!tip) return;
    tip.innerHTML = html;
    tip.hidden = false;
    var x = evt.clientX + 14, y = evt.clientY + 14;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function hideTip() { if (tip) tip.hidden = true; }

  /* ---------- KPI ---------- */

  function renderKpi() {
    var hyps = arr('hypotheses');
    var confirmed = hyps.filter(function (h) { return h.status === 'confirmed'; }).length;
    var refuted = hyps.filter(function (h) { return h.status === 'refuted'; }).length;
    var r = obj('readiness');
    var funnel = arr('funnel');
    var interviews = funnel.filter(function (f) { return f.key === 'interviews'; })[0];
    var paid = funnel.filter(function (f) { return f.key === 'paid'; })[0];
    var ue = unitEconomics();
    var rw = runway();
    var overdue = arr('milestones').filter(function (m) { return msStatus(m) === 'overdue'; }).length;

    var tiles = [
      { label: 'Готовность', value: 'УГТ ' + (r.trl || '—'), note: 'IRL ' + (r.irl || '—') + ' · CRL ' + (r.crl || '—') },
      { label: 'Гипотезы подтверждены', value: confirmed + ' из ' + hyps.length, note: refuted + ' ' + plural(refuted, 'опровергнута', 'опровергнуты', 'опровергнуто') + ' — это тоже результат' },
      { label: 'Интервью с клиентами', value: interviews ? num(interviews.value, 0) : '—', note: paid ? num(paid.value, 0) + ' ' + plural(paid.value, 'платящий клиент', 'платящих клиента', 'платящих клиентов') : 'нет данных о продажах', alert: interviews && interviews.value < 20 },
      { label: 'LTV / CAC', value: ue.cac ? num(ue.ratio, 1) : '—', note: ue.ratio >= 3 ? 'здоровая экономика (≥ 3)' : 'ниже ориентира 3', alert: ue.cac && ue.ratio < 3 },
      { label: 'Runway', value: isFinite(rw.months) ? num(rw.months, 1) + ' мес.' : '∞', note: 'при среднем burn ' + money(rw.burn) + '/мес.', alert: rw.months < 6 },
      { label: 'Просроченные вехи', value: overdue, note: 'контрольные точки команды', alert: overdue > 0 }
    ];
    el('kpiRow').innerHTML = tiles.map(function (t) {
      return '<div class="kpi' + (t.alert ? ' kpi--alert' : '') + '">' +
        '<div class="kpi-label">' + esc(t.label) + '</div>' +
        '<div class="kpi-value">' + esc(t.value) + '</div>' +
        '<div class="kpi-note">' + esc(t.note) + '</div></div>';
    }).join('');
  }

  /* ---------- Доска гипотез ---------- */

  function renderHypotheses() {
    var hyps = arr('hypotheses').filter(function (h) {
      return state.hypType === 'all' || h.type === state.hypType;
    });
    el('hypBoard').innerHTML = HYP_STATUS.map(function (st) {
      var list = hyps.filter(function (h) { return (h.status || 'backlog') === st.key; });
      return '<div class="hyp-col hyp-col--' + st.key + '">' +
        '<div class="hyp-col-head"><span>' + esc(st.title) + '</span><b>' + list.length + '</b></div>' +
        list.map(function (h) {
          return '<div class="hyp-card">' +
            '<div class="hyp-card-top"><span class="pill pill--' + st.pill + '">' + esc(HYP_TYPES[h.type] || h.type || 'Гипотеза') + '</span>' +
            '<span class="cell-sub">' + esc(h.id || '') + (h.due ? ' · до ' + fmtDate(h.due) : '') + '</span></div>' +
            '<div class="hyp-text">' + esc(h.statement) + '</div>' +
            (h.criterion ? '<div class="hyp-meta"><b>Критерий:</b> ' + esc(h.criterion) + '</div>' : '') +
            (h.method ? '<div class="hyp-meta"><b>Как проверяем:</b> ' + esc(h.method) + '</div>' : '') +
            (h.evidence ? '<div class="hyp-meta hyp-evidence"><b>Факт:</b> ' + esc(h.evidence) + '</div>' : '') +
            (h.owner ? '<div class="cell-sub">' + esc(h.owner) + '</div>' : '') +
            '</div>';
        }).join('') +
        (list.length ? '' : '<div class="hyp-empty">—</div>') +
        '</div>';
    }).join('');
  }

  /* ---------- Воронка CustDev и продаж ---------- */

  function renderFunnel() {
    var steps = arr('funnel');
    var worst = null;
    steps.forEach(function (s, i) {
      if (i === 0) return;
      var prev = Number(steps[i - 1].value) || 0;
      var conv = prev ? (Number(s.value) || 0) / prev : 0;
      if (worst === null || conv < worst.conv) worst = { i: i, conv: conv };
    });

    el('custdevFunnel').innerHTML = steps.map(function (s, i) {
      var prev = i > 0 ? Number(steps[i - 1].value) || 0 : 0;
      var conv = i > 0 && prev ? Math.round((Number(s.value) || 0) / prev * 100) : null;
      var bottleneck = worst && worst.i === i;
      return (i > 0 ? '<div class="funnel-arrow' + (bottleneck ? ' funnel-arrow--bad' : '') + '" aria-hidden="true"><span>' + (conv == null ? '—' : conv + '%') + '</span></div>' : '') +
        '<button type="button" class="funnel-step' + (state.funnelStep === s.key ? ' is-active' : '') + '" data-step="' + esc(s.key) + '">' +
          '<span class="funnel-n">' + (i + 1) + '</span>' +
          '<span class="funnel-title">' + esc(s.title) + '</span>' +
          '<span class="funnel-value">' + num(s.value, 0) + '</span>' +
          '<span class="funnel-sub">' + esc(s.subtitle || '') + '</span>' +
        '</button>';
    }).join('');

    el('custdevFunnel').querySelectorAll('.funnel-step').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-step');
        state.funnelStep = state.funnelStep === key ? null : key;
        renderFunnel();
      });
    });

    var detail = el('funnelDetail');
    var first = steps[0], last = steps[steps.length - 1];
    var total = first && last && Number(first.value) ? (Number(last.value) || 0) / Number(first.value) * 100 : 0;
    var text = 'Процент над стрелкой — конверсия в следующий шаг. Сквозная конверсия: <b>' + num(total, 1) + ' %</b>.';
    if (worst && steps[worst.i]) {
      text += ' Узкое место — переход «' + esc(steps[worst.i - 1].title) + ' → ' + esc(steps[worst.i].title) +
        '» (' + Math.round(worst.conv * 100) + ' %): с него и начните следующий эксперимент.';
    }
    detail.innerHTML = '<p class="widget-sub">' + text + '</p>';
  }

  /* ---------- Размер рынка ---------- */

  function renderMarket() {
    var m = obj('market');
    var levels = ['tam', 'sam', 'som'].map(function (k) { return { key: k, d: m[k] || {} }; });
    var max = Math.max.apply(null, levels.map(function (l) { return Number(l.d.value) || 0; }).concat([1]));
    var unit = m.unit || 'тыс. ₽ в год';
    el('marketBars').innerHTML = levels.map(function (l) {
      var v = Number(l.d.value) || 0;
      /* логарифмическая шкала: SOM обычно в сотни раз меньше TAM */
      var w = v > 0 ? Math.max(4, Math.log10(1 + v) / Math.log10(1 + max) * 100) : 0;
      return '<div class="mkt-row" data-key="' + l.key + '">' +
        '<div class="mkt-label"><b>' + esc(l.d.label || l.key.toUpperCase()) + '</b><span>' + money(v) + '</span></div>' +
        '<div class="mkt-track"><span class="mkt-bar mkt-bar--' + l.key + '" style="width:' + w + '%"></span></div>' +
        '<div class="cell-sub">' + esc(l.d.method || '') + '</div></div>';
    }).join('') +
      '<p class="cell-sub">Единицы: ' + esc(unit) + '. Длина полос — в логарифмической шкале. SOM/SAM = ' +
      (Number((m.sam || {}).value) ? num((Number((m.som || {}).value) || 0) / Number(m.sam.value) * 100, 1) : '—') + ' %.</p>';

    var segs = Array.isArray(m.segments) ? m.segments : [];
    el('segmentsTable').innerHTML =
      '<thead><tr><th>Сегмент</th><th class="num">Компаний</th><th class="num">Чек в год</th><th class="num">Ёмкость</th></tr></thead><tbody>' +
      segs.map(function (s) {
        var cap = (Number(s.companies) || 0) * (Number(s.check) || 0);
        return '<tr><td><div class="cell-title">' + esc(s.name) + '</div>' +
          (s.priority === 'high' ? '<span class="pill pill--ok">приоритет</span>' : '') + '</td>' +
          '<td class="num">' + num(s.companies, 0) + '</td>' +
          '<td class="num">' + money(s.check) + '</td>' +
          '<td class="num">' + money(cap) + '</td></tr>';
      }).join('') +
      (segs.length ? '' : '<tr><td colspan="4" class="empty">Добавьте сегменты в data/dashboard.json → market.segments</td></tr>') +
      '</tbody>';
  }

  /* ---------- Юнит-экономика ---------- */

  function renderEconomics() {
    var u = unitEconomics();
    var cells = [
      ['Выручка с клиента', money(u.arpa) + '/мес.', 'ARPA'],
      ['Маржа с клиента', money(u.margin) + '/мес.', 'ARPA × валовая маржа'],
      ['LTV', money(u.ltv), 'маржа × срок жизни клиента'],
      ['CAC', money(u.cac), 'стоимость привлечения клиента'],
      ['LTV / CAC', u.cac ? num(u.ratio, 1) : '—', 'ориентир — 3 и выше'],
      ['Окупаемость CAC', isFinite(u.payback) ? num(u.payback, 1) + ' мес.' : '—', 'ориентир — до 12 мес.']
    ];
    el('ueGrid').innerHTML = cells.map(function (c, i) {
      var bad = (i === 4 && u.cac && u.ratio < 3) || (i === 5 && u.payback > 12);
      return '<div class="ue-cell' + (bad ? ' ue-cell--bad' : '') + '"><span class="ue-label">' + esc(c[0]) + '</span>' +
        '<span class="ue-value">' + esc(c[1]) + '</span><span class="cell-sub">' + esc(c[2]) + '</span></div>';
    }).join('');
    var verdict;
    if (!u.cac || !u.arpa) verdict = 'Заполните unit_economics в data/dashboard.json, чтобы увидеть расчёт.';
    else if (u.ratio >= 3 && u.payback <= 12) verdict = 'Экономика сходится: можно вкладываться в каналы привлечения. Проверьте, что маржа и срок жизни подтверждены фактом, а не гипотезой.';
    else if (u.ratio >= 1) verdict = 'Клиент окупается, но медленно. Рычаги: цена, рост числа единиц на клиента, более дешёвый канал привлечения — проверьте их как гипотезы.';
    else verdict = 'Каждый новый клиент приносит убыток: пересмотрите цену, себестоимость или канал до масштабирования.';
    el('ueVerdict').innerHTML = '<p class="widget-sub"><b>' + esc(u.model) + '.</b> ' + esc(verdict) + (u.note ? ' <i>' + esc(u.note) + '</i>' : '') + '</p>';
  }

  /* ---------- Деньги и runway ---------- */

  function renderCash() {
    var flows = arr('cashflow');
    var rw = runway();
    var max = Math.max.apply(null, flows.map(function (f) { return Math.max(Number(f.revenue) || 0, Number(f.costs) || 0); }).concat([1]));
    var balances = {};
    rw.series.forEach(function (s) { balances[s.month] = s.balance; });

    el('cashChart').innerHTML = flows.map(function (f) {
      var rev = Number(f.revenue) || 0, cost = Number(f.costs) || 0;
      var bal = balances[f.month];
      return '<div class="cash-col' + (f.fact ? '' : ' cash-col--plan') + (rw.zeroMonth === f.month ? ' cash-col--zero' : '') + '" data-month="' + esc(f.month) + '">' +
        '<div class="cash-bars">' +
          '<span class="cash-bar cash-bar--rev" style="height:' + (rev / max * 100) + '%"></span>' +
          '<span class="cash-bar cash-bar--cost" style="height:' + (cost / max * 100) + '%"></span>' +
        '</div>' +
        '<span class="cash-label">' + fmtMonth(f.month) + '</span>' +
        (bal != null ? '<span class="cash-bal' + (bal < 0 ? ' is-neg' : '') + '">' + num(bal / 1000, 1) + '</span>' : '<span class="cash-bal"></span>') +
        '</div>';
    }).join('');

    el('cashChart').querySelectorAll('.cash-col').forEach(function (col) {
      var f = flows.filter(function (x) { return x.month === col.getAttribute('data-month'); })[0];
      col.addEventListener('mousemove', function (e) {
        var bal = balances[f.month];
        showTip(e, '<b>' + fmtMonth(f.month) + (f.fact ? ' · факт' : ' · план') + '</b><br>Выручка: ' + money(f.revenue) +
          '<br>Расходы: ' + money(f.costs) + '<br>Результат: ' + money((Number(f.revenue) || 0) - (Number(f.costs) || 0)) +
          (bal != null ? '<br>Остаток денег: ' + money(bal) : ''));
      });
      col.addEventListener('mouseleave', hideTip);
    });

    var msg;
    if (rw.zeroMonth) msg = '<b class="txt-bad">По плану деньги закончатся в ' + fmtMonth(rw.zeroMonth) + '.</b> Начинайте привлечение за 6 месяцев до этой даты.';
    else if (rw.series.length) msg = 'По плану деньги не заканчиваются до ' + fmtMonth(rw.series[rw.series.length - 1].month) + ' (остаток ' + money(rw.series[rw.series.length - 1].balance) + ').';
    else msg = 'Добавьте cash.balance и cashflow в data/dashboard.json.';
    el('cashNote').innerHTML = '<p class="widget-sub">Остаток на ' + fmtDate(obj('cash').balance_date) + ': <b>' + money(rw.balance) + '</b>. ' + msg +
      (rw.note ? ' <i>' + esc(rw.note) + '</i>' : '') + '</p>';
  }

  /* ---------- Конкуренты ---------- */

  function renderCompetitors() {
    var rows = arr('competitors');
    el('competitorsTable').innerHTML =
      '<thead><tr><th>Решение</th><th>Цена</th><th>Сильная сторона</th><th>Слабая сторона</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr><td><div class="cell-title">' + esc(c.name) + '</div><div class="cell-sub">' + esc(c.type || '') + '</div></td>' +
          '<td>' + esc(c.price || '—') + '</td><td>' + esc(c.strength || '—') + '</td><td>' + esc(c.weakness || '—') + '</td></tr>';
      }).join('') +
      (rows.length ? '' : '<tr><td colspan="4" class="empty">Нет данных о конкурентах</td></tr>') +
      '</tbody>';
  }

  /* ---------- Команда и доли ---------- */

  function renderTeam() {
    var team = arr('team');
    var total = team.reduce(function (s, t) { return s + (Number(t.share) || 0); }, 0) || 1;
    var colors = ['var(--green)', 'var(--gold)', 'var(--green-deep)', 'var(--amber)', '#9AA8BC', 'var(--red)'];
    el('teamShares').innerHTML = '<div class="split-track">' + team.map(function (t, i) {
      return '<div class="split-seg" style="flex:' + (Number(t.share) || 0) + ';background:' + colors[i % colors.length] + '" title="' + esc(t.name) + ': ' + esc(t.share) + ' %"></div>';
    }).join('') + '</div>';
    el('teamList').innerHTML = team.map(function (t, i) {
      return '<li><b><i class="sw" style="background:' + colors[i % colors.length] + '"></i>' + esc(t.name) +
        ' — ' + num((Number(t.share) || 0) / total * 100, 1) + ' %</b><span>' + esc(t.role || '') +
        (t.from_university ? ' · ' + esc(t.from_university) : '') + '</span></li>';
    }).join('') || '<li class="empty">Добавьте команду в data/dashboard.json → team</li>';
  }

  /* ---------- Вехи ---------- */

  function renderMilestones() {
    var rows = arr('milestones').map(function (r) {
      return Object.assign({}, r, { _status: msStatus(r) });
    }).filter(function (r) {
      return state.msFilter === 'all' || r._status === state.msFilter;
    }).sort(function (a, b) { return new Date(a.due) - new Date(b.due); });

    var pillClass = { on_track: 'ok', risk: 'warn', overdue: 'bad', done: 'done' };
    el('milestonesTable').innerHTML =
      '<thead><tr><th>Веха</th><th>Срок</th><th>Выполнение</th><th>Статус</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var pr = Math.max(0, Math.min(100, Number(r.progress) || 0));
        return '<tr><td><div class="cell-title">' + esc(r.title) + '</div><div class="cell-sub">' + esc(r.owner || '') + '</div></td>' +
          '<td>' + fmtDate(r.due) + '</td>' +
          '<td><div class="progress-mini"><span class="pm-' + pillClass[r._status] + '" style="width:' + pr + '%"></span></div><div class="cell-sub">' + pr + '%</div></td>' +
          '<td><span class="pill pill--' + pillClass[r._status] + '">' + MS_STATUS[r._status] + '</span></td></tr>';
      }).join('') +
      (rows.length ? '' : '<tr><td colspan="4" class="empty">Нет вех с таким статусом</td></tr>') +
      '</tbody>';
  }

  /* ---------- Путь стартапа (мини-поле) ---------- */

  var journey = null; /* data/startup-journey.json */

  function journeyLevel() {
    var login = 'guest';
    try {
      var s = JSON.parse(localStorage.getItem('aios-auth-v1') || 'null');
      if (s && s.login) login = s.login;
    } catch (e) {}
    try {
      var p = JSON.parse(localStorage.getItem('aios-journey-v1:' + login) || 'null');
      return p && p.level ? p : null;
    } catch (e) { return null; }
  }

  function renderJourney() {
    var box = el('journeyMini');
    if (!box) return;
    if (!journey) {
      fetch('/data/startup-journey.json').then(function (r) { return r.json(); })
        .then(function (j) { journey = j; renderJourney(); })
        .catch(function () { box.innerHTML = '<p class="widget-sub">Карта пути не загрузилась.</p>'; });
      return;
    }
    var prog = journeyLevel();
    var n = prog ? prog.level : 1;
    var lv = journey.levels.filter(function (l) { return l.n === n; })[0] || journey.levels[0];
    var done = prog ? prog.quests || {} : {};
    var next = lv.quests.filter(function (q) { return !done[q.id]; }).slice(0, 3);
    box.innerHTML =
      '<ol class="jm-track">' + journey.levels.map(function (l) {
        var st = l.n < n ? 'done' : (l.n === n ? 'current' : 'future');
        return '<li class="jm-step jm-step--' + st + '" title="Уровень ' + l.n + ': ' + esc(l.title) + '"><span>' + (st === 'done' ? '✓' : l.n) + '</span><em>' + esc(l.short || l.title) + '</em></li>';
      }).join('') + '</ol>' +
      '<div class="jm-body"><div><b>Уровень ' + lv.n + ' из ' + journey.levels.length + ': ' + esc(lv.title) + '.</b> ' + esc(lv.goal) +
        (prog ? '' : ' <span class="cell-sub">Уровень ещё не выбран — откройте игровое поле и пройдите самооценку.</span>') + '</div>' +
      '<div><b>Что делать сейчас:</b><ul>' + next.map(function (q) { return '<li>' + esc(q.text) + '</li>'; }).join('') + '</ul></div></div>';
  }

  /* ---------- Риски ---------- */

  var RISK_CAT = { tech: 'Технология', market: 'Рынок', finance: 'Финансы', legal: 'Права и РИД', team: 'Команда', regulatory: 'Регуляторика' };
  var RISK_STATUS = { open: ['Открыт', 'bad'], mitigating: ['Снижаем', 'warn'], closed: ['Закрыт', 'ok'] };

  function riskLevel(r) {
    var score = (Number(r.probability) || 0) * (Number(r.impact) || 0);
    return score >= 15 ? 'high' : (score >= 8 ? 'mid' : 'low');
  }

  function renderRisks() {
    var risks = arr('risks');
    var heat = el('riskHeat');
    if (!heat) return;
    var cells = '';
    for (var p = 5; p >= 1; p--) {
      for (var i = 1; i <= 5; i++) {
        var lvl = p * i >= 15 ? 'high' : (p * i >= 8 ? 'mid' : 'low');
        var here = risks.filter(function (r) { return r.status !== 'closed' && Number(r.probability) === p && Number(r.impact) === i; });
        cells += '<div class="risk-cell risk-cell--' + lvl + '" data-p="' + p + '" data-i="' + i + '">' +
          here.map(function (r) { return '<span class="risk-chip" data-risk="' + esc(r.id) + '">' + esc(r.id) + '</span>'; }).join('') + '</div>';
      }
    }
    heat.innerHTML = '<div class="risk-axis-y">Вероятность →</div><div class="risk-grid">' + cells + '</div><div class="risk-axis-x">Влияние на стартап →</div>';
    heat.querySelectorAll('.risk-chip').forEach(function (chip) {
      var r = risks.filter(function (x) { return x.id === chip.getAttribute('data-risk'); })[0];
      chip.addEventListener('mousemove', function (e) {
        showTip(e, '<b>' + esc(r.id) + ' · ' + esc(RISK_CAT[r.category] || r.category || '') + '</b><br>' + esc(r.title) + '<br><i>Что делаем: ' + esc(r.mitigation || '—') + '</i>');
      });
      chip.addEventListener('mouseleave', hideTip);
    });

    var sorted = risks.slice().sort(function (a, b) {
      var c = (a.status === 'closed') - (b.status === 'closed');
      return c || (Number(b.probability) * Number(b.impact)) - (Number(a.probability) * Number(a.impact));
    });
    el('risksTable').innerHTML =
      '<thead><tr><th>Риск</th><th class="num">В × В</th><th>Что делаем</th><th>Статус</th></tr></thead><tbody>' +
      sorted.map(function (r) {
        var st = RISK_STATUS[r.status] || RISK_STATUS.open;
        var score = (Number(r.probability) || 0) * (Number(r.impact) || 0);
        return '<tr' + (riskLevel(r) === 'high' && r.status !== 'closed' ? ' class="row-stale"' : '') + '><td><div class="cell-title">' + esc(r.id) + ' · ' + esc(r.title) + '</div>' +
          '<div class="cell-sub">' + esc(RISK_CAT[r.category] || r.category || '') + (r.owner ? ' · ' + esc(r.owner) : '') + '</div></td>' +
          '<td class="num">' + score + '</td><td>' + esc(r.mitigation || '—') + '</td>' +
          '<td><span class="pill pill--' + st[1] + '">' + st[0] + '</span></td></tr>';
      }).join('') +
      (risks.length ? '' : '<tr><td colspan="4" class="empty">Добавьте риски в data/dashboard.json → risks или соберите реестр с агентом «Риск-менеджер»</td></tr>') +
      '</tbody>';
  }

  var riskBtn = el('riskAgent');
  if (riskBtn) {
    riskBtn.addEventListener('click', function () {
      var list = arr('risks').map(function (r) {
        return r.id + ' «' + r.title + '» (вероятность ' + r.probability + ', влияние ' + r.impact + ', статус ' + r.status + ')';
      }).join('; ');
      document.dispatchEvent(new CustomEvent('aios-launch-skill', { detail: {
        skill_id: 'risk-manager', name: 'Риск-менеджер',
        prompt: 'Запусти навык «Риск-менеджер»: работай строго по его алгоритму. Наш стартап: ' + (state.data.startup || '') + ' — ' +
          (state.data.tagline || '') + '. Текущий реестр рисков: ' + (list || 'пока пуст') + '. Проверь, каких рисков не хватает, переоцени и предложи меры на ближайший месяц.'
      } }));
    });
  }

  /* ---------- фильтры-чипы ---------- */

  function setChip(group, value) {
    var box = document.querySelector('.chips[data-filter="' + group + '"]');
    if (box) {
      box.querySelectorAll('.chip').forEach(function (c) {
        c.classList.toggle('is-on', c.getAttribute('data-value') === value);
      });
    }
    if (group === 'hyp') { state.hypType = value; renderHypotheses(); }
    if (group === 'ms') { state.msFilter = value; renderMilestones(); }
  }

  document.querySelectorAll('.chips[data-filter]').forEach(function (box) {
    box.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (chip) setChip(box.getAttribute('data-filter'), chip.getAttribute('data-value'));
    });
  });

  /* ---------- загрузка и свои данные ---------- */

  function renderAll() {
    var d = state.data || {};
    el('dashStartup').textContent = (d.startup || 'Ваш стартап') + (d.tagline ? ' · ' + d.tagline : '');
    el('dashSource').textContent = state.source === 'local'
      ? 'Показаны ваши данные (загружены в этом браузере)'
      : 'Показаны демо-данные из data/dashboard.json — замените их данными своей команды';
    el('dashReset').hidden = state.source !== 'local';
    var parts = [
      ['KPI', renderKpi], ['гипотезы', renderHypotheses], ['воронка', renderFunnel], ['рынок', renderMarket],
      ['юнит-экономика', renderEconomics], ['деньги', renderCash], ['конкуренты', renderCompetitors],
      ['команда', renderTeam], ['вехи', renderMilestones], ['путь стартапа', renderJourney], ['риски', renderRisks]
    ];
    /* ошибка в одном виджете (например, из-за своих данных) не ломает остальные */
    parts.forEach(function (p) {
      try { p[1](); } catch (e) { if (window.console) console.error('Виджет «' + p[0] + '»:', e); }
    });
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function load() {
    var local = loadLocal();
    if (local) {
      state.data = local;
      state.source = 'local';
      renderAll();
      return;
    }
    fetch(DATA_URL, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.data = data;
        state.source = 'demo';
        renderAll();
      })
      .catch(function () {
        el('dashSource').textContent = 'Не удалось загрузить data/dashboard.json — запустите платформу через сервер (см. README).';
      });
  }

  var upload = el('dashUpload');
  if (upload) {
    upload.addEventListener('change', function () {
      var file = upload.files && upload.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || typeof data !== 'object' || !Array.isArray(data.hypotheses)) {
            throw new Error('нет массива hypotheses');
          }
          try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch (e) {}
          state.data = data;
          state.source = 'local';
          state.funnelStep = null;
          renderAll();
        } catch (err) {
          alert('Файл не похож на данные дашборда: ' + err.message + '. Возьмите за основу «Скачать шаблон данных».');
        }
        upload.value = '';
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  var reset = el('dashReset');
  if (reset) {
    reset.addEventListener('click', function () {
      try { localStorage.removeItem(LOCAL_KEY); } catch (e) {}
      load();
    });
  }

  var pathLogin = el('pathLogin');
  if (pathLogin) {
    pathLogin.addEventListener('click', function (e) {
      e.preventDefault();
      var btn = el('btnLogin');
      if (btn && !btn.hidden && btn.offsetParent !== null) btn.click();
      else window.location.href = 'cabinet.html';
    });
  }

  load();
})();
