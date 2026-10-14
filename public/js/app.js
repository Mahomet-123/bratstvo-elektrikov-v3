// app.js — точка входа: тема, service worker, маршрутизация, оболочка.
(function () {
  'use strict';

  /* ---------- Тема ---------- */
  function applyTheme() { document.documentElement.setAttribute('data-theme', Store.getTheme()); }
  applyTheme();
  U.$('#themeBtn').addEventListener('click', function () {
    var order = ['auto', 'light', 'dark'];
    var next = order[(order.indexOf(Store.getTheme()) + 1) % order.length];
    Store.setTheme(next); applyTheme();
    U.toast('Тема: ' + ({ auto: 'системная', light: 'светлая', dark: 'тёмная' }[next]));
  });

  /* ---------- Service Worker ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  /* ---------- Offline badge ---------- */
  if (window.Offline) Offline.updateBadge();

  /* ---------- Оболочка (appbar / tabbar) ---------- */
  var appTitle = U.$('#appTitle');
  var tabbar = U.$('#tabbar');
  var logoutBtn = U.$('#logoutBtn');
  var backBtn = U.$('#appBack');
  var navAdmin = U.$('#navAdmin');

  function showChrome(on) {
    tabbar.hidden = !on;
    logoutBtn.hidden = !on;
    navAdmin.hidden = !(on && Store.isAdmin());
    if (!on) backBtn.hidden = true;
  }
  function setBack(on) { backBtn.hidden = !on; }
  function setTitle(t) { appTitle.textContent = t; }

  function updateTabbar(path) {
    U.$$('.tabbar__btn[data-go]').forEach(function (b) {
      var go = b.getAttribute('data-go').replace(/^#/, '');
      var active = (go === '/objects' && path.indexOf('/object') === 0) || path.indexOf(go) === 0;
      b.classList.toggle('tabbar__btn--active', active);
    });
  }

  backBtn.addEventListener('click', function () {
    var p = (location.hash.replace(/^#/, '') || '/');
    if (p.indexOf('/object/') === 0 || p === '/admin' || p === '/profile') Router.go('#/objects');
    else history.back();
  });

  logoutBtn.addEventListener('click', function () { Store.logout(); Router.go('#/login'); });
  U.$('#navAdd').addEventListener('click', function () {
    if (Store.isAuthed()) Objects.showCreate(); else Router.go('#/login');
  });
  U.$$('.tabbar__btn[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { Router.go(b.getAttribute('data-go')); });
  });

  /* ---------- Маршруты ---------- */
  function requireAuth(cb) {
    if (Store.isAuthed()) cb(); else Router.go('#/login');
  }

  Router.add(/^\/$/, function () { Router.go(Store.isAuthed() ? '#/objects' : '#/login'); });
  Router.add(/^\/login$/, function () {
    showChrome(false); setBack(false); setTitle('Братство Электриков'); Auth.render();
  });
  Router.add(/^\/objects$/, function () {
    requireAuth(function () {
      showChrome(true); setBack(false); setTitle(Store.isAdmin() ? 'Объекты · Руководитель' : 'Объекты');
      updateTabbar('/objects'); Objects.render();
    });
  });
  Router.add(/^\/object\/(\d+)$/, function (id) {
    requireAuth(function () {
      showChrome(true); setBack(true); setTitle('Объект #' + id); updateTabbar('/object/' + id);
      ObjectCard.render(id);
    });
  });
  Router.add(/^\/admin$/, function () {
    requireAuth(function () {
      if (!Store.isAdmin()) { Router.go('#/objects'); return; }
      showChrome(true); setBack(true); setTitle('Панель руководителя'); updateTabbar('/admin'); Admin.render();
    });
  });
  Router.add(/^\/profile$/, function () {
    requireAuth(function () {
      showChrome(true); setBack(true); setTitle('Профиль'); updateTabbar('/profile'); Profile.render();
    });
  });
  Router.add(/^\/cabinet\/([A-Za-z0-9]+)$/, function (token) {
    showChrome(false); setBack(false); setTitle('Кабинет клиента'); Cabinet.render(token);
  });

  Router.start();
})();
