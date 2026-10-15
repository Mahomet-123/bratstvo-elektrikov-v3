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
  var syncBtn = U.$('#syncBtn');

  function showChrome(on) {
    tabbar.hidden = !on;
    logoutBtn.hidden = !on;
    syncBtn.hidden = !on;
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

  /* ---------- Кнопка синхронизации (пункт 2) ---------- */
  /* Загружает ВСЕ данные одним пакетом: прайс, список объектов, все карточки.
     Сохраняет в кеш на устройстве. Переходы по вкладкам — только из кеша. */
  function syncAll() {
    var tasks = [];
    // 1. Прайс-лист
    tasks.push(apiGet('prices', null, { silent: true }).then(function (d) {
      if (d && d.ok) { Store.setPrices(d.prices || []); return d.prices.length; }
      return 0;
    }).catch(function () { return 0; }));
    // 2. Список объектов
    tasks.push(apiGet('objects', { token: Store.getToken() }, { silent: true }).then(function (d) {
      if (d && d.ok) {
        var objs = d.objects || [];
        Store.setObjectsCache(objs);
        // 3. Все карточки объектов — параллельно
        objs.forEach(function (o) {
          tasks.push(apiGet('object', { token: Store.getToken(), id: String(o.id) }, { silent: true }).then(function (od) {
            if (od && od.ok) { Store.setObjectCache(String(o.id), od); }
            return 1;
          }).catch(function () { return 0; }));
        });
        return objs.length;
      }
      return 0;
    }).catch(function () { return 0; }));

    return Promise.all(tasks);
  }

  function refreshCurrent() {
    var p = (location.hash.replace(/^#/, '') || '/');
    var m;
    if ((m = p.match(/^\/object\/(\d+)$/))) ObjectCard.render(m[1], true);
    else if (p === '/objects') Objects.render(true);
    else if (p === '/admin') Admin.render();
    else if (p === '/profile') Profile.render();
  }
  syncBtn.addEventListener('click', function () {
    syncBtn.classList.add('spin');
    var done = function () { setTimeout(function () { syncBtn.classList.remove('spin'); }, 500); };
    if (window.Offline) {
      Offline.flush().then(function (n) {
        if (n > 0) U.toast('Отправлено в таблицу: ' + n, 'success');
        // Пакетная загрузка всех данных с сервера
        syncAll().then(function () {
          U.toast('Данные синхронизированы', 'success');
          refreshCurrent();
        }).catch(function () { refreshCurrent(); }).then(done);
      }).catch(function () { refreshCurrent(); done(); });
    } else { refreshCurrent(); done(); }
  });

  /* ---------- Индикатор очереди/синхронизации ---------- */
  function updateSyncIndicator() {
    if (!window.Offline) return;
    Offline.count().then(function (n) {
      if (n > 0) { syncBtn.classList.add('iconbtn--pending'); syncBtn.title = 'Есть неотправленные (' + n + '). Нажмите для синхронизации'; }
      else { syncBtn.classList.remove('iconbtn--pending'); syncBtn.title = 'Синхронизировать'; }
    });
  }
  window.addEventListener('be:sync', updateSyncIndicator);
  window.addEventListener('online', updateSyncIndicator);
  window.addEventListener('offline', updateSyncIndicator);
  updateSyncIndicator();

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
      updateTabbar('/objects'); Objects.render(false);
    });
  });
  Router.add(/^\/object\/(\d+)$/, function (id) {
    requireAuth(function () {
      showChrome(true); setBack(true); setTitle('Объект #' + id); updateTabbar('/object/' + id);
      ObjectCard.render(id, false);
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
