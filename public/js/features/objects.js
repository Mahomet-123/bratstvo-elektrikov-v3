// objects.js — список объектов и создание нового.
window.Objects = (function () {

  var LIST = null; // кеш списка в памяти

  function ensurePrices() {
    var cached = Store.getPrices();
    if (cached && cached.length) return Promise.resolve(cached);
    return apiGet('prices').then(function (d) {
      if (d && d.ok) { Store.setPrices(d.prices || []); return d.prices || []; }
      return [];
    });
  }

  function statusPill(status) {
    if (status === 'закрыт') return U.el('span', { class: 'pill pill--closed', text: 'закрыт' });
    if (status === 'день') return U.el('span', { class: 'pill pill--day', text: 'день' });
    return U.el('span', { class: 'pill pill--calc', text: status || '—' });
  }

  function card(o) {
    var sub = [];
    if (o.client) sub.push('Клиент: ' + o.client);
    if (o.master) sub.push('Мастер: ' + o.master);
    var node = U.el('div', { class: 'card card--clickable', onclick: function () { Router.go('#/object/' + o.id); } }, [
      U.el('div', { class: 'objhead' }, [
        U.el('div', { class: 'card__title', text: o.name || 'Без названия' }),
        statusPill(o.status)
      ]),
      U.el('div', { class: 'objhead__code', text: o.code || '' }),
      sub.length ? U.el('div', { class: 'card__sub', text: sub.join(' · ') }) : null,
      o.commissioning == 1 ? U.el('div', { class: 'card__sub', text: '⚡ Пусконаладка +30%' }) : null
    ]);
    return node;
  }

  function paint(app, objects, fromCache) {
    U.clear(app);
    app.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('div', { class: 'section-head__title' }, [
        U.el('span', { text: 'Объекты (' + objects.length + ')' })
      ]),
      U.el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
        fromCache ? U.el('span', { class: 'card__sub', text: 'кэш' }) : null,
        U.el('button', { class: 'linkbtn', text: '＋ Новый', onclick: showCreate })
      ])
    ]));
    if (!objects.length) {
      U.emptyState(app, 'Пока нет объектов', 'Нажмите «Новый», чтобы добавить первый объект.');
      return;
    }
    objects.forEach(function (o) { app.appendChild(card(o)); });
  }

  function render(force) {
    var app = U.$('#app');
    if (LIST && !force) { paint(app, LIST, true); return; }
    U.loading(app, 'Загрузка объектов…');
    Promise.all([ensurePrices(), apiGet('objects', { token: Store.getToken() })]).then(function (res) {
      var objects = (res[1] && res[1].ok) ? (res[1].objects || []) : [];
      LIST = objects; Store.setObjectsCache(objects);
      paint(app, objects, false);
    }).catch(function (err) {
      // при ошибке — показываем кеш, если есть
      var cached = Store.getObjectsCache();
      if (cached && cached.length) { LIST = cached; paint(app, cached, true); }
      else U.emptyState(app, 'Не удалось загрузить', String(err && err.message || err));
    });
  }

  function showCreate() {
    var nameI = U.el('input', { class: 'input', placeholder: 'Название объекта' });
    var addrI = U.el('input', { class: 'input', placeholder: 'Адрес' });
    var clientI = U.el('input', { class: 'input', placeholder: 'Клиент' });
    var commI = U.el('input', { type: 'checkbox', id: 'comm' });
    var masterWrap = U.el('div', { class: 'field', style: { display: 'none' } });

    var fields = [
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Название *' }), nameI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Адрес' }), addrI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Клиент' }), clientI]),
      U.el('label', { class: 'checkbox', style: { marginBottom: '12px' } }, [commI, U.el('span', { text: 'Пусконаладка (+30% к расчёту)' })])
    ];

    if (Store.isAdmin()) {
      var sel = U.el('select', { class: 'select' }, [U.el('option', { value: '', text: '— не выбран —' })]);
      masterWrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Мастер' }), sel]);
      fields.push(masterWrap);
      apiGet('users:list', { token: Store.getToken() }).then(function (d) {
        if (d && d.ok) {
          d.users.filter(function (x) { return x.role === 'мастер'; }).forEach(function (m) {
            sel.appendChild(U.el('option', { value: m.login, text: m.name || m.login }));
          });
        }
      }).catch(function () {});
    }

    var body = U.el('div', {}, [
      U.el('div', { class: 'modal__title', text: 'Новый объект' })
    ].concat(fields).concat([
      U.el('div', { class: 'row' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); } }),
        U.el('button', { class: 'btn btn--primary', text: 'Создать', onclick: create })
      ])
    ]));
    var m = U.modal(body);

    function create() {
      var name = nameI.value.trim();
      if (!name) { U.toast('Введите название', 'error'); return; }
      var btn = body.querySelector('.btn--primary');
      btn.disabled = true; btn.textContent = 'Создание…';
      var payload = {
        token: Store.getToken(),
        name: name, address: addrI.value.trim(), client: clientI.value.trim(),
        commissioning: commI.checked
      };
      if (Store.isAdmin()) payload.master = sel.value || '';
      apiPost('objects:create', payload).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Не удалось создать');
        m.close();
        U.toast('Объект создан', 'success');
        Router.go('#/object/' + d.object.id);
      }).catch(function (err) {
        U.toast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Создать';
      });
    }
  }

  return { render: render, showCreate: showCreate, ensurePrices: ensurePrices };
})();
