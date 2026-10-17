// admin.js — панель руководителя: отчёт, аналитика, архив, пользователи.
// Офлайн-first: сначала рисуем из локального кеша (Store), параллельно
// фоновая синхронизация с GAS обновляет кеш и перерисовывает активную
// вкладку. На мутации (users:save) оптимистично правим кеш, затем bgSync.
window.Admin = (function () {

  var TABS = [
    { key: 'report', label: 'Сводка' },
    { key: 'analytics', label: 'Аналитика' },
    { key: 'archive', label: 'Архив' },
    { key: 'users', label: 'Люди' }
  ];

  // Состояние оболочки админки (переживает только текущий рендер).
  var ADMIN = { app: null, content: null, active: 'report', data: null, refreshing: false, refreshBtn: null };

  function readCache() {
    return {
      report: Store.getReportCache(),
      analytics: Store.getAnalyticsCache(),
      archive: Store.getArchiveCache(),
      users: Store.getUsersCache()
    };
  }

  function setCacheKey(key, d) {
    if (key === 'report') Store.setReportCache(d);
    else if (key === 'analytics') Store.setAnalyticsCache(d);
    else if (key === 'archive') Store.setArchiveCache(d);
    else if (key === 'users') Store.setUsersCache(d);
  }

  function fetchOne(action, key, token) {
    // Тихий GET (без тостов об ошибке). Кладёт валидный ответ в кеш.
    return apiGet(action, { token: token }, { silent: true })
      .then(function (d) { if (d && d.ok) { setCacheKey(key, d); } return d && d.ok; })
      .catch(function () { return false; });
  }

  function render() {
    var app = U.$('#app');
    ADMIN.app = app;
    ADMIN.active = 'report';
    ADMIN.refreshing = false; // сбросить «в полёте» от прошлого входа в админку
    U.clear(app);

    buildShell(app);
    ADMIN.data = readCache();
    var hasData = !!(ADMIN.data.report && ADMIN.data.report.ok);
    if (hasData) {
      renderActive();
    } else {
      U.loading(ADMIN.content, 'Загрузка…');
    }
    bgSync(!hasData);
  }

  function buildShell(app) {
    ADMIN.refreshBtn = U.el('button', {
      class: 'btn btn--sm', type: 'button',
      'aria-label': 'Обновить с сервера', title: 'Обновить с сервера',
      text: '↻', style: { minWidth: '40px' },
      onclick: manualRefresh
    });
    app.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('div', { class: 'section-head__title', text: 'Панель руководителя' }),
      ADMIN.refreshBtn
    ]));
    var tabsBar = U.el('div', { class: 'tabs' });
    TABS.forEach(function (t) {
      var btn = U.el('button', {
        class: 'tabs__btn', type: 'button', text: t.label,
        'data-key': t.key,
        onclick: function () { ADMIN.active = t.key; updateTabsActive(); renderActive(); }
      });
      tabsBar.appendChild(btn);
    });
    app.appendChild(tabsBar);
    ADMIN.content = U.el('div');
    app.appendChild(ADMIN.content);
    updateTabsActive();
  }

  function updateTabsActive() {
    if (!ADMIN.app) return;
    var btns = ADMIN.app.querySelectorAll('.tabs__btn');
    Array.prototype.forEach.call(btns, function (b) {
      b.classList.toggle('tabs__btn--active', b.getAttribute('data-key') === ADMIN.active);
    });
  }

  function renderActive() {
    if (!ADMIN.content) return;
    U.clear(ADMIN.content);
    var d = ADMIN.data || {};
    if (ADMIN.active === 'report') renderReport(ADMIN.content, d.report);
    else if (ADMIN.active === 'analytics') renderAnalytics(ADMIN.content, d.analytics);
    else if (ADMIN.active === 'archive') renderArchive(ADMIN.content, d.archive);
    else renderUsers(ADMIN.content, d.users, refreshUsers);
  }

  function bgSync(noCache, manual) {
    var token = Store.getToken();
    if (!token) return Promise.resolve();
    return Promise.all([
      fetchOne('status:report', 'report', token),
      fetchOne('analytics', 'analytics', token),
      fetchOne('archive', 'archive', token),
      fetchOne('users:list', 'users', token)
    ]).then(function (oks) {
      ADMIN.data = readCache();
      var anyOk = oks.some(function (x) { return x; });
      // Если у пользователя не было кеша и сеть не дала ничего — честно говорим.
      if (noCache && !anyOk) {
        U.clear(ADMIN.content);
        U.emptyState(ADMIN.content, 'Нет доступа', 'Не удалось загрузить данные. Проверьте соединение и нажмите ↻.');
        return;
      }
      renderActive();
    });
  }

  // Ручное обновление (клик по ↻): показываем спиннер на кнопке,
  // чтобы пользователь видел, что клик сработал и запрос ушёл.
  // Дебаунс через ADMIN.refreshing — повторные клики во время загрузки игнорируются.
  function manualRefresh() {
    if (ADMIN.refreshing) return;
    ADMIN.refreshing = true;
    setRefreshing(true);
    var p = bgSync(false, true);
    (p || Promise.resolve()).finally(function () {
      ADMIN.refreshing = false;
      setRefreshing(false);
    });
  }

  function setRefreshing(on) {
    var b = ADMIN.refreshBtn;
    if (!b) return;
    if (on) {
      b.classList.add('is-loading');
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
    } else {
      b.classList.remove('is-loading');
      b.disabled = false;
      b.removeAttribute('aria-busy');
    }
  }

  // Колбэк после мутации (например, сохранение пользователя): оптимистично
  // обновляем затронутый кусок кеша и инициируем фоновую синхронизацию.
  function refreshUsers() {
    // На мутации просто триггерим bgSync, он подтянет свежий список users
    // и перерисует активную вкладку (если это «Люди»).
    bgSync(false, true);
  }

  function renderReport(root, d) {
    if (!d || !d.ok) { U.emptyState(root, 'Нет данных'); return; }
    var rep = d.report;
    root.appendChild(U.el('div', { class: 'totals' }, [
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Объектов' }), U.el('div', { class: 'totals__value', text: String(rep.counts.objects) })]),
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Мастеров' }), U.el('div', { class: 'totals__value', text: String(rep.counts.masters) })]),
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Расчёт (всего)' }), U.el('div', { class: 'totals__value money', text: U.money(rep.money.totalCalc) })]),
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Прибыль' }), U.el('div', { class: 'totals__value money ' + (rep.money.profit >= 0 ? 'money--pos' : 'money--neg'), text: U.moneySigned(rep.money.profit) })])
    ]));
    var statusHtml = Object.keys(rep.counts.byStatus || {}).map(function (k) {
      return k + ': ' + rep.counts.byStatus[k];
    }).join(' · ');
    if (statusHtml) root.appendChild(U.el('div', { class: 'card__sub', text: 'По статусам: ' + statusHtml }));

    if (rep.lastVisits && rep.lastVisits.length) {
      root.appendChild(U.el('div', { class: 'section-head' }, [U.el('div', { class: 'section-head__title', text: 'Последние выезды' })]));
      rep.lastVisits.forEach(function (v) {
        root.appendChild(U.el('div', { class: 'card' }, [
          U.el('div', { class: 'objhead' }, [U.el('div', { class: 'card__title', text: U.date(v.date) }), U.el('div', { class: 'card__sub', text: 'Объект #' + v.objectId })]),
          v.master ? U.el('div', { class: 'card__sub', text: 'Мастер: ' + v.master }) : null,
          v.note ? U.el('div', { class: 'card__sub', text: '📝 ' + v.note }) : null
        ]));
      });
    }
  }

  function renderAnalytics(root, d) {
    if (!d || !d.ok) { U.emptyState(root, 'Нет данных'); return; }
    var an = d.analytics;
    root.appendChild(U.el('div', { class: 'section-head' }, [U.el('div', { class: 'section-head__title', text: 'По мастерам' })]));
    var rows = Object.keys(an.byMaster || {}).map(function (m) {
      var v = an.byMaster[m];
      return U.el('tr', {}, [
        U.el('td', { text: m }), U.el('td', { class: 'right', text: String(v.objects) }),
        U.el('td', { class: 'right money', text: U.money(v.calc) }), U.el('td', { class: 'right money', text: U.money(v.purchase) }),
        U.el('td', { class: 'right money', text: U.money(v.markup || 0) }),
        U.el('td', { class: 'right money ' + ((v.calc - v.purchase) >= 0 ? 'money--pos' : 'money--neg'), text: U.moneySigned(v.calc - v.purchase) })
      ]);
    });
    root.appendChild(U.el('div', { class: 'card', style: { overflowX: 'auto' } }, [
      U.el('table', { class: 'table' }, [
        U.el('thead', {}, [U.el('tr', {}, [U.el('th', { text: 'Мастер' }), U.el('th', { class: 'right', text: 'Объекты' }), U.el('th', { class: 'right', text: 'Расчёт' }), U.el('th', { class: 'right', text: 'Закупка' }), U.el('th', { class: 'right', text: 'Наценка' }), U.el('th', { class: 'right', text: 'Прибыль' })])]),
        U.el('tbody', {}, rows)
      ])
    ]));

    root.appendChild(U.el('div', { class: 'section-head' }, [U.el('div', { class: 'section-head__title', text: 'По разделам прайса' })]));
    var sec = Object.keys(an.bySection || {}).sort(function (a, b) { return an.bySection[b] - an.bySection[a]; });
    sec.forEach(function (s) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'objhead' }, [U.el('div', { class: 'card__title', text: s }), U.el('div', { class: 'money', text: U.money(an.bySection[s]) })])
      ]));
    });

    root.appendChild(U.el('div', { class: 'totals totals--3col' }, [
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Всего расчёт' }), U.el('div', { class: 'totals__value money', text: U.money(an.totals.calc) })]),
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Всего закупка' }), U.el('div', { class: 'totals__value money', text: U.money(an.totals.purchase) })]),
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Всего наценка' }), U.el('div', { class: 'totals__value money', text: U.money(an.totals.markup || 0) })])
    ]));
  }

  function renderArchive(root, d) {
    if (!d || !d.ok) { U.emptyState(root, 'Нет данных'); return; }
    var list = d.archive || [];
    if (!list.length) { U.emptyState(root, 'Архив пуст', 'Закрытые объекты появятся здесь.'); return; }
    list.forEach(function (o) {
      root.appendChild(U.el('div', { class: 'card card--clickable', onclick: function () { Router.go('#/object/' + o.id); } }, [
        U.el('div', { class: 'objhead' }, [U.el('div', { class: 'card__title', text: o.name || 'Без названия' }), U.el('div', { class: 'objhead__code', text: o.code || '' })]),
        o.client ? U.el('div', { class: 'card__sub', text: 'Клиент: ' + o.client }) : null,
        o.master ? U.el('div', { class: 'card__sub', text: 'Мастер: ' + o.master }) : null,
        o.closedAt ? U.el('div', { class: 'card__sub', text: 'Закрыт: ' + U.datetime(o.closedAt) }) : null
      ]));
    });
  }

  function renderUsers(root, d, afterChange) {
    if (!d || !d.ok) { U.emptyState(root, 'Нет данных'); return; }
    var users = d.users || [];
    root.appendChild(U.el('div', { class: 'section-head' }, [U.el('div', { class: 'section-head__title', text: 'Пользователи (' + users.length + ')' })]));
    users.forEach(function (u) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'objhead' }, [
          U.el('div', {}, [U.el('div', { class: 'card__title', text: u.name || u.login }), U.el('div', { class: 'card__sub', text: u.login + ' · ' + (u.role || '') })]),
          U.el('span', { class: 'pill ' + (u.active ? 'pill--closed' : 'pill--danger'), text: u.active ? 'активен' : 'выкл' })
        ]),
        u.phone ? U.el('div', { class: 'card__sub', text: '☎ ' + u.phone }) : null,
        U.el('div', { class: 'row', style: { marginTop: '8px', justifyContent: 'flex-end' } }, [
          U.el('button', { class: 'btn btn--sm', text: 'Изменить', onclick: function () { editUser(u, afterChange); } })
        ])
      ]));
    });
  }

  function editUser(u, afterChange) {
    var roleI = U.el('select', { class: 'select' }, [
      U.el('option', { value: 'мастер', text: 'мастер' }),
      U.el('option', { value: 'Руководитель', text: 'Руководитель' })
    ]);
    roleI.value = u.role || 'мастер';
    var nameI = U.el('input', { class: 'input', value: u.name || '' });
    var phoneI = U.el('input', { class: 'input', value: u.phone || '' });
    var codeI = U.el('input', { class: 'input', value: u.code || '' });
    var activeI = U.el('input', { type: 'checkbox' }); activeI.checked = !!u.active;

    var body = U.el('div', {}, [
      U.el('div', { class: 'modal__title', text: 'Профиль: ' + (u.login) }),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Логин' }), U.el('input', { class: 'input', value: u.login, disabled: 'disabled' })]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Роль' }), roleI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Имя' }), nameI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Телефон' }), phoneI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Код доступа' }), codeI]),
      U.el('label', { class: 'checkbox', style: { marginBottom: '12px' } }, [activeI, U.el('span', { text: 'Активен' })]),
      U.el('div', { class: 'row' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); } }),
        U.el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: save })
      ])
    ]);
    var m = U.modal(body);

    function save() {
      var btn = body.querySelector('.btn--primary'); btn.disabled = true;
      apiPost('users:save', {
        token: Store.getToken(),
        user: {
          login: u.login, role: roleI.value, name: nameI.value.trim(), phone: phoneI.value.trim(),
          code: codeI.value.trim(), active: activeI.checked ? 1 : 0
        }
      }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        m.close(); U.toast('Сохранено', 'success');
        // Оптимистично правим кеш users (заменяем изменённого), затем bgSync подтянет правду.
        var cur = Store.getUsersCache();
        if (cur && cur.ok && Array.isArray(cur.users)) {
          var i = cur.users.findIndex(function (x) { return x.login === u.login; });
          if (i >= 0) cur.users[i] = Object.assign({}, cur.users[i], {
            role: roleI.value, name: nameI.value.trim(), phone: phoneI.value.trim(),
            active: activeI.checked ? 1 : 0
          });
          Store.setUsersCache(cur);
          ADMIN.data = readCache();
          renderActive();
        }
        if (afterChange) afterChange();
      }).catch(function (e) { U.toast(e.message, 'error'); btn.disabled = false; });
    }
  }

  return { render: render };
})();
