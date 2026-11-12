/* Сворачиваемые разделы левого меню («Дашборды», «Каталоги»).
   Подключается сразу после <aside>, чтобы применить сохранённое
   состояние до первой отрисовки — меню не мигает раскрытым.
   Раздел с активным пунктом всегда раскрывается при загрузке,
   иначе текущая страница оказалась бы спрятана. */
/* Аккаунт компании-заказчика видит только функционал заказчика.
   Класс aios-company на <html> прячет в меню инструменты команды стартапа
   (css/style.css, раздел «Режим компании-заказчика»), а со страниц
   стартапа компания уводится в «Кабинет заказчика». Сервер те же
   инструменты для компании закрывает отдельно (403). auth.js
   переключает класс при входе, выходе и смене режима. */
(function () {
  var COMPANY_PAGES = ['company.html', 'challenges.html', 'chat.html', 'settings.html', 'admin.html', 'privacy-policy.html'];
  var s = null;
  try { s = JSON.parse(localStorage.getItem('aios-auth-v1') || 'null'); } catch (e) { s = null; }
  var company = !!(s && s.token && s.account_type === 'company');
  document.documentElement.classList.toggle('aios-company', company);
  if (!company) return;
  var page = location.pathname.split('/').pop() || 'index.html';
  if (COMPANY_PAGES.indexOf(page) === -1) {
    location.replace('company.html');
    return;
  }
  var logo = document.querySelector('.sidebar .wordmark');
  if (logo) logo.setAttribute('href', 'company.html');
})();

(function () {
  var KEY = 'aios-side-groups-v1';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }

  document.querySelectorAll('.side-group--collapsible').forEach(function (group) {
    var name = group.getAttribute('data-side-group');
    var toggle = group.querySelector('.side-group-toggle');
    if (!name || !toggle) return;

    function apply(collapsed) {
      group.classList.toggle('side-group--collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    apply(!!state[name] && !group.querySelector('.side-link.active'));

    toggle.addEventListener('click', function () {
      var collapsed = !group.classList.contains('side-group--collapsed');
      state[name] = collapsed;
      apply(collapsed);
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    });
  });
})();
