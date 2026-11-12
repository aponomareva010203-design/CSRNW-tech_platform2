/* ============================================================
   «Путь стартапа» (journey.html) — полный путь развития
   студенческого стартапа как игровое поле с уровнями.

   Данные уровней — data/startup-journey.json: миры, уровни,
   квесты (что делать), ворота (критерии перехода на следующий
   уровень), артефакты, ловушки, меры поддержки, ИИ-помощники.

   Прогресс команды (текущий уровень, отмеченные квесты и ворота,
   история переходов) хранится в этом браузере — localStorage,
   ключ aios-journey-v1:<логин>. Его же читает виджет «Путь
   стартапа» на «Рабочем столе» (js/dashboard.js).

   Ворота с полем auto проверяются по данным «Рабочего стола
   стартапа» (свои данные из localStorage или data/dashboard.json):
   если данные подтверждают критерий, он отмечается сам.
   ============================================================ */

(function () {
  var DATA_URL = '/data/startup-journey.json';
  var DASH_URL = '/data/dashboard.json';
  var DASH_LOCAL = 'aios-startup-dashboard-v1';
  var AUTH_KEY = 'aios-auth-v1';
  var XP_QUEST = 10, XP_GATE = 15, XP_LEVEL = 50;

  var J = null;          /* карта пути */
  var dash = null;       /* данные дашборда */
  var agentNames = {};   /* id агента → название (data/skills.json) */
  var progress = null;   /* прогресс команды */
  var selected = 1;      /* уровень, открытый в карточке */

  /* ---------- утилиты ---------- */

  function el(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fetchJSON(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function login() {
    try {
      var s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      return s && s.login ? s.login : 'guest';
    } catch (e) { return 'guest'; }
  }

  function storeKey() { return 'aios-journey-v1:' + login(); }

  function loadProgress() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch (e) { p = null; }
    if (!p || typeof p !== 'object') p = { level: 0, quests: {}, gates: {}, history: [] };
    p.quests = p.quests || {};
    p.gates = p.gates || {};
    p.history = Array.isArray(p.history) ? p.history : [];
    return p;
  }

  function saveProgress() {
    try { localStorage.setItem(storeKey(), JSON.stringify(progress)); } catch (e) { /* приватный режим */ }
  }

  function levelOf(n) {
    return J.levels.filter(function (l) { return l.n === n; })[0] || null;
  }

  function worldOf(key) {
    return J.worlds.filter(function (w) { return w.key === key; })[0] || { title: '', subtitle: '', color: key };
  }

  function currentLevel() { return progress.level || 1; }

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  /* ---------- автопроверка ворот по данным дашборда ---------- */

  function dashArr(key) { return dash && Array.isArray(dash[key]) ? dash[key] : []; }
  function dashObj(key) {
    var v = dash && dash[key];
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  function funnelValue(key) {
    var s = dashArr('funnel').filter(function (f) { return f.key === key; })[0];
    return s ? Number(s.value) || 0 : null;
  }

  function unitEcon() {
    var u = dashObj('unit_economics');
    var arpa = (Number(u.price_month) || 0) * (Number(u.units_per_customer) || 1);
    var margin = arpa * Math.max(0, Math.min(1, Number(u.gross_margin) || 0));
    var cac = Number(u.cac) || 0;
    if (!cac || !margin) return null;
    return { ratio: margin * (Number(u.lifetime_months) || 0) / cac, payback: cac / margin };
  }

  function runwayMonths() {
    var cash = dashObj('cash');
    var past = dashArr('cashflow').filter(function (f) { return f.fact; }).slice(-3);
    if (!past.length || cash.balance == null) return null;
    var burn = past.reduce(function (s, f) { return s + (Number(f.costs) || 0) - (Number(f.revenue) || 0); }, 0) / past.length;
    return burn > 0 ? (Number(cash.balance) || 0) / burn : Infinity;
  }

  /* {ok, note} — критерий подтверждён/не подтверждён данными; null — данных нет */
  function autoCheck(rule) {
    if (!rule || !dash) return null;
    var parts = String(rule).split(':');
    var kind = parts[0], arg = parts.slice(1).join(':');
    var n = Number(arg), v;
    if (kind === 'interviews' || kind === 'loi' || kind === 'paid') {
      v = funnelValue(kind);
      if (v == null) return null;
      return { ok: v >= n, note: 'на дашборде: ' + v };
    }
    if (kind === 'trl' || kind === 'crl' || kind === 'irl') {
      v = Number(dashObj('readiness')[kind]);
      if (!v) return null;
      return { ok: v >= n, note: 'на дашборде: ' + kind.toUpperCase().replace('TRL', 'УГТ') + ' ' + v };
    }
    if (kind === 'hyp') {
      var list = dashArr('hypotheses').filter(function (h) { return h.type === arg; });
      if (!list.length) return null;
      var ok = list.some(function (h) { return h.status === 'confirmed'; });
      return { ok: ok, note: ok ? 'есть подтверждённая гипотеза' : 'подтверждённой гипотезы пока нет' };
    }
    if (kind === 'ltv_cac' || kind === 'payback') {
      var u = unitEcon();
      if (!u) return null;
      if (kind === 'ltv_cac') return { ok: u.ratio >= n, note: 'на дашборде: ' + u.ratio.toFixed(1) };
      return { ok: u.payback <= n, note: 'на дашборде: ' + u.payback.toFixed(1) + ' мес.' };
    }
    if (kind === 'runway') {
      v = runwayMonths();
      if (v == null) return null;
      return { ok: v >= n, note: 'на дашборде: ' + (isFinite(v) ? v.toFixed(1) + ' мес.' : '∞') };
    }
    if (kind === 'milestone') {
      var word = arg.toLowerCase();
      var ms = dashArr('milestones').filter(function (m) { return String(m.title || '').toLowerCase().indexOf(word) >= 0; });
      if (!ms.length) return null;
      var done = ms.some(function (m) { return (Number(m.progress) || 0) >= 100 || m.status === 'done'; });
      return { ok: done, note: done ? 'веха выполнена' : 'веха «' + ms[0].title + '» не выполнена' };
    }
    return null;
  }

  function gateDone(g) {
    if (progress.gates[g.id]) return true;
    var a = autoCheck(g.auto);
    return !!(a && a.ok);
  }

  /* Уровень по данным дашборда: первый, у которого автоворота не закрыты */
  function suggestedLevel() {
    if (!dash) return null;
    for (var i = 0; i < J.levels.length; i++) {
      var lv = J.levels[i];
      var autos = lv.gates.filter(function (g) { return g.auto; });
      if (!autos.length) continue;
      var blocked = autos.some(function (g) { var a = autoCheck(g.auto); return !a || !a.ok; });
      if (blocked) return lv.n;
    }
    return J.levels[J.levels.length - 1].n;
  }

  /* ---------- очки и звания ---------- */

  function levelStats(lv) {
    var q = lv.quests.filter(function (x) { return progress.quests[x.id]; }).length;
    var g = lv.gates.filter(gateDone).length;
    var total = lv.quests.length + lv.gates.length;
    return { quests: q, gates: g, gatesTotal: lv.gates.length, pct: total ? Math.round((q + g) / total * 100) : 0 };
  }

  function xp() {
    var sum = 0;
    /* очки — только за пройденные и текущий уровни */
    J.levels.forEach(function (lv) {
      if (lv.n > currentLevel()) return;
      var s = levelStats(lv);
      sum += s.quests * XP_QUEST + s.gates * XP_GATE;
    });
    return sum + (currentLevel() - 1) * XP_LEVEL;
  }

  function rank(points) {
    var r = J.ranks[0];
    J.ranks.forEach(function (x) { if (points >= x.xp) r = x; });
    return r;
  }

  /* ---------- запуск ИИ-агента в рабочем чате ---------- */

  function launchAgent(id, extra) {
    var name = agentNames[id] || id;
    var lv = levelOf(currentLevel());
    var prompt = 'Запусти навык «' + name + '»: работай строго по его алгоритму, начиная с первого шага. ' +
      'Контекст: наш стартап на уровне ' + lv.n + ' из ' + J.levels.length + ' «' + lv.title + '» пути стартапа. ' +
      'Цель уровня: ' + lv.goal + (extra ? ' ' + extra : '');
    document.dispatchEvent(new CustomEvent('aios-launch-skill', { detail: { skill_id: id, name: name, prompt: prompt } }));
  }

  function trackerPrompt() {
    var lv = levelOf(currentLevel());
    var open = lv.quests.filter(function (q) { return !progress.quests[q.id]; }).map(function (q) { return '«' + q.text + '»'; });
    var gates = lv.gates.map(function (g) { return (gateDone(g) ? '[выполнено] ' : '[не выполнено] ') + g.text; });
    return 'Невыполненные квесты: ' + (open.join('; ') || 'нет') + '. Ворота перехода: ' + gates.join('; ') +
      '. Помоги выбрать 1–3 цели на эту неделю и понять, что мешает перейти на следующий уровень.';
  }

  function toolHtml(t) {
    if (!t) return '';
    if (t.agent) {
      return '<button type="button" class="jr-tool jr-tool--agent" data-agent="' + esc(t.agent) + '">' + esc(t.label) + '</button>';
    }
    return '<a class="jr-tool" href="' + esc(t.href) + '">' + esc(t.label) + ' →</a>';
  }

  /* ---------- статус команды ---------- */

  function renderStatus() {
    var cur = levelOf(currentLevel());
    var w = worldOf(cur.world);
    var s = levelStats(cur);
    var points = xp();
    var r = rank(points);
    var next = cur.quests.filter(function (q) { return !progress.quests[q.id]; }).slice(0, 3);
    var gatesLeft = cur.gates.filter(function (g) { return !gateDone(g); });
    var sug = suggestedLevel();

    var hint = '';
    if (!progress.level && sug) {
      hint = '<div class="jr-hint"><b>Где вы сейчас?</b> По данным «Рабочего стола стартапа» команда примерно на уровне ' + sug +
        ' «' + esc(levelOf(sug).title) + '». <button type="button" class="btn-primary jr-hint-btn" data-set-level="' + sug + '">Встать на уровень ' + sug + '</button>' +
        ' <button type="button" class="btn-register jr-hint-btn" data-open-diag="1">Пройти самооценку</button></div>';
    }

    el('jrStatus').innerHTML = hint +
      '<div class="jr-status-grid">' +
        '<div class="jr-status-main jr-w--' + esc(w.color) + '">' +
          '<div class="jr-eyebrow">Мир «' + esc(w.title) + '» · уровень ' + cur.n + ' из ' + J.levels.length + '</div>' +
          '<div class="jr-status-title">' + esc(cur.title) + '</div>' +
          '<p class="jr-status-goal">' + esc(cur.goal) + '</p>' +
          '<div class="jr-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + s.pct + '"><span style="width:' + s.pct + '%"></span></div>' +
          '<div class="jr-status-meta"><span>Уровень пройден на <b>' + s.pct + ' %</b></span>' +
          '<span>Ворота: <b>' + s.gates + ' из ' + s.gatesTotal + '</b></span>' +
          '<span>Очки: <b>' + points + ' XP</b> · звание «' + esc(r.title) + '»</span></div>' +
        '</div>' +
        '<div class="jr-status-next">' +
          '<div class="jr-eyebrow">Что делать сейчас</div>' +
          (next.length ? '<ol class="jr-next">' + next.map(function (q) {
            return '<li><span>' + esc(q.text) + '</span>' + toolHtml(q.tool) + '</li>';
          }).join('') + '</ol>' : '<p class="jr-muted">Все квесты уровня выполнены.</p>') +
          (gatesLeft.length
            ? '<p class="jr-muted">До перехода на следующий уровень: ' + gatesLeft.map(function (g) { return '«' + esc(g.text) + '»'; }).join(', ') + '.</p>'
            : (cur.n < J.levels.length ? '<p class="jr-ok">Все ворота открыты — можно переходить на уровень ' + (cur.n + 1) + '.</p>' : '<p class="jr-ok">Вы прошли весь путь!</p>')) +
          '<button type="button" class="btn-register jr-tracker" data-tracker="1">Обсудить с трекером-наставником</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------- игровое поле (SVG) ---------- */

  var POS = [
    [120, 120], [320, 120], [520, 120], [720, 120], [920, 120],
    [920, 320], [720, 320], [520, 320], [320, 320], [120, 320]
  ];

  function renderBoard() {
    var cur = currentLevel();
    var zones = [];
    J.worlds.forEach(function (w) {
      var idx = [];
      J.levels.forEach(function (l, i) { if (l.world === w.key) idx.push(i); });
      if (!idx.length) return;
      var xs = idx.map(function (i) { return POS[i][0]; });
      var y = POS[idx[0]][1];
      var x0 = Math.min.apply(null, xs) - 92, x1 = Math.max.apply(null, xs) + 92;
      zones.push('<g class="jr-zone jr-w--' + esc(w.color) + '"><rect x="' + x0 + '" y="' + (y - 92) + '" width="' + (x1 - x0) + '" height="184" rx="22"/>' +
        '<text x="' + (x0 + 16) + '" y="' + (y - 66) + '" class="jr-zone-title">' + esc(w.title) + '</text></g>');
    });

    var road = 'M 30 120 L 920 120 C 1050 120 1050 320 920 320 L 30 320';

    var nodes = J.levels.map(function (lv, i) {
      var x = POS[i][0], y = POS[i][1];
      var st = lv.n < cur ? 'done' : (lv.n === cur ? 'current' : 'future');
      var s = levelStats(lv);
      var r = 30, c = 2 * Math.PI * (r + 7);
      var ring = st === 'current'
        ? '<circle class="jr-ring-bg" cx="' + x + '" cy="' + y + '" r="' + (r + 7) + '"/>' +
          '<circle class="jr-ring" cx="' + x + '" cy="' + y + '" r="' + (r + 7) + '" stroke-dasharray="' + (c * s.pct / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 ' + x + ' ' + y + ')"/>'
        : '';
      var label = st === 'done' ? '✓' : String(lv.n);
      var pawn = st === 'current'
        ? '<g transform="translate(' + (x + 40) + ' ' + (y - 36) + ')"><g class="jr-pawn"><circle cx="0" cy="-6" r="9"/><path d="M-10 18 Q-8 2 0 2 Q8 2 10 18 Z"/></g></g>'
        : '';
      return '<g class="jr-node jr-node--' + st + (lv.n === selected ? ' is-selected' : '') + '" data-level="' + lv.n + '" tabindex="0" role="button" aria-label="Уровень ' + lv.n + ': ' + esc(lv.title) + '">' +
        ring +
        '<circle class="jr-dot" cx="' + x + '" cy="' + y + '" r="' + r + '"/>' +
        '<text class="jr-num" x="' + x + '" y="' + (y + 7) + '">' + label + '</text>' +
        '<text class="jr-label" x="' + x + '" y="' + (y + 60) + '">' + esc(lv.short || lv.title) + '</text>' +
        pawn + '</g>';
    }).join('');

    el('jrBoard').innerHTML =
      '<svg viewBox="0 0 1060 430" class="jr-svg" role="img" aria-label="Игровое поле пути стартапа: 10 уровней в 4 мирах">' +
        zones.join('') +
        '<path class="jr-road" d="' + road + '"/>' +
        '<path class="jr-road-dash" d="' + road + '"/>' +
        '<g class="jr-flag"><text x="30" y="96">Старт</text><circle cx="30" cy="120" r="7"/></g>' +
        '<g class="jr-flag"><text x="30" y="296">Компания</text><circle cx="30" cy="320" r="7"/></g>' +
        nodes +
      '</svg>';
  }

  /* ---------- карточка уровня ---------- */

  function renderDetail() {
    var lv = levelOf(selected);
    if (!lv) return;
    var w = worldOf(lv.world);
    var cur = currentLevel();
    var s = levelStats(lv);
    var allGates = lv.gates.every(gateDone);

    var quests = lv.quests.map(function (q) {
      var on = !!progress.quests[q.id];
      return '<li class="jr-check' + (on ? ' is-on' : '') + '"><label><input type="checkbox" data-quest="' + esc(q.id) + '"' + (on ? ' checked' : '') + '>' +
        '<span>' + esc(q.text) + '</span></label>' + toolHtml(q.tool) + '</li>';
    }).join('');

    var gates = lv.gates.map(function (g) {
      var manual = !!progress.gates[g.id];
      var a = autoCheck(g.auto);
      var on = manual || (a && a.ok);
      var badge = a ? '<span class="pill ' + (a.ok ? 'pill--ok' : 'pill--warn') + '" title="Автопроверка по данным «Рабочего стола стартапа»">' + esc(a.note) + '</span>' : '';
      return '<li class="jr-check' + (on ? ' is-on' : '') + '"><label><input type="checkbox" data-gate="' + esc(g.id) + '"' + (on ? ' checked' : '') + (a && a.ok && !manual ? ' disabled' : '') + '>' +
        '<span>' + esc(g.text) + '</span></label>' + badge + '</li>';
    }).join('');

    var action = '';
    if (lv.n === cur) {
      if (lv.n < J.levels.length) {
        action = '<button type="button" class="btn-primary jr-levelup" data-levelup="1"' + (allGates ? '' : ' disabled') + '>' +
          (allGates ? 'Перейти на уровень ' + (lv.n + 1) + ' →' : 'Откройте все ворота, чтобы перейти дальше') + '</button>';
      }
    } else {
      action = '<button type="button" class="btn-register" data-set-level="' + lv.n + '">Сделать текущим уровнем</button>';
    }

    var agents = (lv.agents || []).map(function (id) {
      return '<button type="button" class="jr-tool jr-tool--agent" data-agent="' + esc(id) + '">' + esc(agentNames[id] || id) + '</button>';
    }).join('');

    function list(items) {
      return '<ul class="jr-list">' + (items || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    }

    el('jrDetail').innerHTML =
      '<article class="jr-card jr-w--' + esc(w.color) + '">' +
        '<header class="jr-card-head">' +
          '<div><div class="jr-eyebrow">Мир «' + esc(w.title) + '» — ' + esc(w.subtitle) + '</div>' +
          '<h2>Уровень ' + lv.n + '. ' + esc(lv.title) + (lv.n < cur ? ' <span class="pill pill--ok">пройден</span>' : (lv.n === cur ? ' <span class="pill pill--done">вы здесь</span>' : '')) + '</h2>' +
          '<div class="jr-card-meta"><span>⏱ ' + esc(lv.duration) + '</span><span>' + esc(lv.readiness) + '</span><span>Выполнено ' + s.pct + ' %</span></div></div>' +
          '<div class="jr-card-nav">' +
            '<button type="button" class="dash-btn" data-go="' + (lv.n - 1) + '"' + (lv.n <= 1 ? ' disabled' : '') + '>← Уровень ' + (lv.n - 1 || '') + '</button>' +
            '<button type="button" class="dash-btn" data-go="' + (lv.n + 1) + '"' + (lv.n >= J.levels.length ? ' disabled' : '') + '>Уровень ' + (lv.n < J.levels.length ? lv.n + 1 : '') + ' →</button>' +
          '</div>' +
        '</header>' +
        '<div class="jr-card-grid">' +
          '<div>' +
            '<h3>Что происходит со стартапом</h3><p>' + esc(lv.what_happens) + '</p>' +
            '<h3>Цель уровня</h3><p><b>' + esc(lv.goal) + '</b></p>' +
            '<h3>Квесты: что делать</h3><ul class="jr-checks">' + quests + '</ul>' +
          '</div>' +
          '<div>' +
            '<div class="jr-gates"><h3>Ворота: критерии перехода на уровень ' + (lv.n < J.levels.length ? lv.n + 1 : '—') + '</h3>' +
              '<p class="jr-muted">Отметьте выполненные. Зелёная метка — критерий подтверждён данными «Рабочего стола стартапа».</p>' +
              '<ul class="jr-checks">' + gates + '</ul>' + action + '</div>' +
            '<h3>Артефакты на выходе</h3>' + list(lv.artifacts) +
            '<h3>Типичные ловушки</h3>' + list(lv.traps) +
            '<h3>Меры поддержки на этом уровне</h3>' + list(lv.support) +
            '<h3>ИИ-помощники</h3><div class="jr-agents">' + agents + '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /* ---------- история переходов ---------- */

  function renderHistory() {
    var box = el('jrHistory');
    if (!box) return;
    if (!progress.history.length) {
      box.innerHTML = '<p class="jr-muted">Здесь появятся даты переходов между уровнями — история роста вашего стартапа.</p>';
      return;
    }
    box.innerHTML = '<ol class="jr-history">' + progress.history.slice().reverse().map(function (h) {
      var lv = levelOf(h.level);
      return '<li><b>' + esc(h.date) + '</b> — уровень ' + h.level + (lv ? ' «' + esc(lv.title) + '»' : '') + (h.note ? ' · ' + esc(h.note) : '') + '</li>';
    }).join('') + '</ol>';
  }

  function renderAll() {
    renderStatus();
    renderBoard();
    renderDetail();
    renderHistory();
  }

  /* ---------- действия ---------- */

  function setLevel(n, note) {
    n = Math.max(1, Math.min(J.levels.length, n));
    /* ворота пройденных уровней считаем открытыми */
    J.levels.forEach(function (lv) {
      if (lv.n < n) lv.gates.forEach(function (g) { progress.gates[g.id] = true; });
    });
    progress.level = n;
    progress.history.push({ level: n, date: todayISO(), note: note || '' });
    selected = n;
    saveProgress();
    renderAll();
  }

  function toast(text) {
    var t = el('jrToast');
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3200);
  }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!J || !t || t.type !== 'checkbox') return;
    var q = t.getAttribute('data-quest'), g = t.getAttribute('data-gate');
    if (!q && !g) return;
    if (!progress.level) { progress.level = currentLevel(); progress.history.push({ level: progress.level, date: todayISO(), note: 'старт' }); }
    if (q) { if (t.checked) progress.quests[q] = true; else delete progress.quests[q]; }
    if (g) { if (t.checked) progress.gates[g] = true; else delete progress.gates[g]; }
    saveProgress();
    if (t.checked) toast('+' + (q ? XP_QUEST : XP_GATE) + ' XP');
    renderAll();
  });

  document.addEventListener('click', function (e) {
    if (!J) return;
    var node = e.target.closest('.jr-node');
    if (node) { selected = Number(node.getAttribute('data-level')); renderBoard(); renderDetail(); return; }
    var b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-go')) {
      selected = Number(b.getAttribute('data-go'));
      renderBoard(); renderDetail();
    } else if (b.hasAttribute('data-set-level')) {
      setLevel(Number(b.getAttribute('data-set-level')), 'уровень выбран командой');
    } else if (b.hasAttribute('data-levelup')) {
      var from = currentLevel();
      setLevel(from + 1, 'ворота уровня ' + from + ' открыты');
      toast('Уровень ' + from + ' пройден! +' + XP_LEVEL + ' XP');
    } else if (b.hasAttribute('data-agent')) {
      launchAgent(b.getAttribute('data-agent'));
    } else if (b.hasAttribute('data-tracker')) {
      launchAgent('startup-tracker', trackerPrompt());
    } else if (b.hasAttribute('data-open-diag')) {
      openDiag();
    }
  });

  document.addEventListener('keydown', function (e) {
    var node = e.target && e.target.closest && e.target.closest('.jr-node');
    if (node && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selected = Number(node.getAttribute('data-level'));
      renderBoard(); renderDetail();
    }
  });

  /* ---------- самооценка «Где мы сейчас?» ---------- */

  function openDiag() {
    var dlg = el('jrDiag');
    var body = el('jrDiagBody');
    if (!dlg || !body) return;
    body.innerHTML = '<h2>Где мы сейчас?</h2><p class="jr-muted">Ответьте честно — это определит ваш уровень. Первый ответ «нет» и есть уровень, на котором стоит работать.</p>' +
      '<ol class="jr-diag">' + J.diagnostic.map(function (d, i) {
        return '<li><span>' + esc(d.q) + '</span><span class="jr-diag-opts">' +
          '<label><input type="radio" name="d' + i + '" value="1" required> Да</label>' +
          '<label><input type="radio" name="d' + i + '" value="0"> Нет</label></span></li>';
      }).join('') + '</ol>' +
      '<div class="jr-diag-actions"><button type="submit" class="btn-primary" value="ok">Определить уровень</button>' +
      '<button type="button" class="btn-register" id="jrDiagCancel">Отмена</button></div>';
    el('jrDiagCancel').onclick = function () { dlg.close(); };
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  var diagForm = el('jrDiagBody');
  if (diagForm) {
    diagForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var level = J.levels.length;
      for (var i = 0; i < J.diagnostic.length; i++) {
        var v = diagForm.querySelector('input[name="d' + i + '"]:checked');
        if (!v || v.value === '0') { level = J.diagnostic[i].level; break; }
      }
      el('jrDiag').close();
      setLevel(level, 'по самооценке');
      toast('Ваш уровень — ' + level + ': «' + levelOf(level).title + '»');
    });
  }

  var btnDiag = el('jrDiagOpen');
  if (btnDiag) btnDiag.addEventListener('click', openDiag);

  var btnReset = el('jrReset');
  if (btnReset) {
    btnReset.addEventListener('click', function () {
      if (!confirm('Сбросить прогресс команды на пути стартапа в этом браузере?')) return;
      progress = { level: 0, quests: {}, gates: {}, history: [] };
      saveProgress();
      selected = 1;
      renderAll();
    });
  }

  /* ---------- загрузка ---------- */

  function loadDash() {
    try {
      var raw = localStorage.getItem(DASH_LOCAL);
      if (raw) return Promise.resolve(JSON.parse(raw));
    } catch (e) { /* свои данные повреждены — берём демо */ }
    return fetchJSON(DASH_URL).catch(function () { return null; });
  }

  Promise.all([
    fetchJSON(DATA_URL),
    loadDash(),
    fetchJSON('/data/skills.json').catch(function () { return { items: [] }; })
  ]).then(function (res) {
    J = res[0];
    dash = res[1];
    (res[2].items || []).forEach(function (s) { agentNames[s.id] = s.name; });
    progress = loadProgress();
    selected = currentLevel();
    var src = el('jrSource');
    if (src) {
      src.textContent = dash
        ? 'Автопроверка ворот — по данным «Рабочего стола стартапа»' + (dash.startup ? ': ' + dash.startup : '') + '.'
        : 'Данные «Рабочего стола стартапа» не загрузились — ворота отмечайте вручную.';
    }
    renderAll();
  }).catch(function () {
    el('jrStatus').innerHTML = '<p class="jr-muted">Не удалось загрузить карту пути (data/startup-journey.json). Запустите платформу через сервер (см. README).</p>';
  });

  /* смена пользователя — свой прогресс */
  window.addEventListener('aios-auth-change', function () {
    if (!J) return;
    progress = loadProgress();
    selected = currentLevel();
    renderAll();
  });
})();
