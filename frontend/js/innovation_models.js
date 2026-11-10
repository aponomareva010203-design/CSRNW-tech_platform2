/* ============================================================
   «Модели стартапа» (models.html, блок #gridBuiltin).

   Прозрачные расчётные модели для команды стартапа — считаются в
   браузере, без LLM и без песочницы:
     - unit-economics — юнит-экономика: ARPA, маржа, LTV, CAC, LTV/CAC,
       срок окупаемости CAC, вердикт и главный рычаг;
     - market-size    — размер рынка TAM / SAM / SOM «снизу вверх»
       (число клиентов × чек × доли);
     - runway         — на сколько месяцев хватит денег при росте
       выручки и расходов, месяц выхода в плюс;
     - irl-score      — уровень инвестиционной готовности стартапа
       (IRL 1–9) по чек-листу и рекомендуемая мера поддержки.

   Все суммы — тыс. ₽. Ориентиры (LTV/CAC ≥ 3, окупаемость ≤ 12 мес.)
   — общепринятые эвристики венчурной индустрии, а не закон: обсуждайте
   их с трекером. Модели доступны и другим страницам как
   window.AIOS_INNOVATION_MODELS.
   ============================================================ */

(function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function n(v, d) { var x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? d : x; }
  function fmt(v, digits) {
    return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: digits == null ? 1 : digits });
  }
  function money(th) {
    var a = Math.abs(th);
    if (a >= 1000000) return fmt(th / 1000000, 2) + ' млрд ₽';
    if (a >= 1000) return fmt(th / 1000, 2) + ' млн ₽';
    return fmt(th, 1) + ' тыс. ₽';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 1. Юнит-экономика ---------- */

  function unitEconomics(x) {
    var price = Math.max(0, n(x.price, 4.5));          // цена единицы в месяц, тыс. ₽
    var units = Math.max(0, n(x.units, 40));           // единиц на клиента
    var cogs = Math.max(0, n(x.cogs, 1.7));            // себестоимость единицы в месяц, тыс. ₽
    var cac = Math.max(0, n(x.cac, 380));
    var life = Math.max(0, n(x.life, 36));             // срок жизни клиента, мес.
    var arpa = price * units;
    var margin = (price - cogs) * units;
    var ltv = margin * life;
    var ratio = cac > 0 ? ltv / cac : Infinity;
    var payback = margin > 0 ? cac / margin : Infinity;
    /* какой рычаг сильнее: +10 % к каждому фактору */
    var levers = [
      ['Цена +10 %', ((price * 1.1 - cogs) * units * life) / cac],
      ['Себестоимость −10 %', ((price - cogs * 0.9) * units * life) / cac],
      ['CAC −10 %', ltv / (cac * 0.9)],
      ['Срок жизни клиента +10 %', margin * life * 1.1 / cac],
      ['Единиц на клиента +10 %', (price - cogs) * units * 1.1 * life / cac]
    ].map(function (l) { return [l[0], l[1] - ratio]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    return { arpa: arpa, margin: margin, gm: arpa ? margin / arpa : 0, ltv: ltv, cac: cac, ratio: ratio, payback: payback, levers: levers };
  }

  /* ---------- 2. Размер рынка ---------- */

  function marketSize(x) {
    var clients = Math.max(0, n(x.clients, 6600));     // всех потенциальных клиентов
    var check = Math.max(0, n(x.check, 900));          // средний чек в год, тыс. ₽
    var samShare = clamp(n(x.sam_share, 40), 0, 100) / 100;  // доля, доступная нашему продукту и каналу
    var somShare = clamp(n(x.som_share, 2), 0, 100) / 100;   // доля SAM, реальная за 3 года
    var tam = clients * check;
    var sam = tam * samShare;
    var som = sam * somShare;
    var somClients = clients * samShare * somShare;
    return { tam: tam, sam: sam, som: som, somClients: somClients };
  }

  /* ---------- 3. Runway ---------- */

  function runway(x) {
    var cash = Math.max(0, n(x.cash, 4200));
    var costs = Math.max(0, n(x.costs, 650));
    var costGrowth = n(x.cost_growth, 2) / 100;
    var revenue = Math.max(0, n(x.revenue, 180));
    var revGrowth = n(x.rev_growth, 12) / 100;
    var gm = clamp(n(x.gm, 62), -100, 100) / 100;
    var inflow = Math.max(0, n(x.inflow, 0));
    var inflowMonth = Math.round(n(x.inflow_month, 0));
    var flows = [];
    var left = cash, zero = null, breakeven = null;
    for (var m = 1; m <= 36; m++) {
      var net = revenue * gm - costs + (inflow && m === inflowMonth ? inflow : 0);
      left += net;
      flows.push(left);
      if (breakeven === null && revenue * gm >= costs) breakeven = m;
      if (zero === null && left < 0) zero = m;
      revenue *= 1 + revGrowth;
      costs *= 1 + costGrowth;
    }
    return { flows: flows, zero: zero, breakeven: breakeven };
  }

  /* ---------- 4. Инвестиционная готовность (IRL) ---------- */

  var IRL_ITEMS = [
    ['team', 'Сформирована команда (CEO + CTO)', 1],
    ['segment', 'Описан сегмент клиентов и проблема', 1],
    ['interviews', 'Проведено 20+ проблемных интервью', 1],
    ['mvp', 'Есть MVP или прототип', 1],
    ['pilot', 'Есть пилот / письма о намерениях (LOI)', 1],
    ['model', 'Посчитана бизнес-модель и юнит-экономика', 1],
    ['sales', 'Есть первые продажи', 1],
    ['repeat', 'Повторные продажи, CAC < LTV', 1],
    ['ip', 'Права на технологию оформлены на компанию (лицензия вуза)', 0.5],
    ['company', 'Зарегистрировано юрлицо', 0.5],
    ['docs', 'Готовы питч-дек, финмодель, cap table', 1]
  ];
  var IRL_MEASURES = [
    [2, 'Предакселератор вуза, «Студенческий стартап» / «УМНИК» Фонда содействия инновациям'],
    [4, 'Акселератор или стартап-студия: трек CustDev и MVP; «Студенческий стартап» для студенческих команд'],
    [6, '«Старт» Фонда содействия инновациям, пилот с индустриальным партнёром'],
    [8, 'Посевные фонды, бизнес-ангелы, корпоративные акселераторы'],
    [9, 'Венчурные фонды, «Развитие» / «Коммерциализация» Фонда содействия инновациям']
  ];

  function irlScore(x) {
    // уровень = число последовательно выполненных шагов лестницы (как в шкале IRL),
    // юрлицо и права на технологию — поправки +0,5
    var ladder = ['team', 'segment', 'interviews', 'mvp', 'pilot', 'model', 'sales', 'repeat', 'docs'];
    var level = 0;
    for (var i = 0; i < ladder.length; i++) {
      if (x[ladder[i]]) level = i + 1; else break;
    }
    var bonus = (x.ip ? 0.5 : 0) + (x.company ? 0.5 : 0);
    var gaps = IRL_ITEMS.filter(function (it) { return !x[it[0]]; }).map(function (it) { return it[1]; });
    var irl = clamp(Math.round(level + (level >= 5 ? bonus : 0)), 1, 9);
    var measure = IRL_MEASURES.filter(function (m) { return irl <= m[0]; })[0] || IRL_MEASURES[IRL_MEASURES.length - 1];
    return { irl: irl, measure: measure[1], gaps: gaps.slice(0, 4) };
  }

  window.AIOS_INNOVATION_MODELS = { unitEconomics: unitEconomics, marketSize: marketSize, runway: runway, irlScore: irlScore };

  /* ---------- описания форм ---------- */

  function bars(values, title) {
    var max = Math.max.apply(null, values.map(function (f) { return Math.abs(f); }).concat([0.001]));
    return '<div class="imdl-bars" aria-label="' + esc(title) + '">' + values.map(function (f, i) {
      var h = Math.round(Math.abs(f) / max * 56);
      return '<span class="imdl-bar' + (f < 0 ? ' imdl-bar--neg' : '') + '" style="height:' + Math.max(2, h) +
        'px" title="Месяц ' + (i + 1) + ': ' + esc(money(f)) + '"></span>';
    }).join('') + '</div>';
  }

  function rows(list) {
    return '<table class="imdl-parts"><tbody>' + list.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td><b>' + esc(r[1]) + '</b></td></tr>';
    }).join('') + '</tbody></table>';
  }

  var MODELS = [
    {
      id: 'unit-economics',
      name: 'Юнит-экономика',
      kind: 'экономика',
      out: 'LTV, CAC, LTV/CAC, окупаемость клиента',
      desc: 'Зарабатываем ли мы на одном клиенте: маржа с клиента, пожизненная ценность (LTV), стоимость привлечения (CAC) и какой рычаг улучшит экономику сильнее всего. Суммы — тыс. ₽.',
      fields: [
        ['price', 'Цена единицы в месяц, тыс. ₽', 'number', 4.5],
        ['units', 'Единиц на клиента (агрегатов, мест, лицензий)', 'number', 40],
        ['cogs', 'Себестоимость единицы в месяц, тыс. ₽', 'number', 1.7],
        ['cac', 'CAC — затраты на привлечение одного клиента, тыс. ₽', 'number', 380],
        ['life', 'Срок жизни клиента, мес.', 'number', 36]
      ],
      render: function (x) {
        var r = unitEconomics(x);
        var verdict = r.ratio >= 3 && r.payback <= 12
          ? 'Экономика сходится: можно вкладываться в привлечение клиентов. Убедитесь, что срок жизни и CAC — факт, а не гипотеза.'
          : r.ratio >= 1
            ? 'Клиент окупается, но медленно или с малым запасом. Начните с самого сильного рычага из списка ниже.'
            : 'Каждый новый клиент приносит убыток: масштабировать продажи рано — пересмотрите цену, себестоимость или канал.';
        return '<div class="imdl-result"><b>' + (isFinite(r.ratio) ? fmt(r.ratio, 1) : '∞') + '</b><span>LTV / CAC (ориентир ≥ 3)</span></div>' +
          '<p class="imdl-verdict">' + esc(verdict) + '</p>' +
          rows([
            ['Выручка с клиента в месяц (ARPA)', money(r.arpa)],
            ['Маржа с клиента в месяц', money(r.margin) + ' (' + fmt(r.gm * 100, 0) + ' %)'],
            ['LTV', money(r.ltv)],
            ['CAC', money(r.cac)],
            ['Окупаемость CAC', isFinite(r.payback) ? fmt(r.payback, 1) + ' мес. (ориентир ≤ 12)' : 'не окупается']
          ]) +
          '<p class="imdl-verdict"><b>Рычаги (+10 % к фактору → изменение LTV/CAC):</b> ' +
          esc(r.levers.slice(0, 3).map(function (l) { return l[0] + ' (' + (l[1] >= 0 ? '+' : '') + fmt(l[1], 2) + ')'; }).join('; ')) + '</p>';
      }
    },
    {
      id: 'market-size',
      name: 'Размер рынка TAM / SAM / SOM',
      kind: 'рынок',
      out: 'TAM, SAM, SOM и число клиентов в SOM',
      desc: 'Оценка «снизу вверх»: число потенциальных клиентов × средний чек в год, затем доля, доступная вашему продукту и каналу (SAM), и реалистичная доля за 3 года (SOM). Суммы — тыс. ₽.',
      fields: [
        ['clients', 'Потенциальных клиентов всего (компаний или людей)', 'number', 6600],
        ['check', 'Средний чек клиента в год, тыс. ₽', 'number', 900],
        ['sam_share', 'Доля, доступная нашему продукту и каналу (SAM), %', 'number', 40],
        ['som_share', 'Доля SAM, реально достижимая за 3 года (SOM), %', 'number', 2]
      ],
      render: function (x) {
        var r = marketSize(x);
        var max = r.tam || 1;
        var bar = function (label, v, cls) {
          var w = v > 0 ? Math.max(3, Math.log10(1 + v) / Math.log10(1 + max) * 100) : 0;
          return '<div class="mkt-row"><div class="mkt-label"><b>' + label + '</b><span>' + esc(money(v)) + ' в год</span></div>' +
            '<div class="mkt-track"><span class="mkt-bar mkt-bar--' + cls + '" style="width:' + w + '%"></span></div></div>';
        };
        return '<div class="imdl-result"><b>' + esc(money(r.som)) + '</b><span>SOM — ' + fmt(r.somClients, 0) + ' клиентов за 3 года</span></div>' +
          '<div class="mkt">' + bar('TAM', r.tam, 'tam') + bar('SAM', r.sam, 'sam') + bar('SOM', r.som, 'som') + '</div>' +
          '<p class="imdl-verdict">Проверьте каждое допущение: число клиентов — по Росстату, реестрам ФНС или отраслевым ассоциациям; чек — по интервью и ценам альтернатив; долю SOM — по силам вашей команды продаж. Длина полос — логарифмическая шкала.</p>';
      }
    },
    {
      id: 'runway',
      name: 'Runway: на сколько хватит денег',
      kind: 'финансы',
      out: 'Месяц кассового разрыва и выхода в плюс',
      desc: 'Помесячный прогноз остатка денег на 36 месяцев: выручка растёт, расходы растут, грант или инвестиции приходят в заданный месяц. Суммы — тыс. ₽.',
      fields: [
        ['cash', 'Деньги на счёте сейчас, тыс. ₽', 'number', 4200],
        ['costs', 'Расходы в месяц сейчас, тыс. ₽', 'number', 650],
        ['cost_growth', 'Рост расходов, % в месяц', 'number', 2],
        ['revenue', 'Выручка в месяц сейчас, тыс. ₽', 'number', 180],
        ['rev_growth', 'Рост выручки, % в месяц', 'number', 12],
        ['gm', 'Валовая маржа, %', 'number', 62],
        ['inflow', 'Грант или инвестиции, тыс. ₽ (0 — нет)', 'number', 0],
        ['inflow_month', 'Месяц поступления', 'number', 7]
      ],
      render: function (x) {
        var r = runway(x);
        var head = r.zero
          ? '<div class="imdl-result"><b>' + r.zero + ' мес.</b><span>до кассового разрыва</span></div>'
          : '<div class="imdl-result"><b>36+ мес.</b><span>деньги не заканчиваются</span></div>';
        var verdict = r.zero
          ? (r.zero <= 6 ? 'Меньше полугода: начинайте привлечение денег прямо сейчас и сокращайте расходы.' : 'Начинайте привлечение за 6 месяцев до кассового разрыва — раунд или грант обычно занимает 3–6 месяцев.')
          : 'При этих допущениях запас есть. Проверьте, что рост выручки опирается на воронку продаж, а не на надежду.';
        return head + bars(r.flows, 'Остаток денег по месяцам') +
          '<p class="imdl-verdict">' + esc(verdict) + ' ' + (r.breakeven ? 'Валовая прибыль покроет расходы на ' + r.breakeven + '-м месяце.' : 'В горизонте 36 месяцев валовая прибыль не покрывает расходы.') + '</p>';
      }
    },
    {
      id: 'irl-score',
      name: 'Инвестиционная готовность стартапа (IRL)',
      kind: 'финансирование',
      out: 'IRL 1–9 и следующая мера поддержки',
      desc: 'Лестница IRL из методики стартап-студии: уровень растёт, только если пройдены все предыдущие шаги. Подсказывает, какая поддержка подходит сейчас.',
      fields: IRL_ITEMS.map(function (it, i) { return [it[0], it[1], 'bool', i < 3]; }),
      render: function (x) {
        var r = irlScore(x);
        return '<div class="imdl-result"><b>IRL ' + r.irl + '</b><span>уровень инвестиционной готовности</span></div>' +
          '<p class="imdl-verdict"><b>Куда идти сейчас:</b> ' + esc(r.measure) + '</p>' +
          (r.gaps.length ? '<p class="imdl-verdict"><b>Чего не хватает:</b> ' + esc(r.gaps.join('; ')) + '</p>' : '');
      }
    }
  ];

  function partsTable(parts) {
    var rows = parts.filter(function (p) { return Math.abs(p[1]) > 1e-9; }).map(function (p) {
      var w = Math.min(100, Math.round(Math.abs(p[1]) / 1.5 * 100));
      return '<tr><td>' + esc(p[0]) + '</td><td class="imdl-contrib"><span class="imdl-contrib-bar' +
        (p[1] < 0 ? ' imdl-contrib-bar--neg' : '') + '" style="width:' + w + '%"></span>' +
        (p[1] > 0 ? '+' : '') + fmt(p[1], 2) + '</td></tr>';
    }).join('');
    return '<table class="imdl-parts"><thead><tr><th>Фактор</th><th>Вклад в логит</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---------- UI ---------- */

  var grid = document.getElementById('gridBuiltin');
  if (!grid) return;

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16"/><path d="M6 16l4-5 3 3 5-7"/><circle cx="18" cy="7" r="1.4"/></svg>';

  MODELS.forEach(function (m) {
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'mdl-card imdl-card';
    card.innerHTML =
      '<span class="mdl-card-top"><span class="mdl-kind">' + ICON + esc(m.kind) + '</span>' +
      '<span class="mdl-status mdl-status--published">встроенная</span></span>' +
      '<span class="mdl-card-name">' + esc(m.name) + '</span>' +
      '<span class="mdl-card-out">' + esc(m.desc) + '</span>' +
      '<span class="mdl-card-foot">Результат: ' + esc(m.out) + '</span>';
    card.addEventListener('click', function () { open(m); });
    grid.appendChild(card);
  });

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="modal imdl-modal" role="dialog" aria-modal="true" aria-labelledby="imdlTitle">' +
      '<button class="modal-close" type="button" aria-label="Закрыть">✕</button>' +
      '<h2 id="imdlTitle"></h2><p class="mdl-import-note imdl-desc"></p>' +
      '<div class="imdl-body"><form class="mdl-form imdl-form"></form><div class="imdl-out" aria-live="polite"></div></div>' +
    '</div>';
  document.body.appendChild(overlay);
  var form = overlay.querySelector('.imdl-form');
  var out = overlay.querySelector('.imdl-out');
  var current = null;

  function close() { overlay.hidden = true; document.body.style.overflow = ''; }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !overlay.hidden) close(); });

  function values() {
    var x = {};
    current.fields.forEach(function (f) {
      var el = form.elements[f[0]];
      x[f[0]] = f[2] === 'bool' ? el.checked : el.value;
    });
    return x;
  }
  function recalc() { if (current) out.innerHTML = current.render(values()); }
  form.addEventListener('input', recalc);
  form.addEventListener('submit', function (e) { e.preventDefault(); recalc(); });

  function open(m) {
    current = m;
    overlay.querySelector('#imdlTitle').textContent = m.name;
    overlay.querySelector('.imdl-desc').textContent = m.desc;
    form.innerHTML = m.fields.map(function (f) {
      if (f[2] === 'bool') {
        return '<label class="imdl-check"><input type="checkbox" name="' + f[0] + '"' + (f[3] ? ' checked' : '') + '> ' + esc(f[1]) + '</label>';
      }
      return '<label class="mdl-field"><span>' + esc(f[1]) + '</span><input type="number" step="any" name="' + f[0] + '" value="' + f[3] + '"></label>';
    }).join('');
    recalc();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }
})();
