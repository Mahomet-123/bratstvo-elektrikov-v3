// objectCard.js — карточка объекта: Расчёт, Закупка, День, Отчёт.
window.ObjectCard = (function () {

  var TABS = [
    { key: 'calc', label: 'Расчёт' },
    { key: 'purchase', label: 'Закупка' },
    { key: 'day', label: 'День' },
    { key: 'report', label: 'Отчёт' }
  ];

  function sum(arr, f) { return arr.reduce(function (s, r) { return s + (Number(f(r)) || 0); }, 0); }

  function render(id) {
    var app = U.$('#app');
    U.loading(app, 'Загрузка объекта…');
    load(id).then(function (data) { show(app, id, data, 'calc'); })
      .catch(function (err) { U.emptyState(app, 'Не удалось загрузить', String(err && err.message || err)); });
  }

  function load(id) {
    return apiGet('object', { token: Store.getToken(), id: id }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'Ошибка');
      return d;
    });
  }

  function reload(app, id, active) {
    load(id).then(function (data) { show(app, id, data, active); })
      .catch(function (err) { U.toast(err.message, 'error'); });
  }

  function statusPill(s) {
    if (s === 'закрыт') return U.el('span', { class: 'pill pill--closed', text: 'закрыт' });
    if (s === 'день') return U.el('span', { class: 'pill pill--day', text: 'день' });
    return U.el('span', { class: 'pill pill--calc', text: s || '—' });
  }

  function show(app, id, data, active) {
    var o = data.object || {};
    U.clear(app);

    app.appendChild(U.el('div', { class: 'card' }, [
      U.el('div', { class: 'objhead' }, [
        U.el('div', { class: 'card__title', text: o.name || 'Без названия' }),
        statusPill(o.status)
      ]),
      U.el('div', { class: 'objhead__code', text: o.code || '' }),
      o.client ? U.el('div', { class: 'card__sub', text: 'Клиент: ' + o.client }) : null,
      o.master ? U.el('div', { class: 'card__sub', text: 'Мастер: ' + o.master }) : null,
      o.commissioning == 1 ? U.el('div', { class: 'card__sub', text: '⚡ Пусконаладка +30%' }) : null
    ]));

    var tabsBar = U.el('div', { class: 'tabs' });
    TABS.forEach(function (t) {
      tabsBar.appendChild(U.el('button', {
        class: 'tabs__btn' + (t.key === active ? ' tabs__btn--active' : ''),
        text: t.label,
        onclick: function () { show(app, id, data, t.key); }
      }));
    });
    app.appendChild(tabsBar);

    var content = U.el('div', { class: 'tab-content' });
    app.appendChild(content);

    if (active === 'calc') renderCalc(content, id, data, function () { reload(app, id, 'calc'); });
    else if (active === 'purchase') renderPurchase(content, id, data, function () { reload(app, id, 'purchase'); });
    else if (active === 'day') renderDay(content, id, data, function () { reload(app, id, 'day'); });
    else renderReport(content, id, data, function (a) { reload(app, id, a || 'report'); });
  }

  /* ---------------- РАСЧЁТ ---------------- */
  function renderCalc(root, id, data, refresh) {
    var calc = data.calc || [];
    var total = sum(calc, function (r) { return r.sum; });
    if (data.object.commissioning == 1) total = Math.round(total * 1.30);

    root.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('div', { class: 'section-head__title', text: 'Позиции расчёта (' + calc.length + ')' }),
      U.el('button', { class: 'linkbtn', text: '＋ Добавить', onclick: function () { calcModal(id, null, refresh); } })
    ]));

    if (!calc.length) {
      U.emptyState(root, 'Нет позиций', 'Добавьте позиции из прайс-листа или вручную.');
    } else {
      calc.forEach(function (r) {
        root.appendChild(U.el('div', { class: 'card' }, [
          U.el('div', { class: 'objhead' }, [
            U.el('div', { class: 'card__title', text: r.name || '—' }),
            U.el('div', { class: 'money', text: U.money(r.sum) })
          ]),
          r.section ? U.el('div', { class: 'card__sub', text: r.section }) : null,
          U.el('div', { class: 'card__sub' }, [
            (Number(r.qty) || 0) + ' ' + (r.unit || '') + ' × ' + U.money(r.price) +
            (Number(r.coef) && Number(r.coef) != 1 ? ' × ' + r.coef : '') +
            (r.material == 1 ? ' · материал' : '') + (r.from == 1 ? ' · с' : '')
          ]),
          r.note ? U.el('div', { class: 'card__sub', text: '📝 ' + r.note }) : null,
          U.el('div', { class: 'row', style: { marginTop: '8px', justifyContent: 'flex-end' } }, [
            U.el('button', { class: 'btn btn--sm', text: '✎', onclick: function () { calcModal(id, r, refresh); } }),
            U.el('button', { class: 'btn btn--sm btn--danger', text: '✕', onclick: function () { removeCalc(id, r, refresh); } })
          ])
        ]));
      });
    }

    root.appendChild(U.el('div', { class: 'totals' }, [
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Итог расчёта' }),
        U.el('div', { class: 'totals__value money', text: U.money(total) })
      ]),
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Позиций' }),
        U.el('div', { class: 'totals__value', text: String(calc.length) })
      ])
    ]));
    root.appendChild(U.el('button', { class: 'btn btn--block', text: '🔄 Пересчитать', onclick: function () {
      apiPost('records:recalc', { token: Store.getToken(), objectId: id }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        U.toast('Пересчитано: ' + U.money(d.result.total), 'success');
        refresh();
      }).catch(function (e) { U.toast(e.message, 'error'); });
    } }));
  }

  function removeCalc(id, r, refresh) {
    U.confirm('Удалить позицию «' + (r.name || '') + '»?').then(function (ok) {
      if (!ok) return;
      apiPost('records:remove', { token: Store.getToken(), objectId: id, rowNum: r.__row })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); U.toast('Удалено', 'success'); refresh(); })
        .catch(function (e) { U.toast(e.message, 'error'); });
    });
  }

  function calcModal(id, line, refresh) {
    var prices = Store.getPrices();
    var editing = !!line;

    var searchI = U.el('input', { class: 'input', placeholder: 'Поиск в прайс-листе…' });
    var listBox = U.el('div', { style: { maxHeight: '180px', overflowY: 'auto', marginBottom: '10px' } });
    var nameI = U.el('input', { class: 'input', placeholder: 'Наименование' });
    var sectI = U.el('input', { class: 'input', placeholder: 'Раздел' });
    var unitI = U.el('input', { class: 'input', placeholder: 'Ед. изм.' });
    var qtyI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Кол-во', value: '1' });
    var priceI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Цена' });
    var coefI = U.el('input', { class: 'input', type: 'number', step: 'any', value: '1', placeholder: 'Коэфф.' });
    var matI = U.el('input', { type: 'checkbox', checked: 'checked' });
    var noteI = U.el('textarea', { class: 'textarea', placeholder: 'Примечание' });

    function applyPrice(p) {
      nameI.value = p.name; sectI.value = p.section; unitI.value = p.unit; priceI.value = p.price;
    }
    function renderList(q) {
      U.clear(listBox);
      var ql = (q || '').toLowerCase();
      var hits = prices.filter(function (p) {
        return !ql || (p.name + ' ' + p.section).toLowerCase().indexOf(ql) >= 0;
      }).slice(0, 40);
      if (!hits.length) { listBox.appendChild(U.el('div', { class: 'card__sub', text: 'Ничего не найдено' })); return; }
      hits.forEach(function (p) {
        listBox.appendChild(U.el('div', { class: 'card card--clickable', style: { padding: '8px 10px', marginBottom: '6px' }, onclick: function () { applyPrice(p); } }, [
          U.el('div', { style: { fontWeight: '600' }, text: p.name }),
          U.el('div', { class: 'card__sub', text: p.section + ' · ' + U.money(p.price) + '/' + (p.unit || '') })
        ]));
      });
    }
    searchI.addEventListener('input', function () { renderList(searchI.value); });
    renderList('');

    if (editing) {
      nameI.value = line.name || ''; sectI.value = line.section || ''; unitI.value = line.unit || '';
      qtyI.value = line.qty; priceI.value = line.price; coefI.value = line.coef || 1;
      matI.checked = line.material == 1; noteI.value = line.note || '';
    }

    var body = U.el('div', {}, [
      U.el('div', { class: 'modal__title', text: editing ? 'Редактировать позицию' : 'Новая позиция' }),
      searchI, listBox,
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Наименование' }), nameI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Раздел' }), sectI]),
      U.el('div', { style: { display: 'flex', gap: '10px' } }, [
        U.el('div', { class: 'field', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Ед.' }), unitI]),
        U.el('div', { class: 'field', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Кол-во' }), qtyI]),
        U.el('div', { class: 'field', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Цена' }), priceI])
      ]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Коэффициент' }), coefI]),
      U.el('label', { class: 'checkbox', style: { marginBottom: '12px' } }, [matI, U.el('span', { text: 'Наценка на материал (+10%, мин. 1500 ₽)' })]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Примечание' }), noteI]),
      U.el('div', { class: 'row' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); } }),
        U.el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: save })
      ])
    ]);
    var m = U.modal(body);

    function save() {
      var name = nameI.value.trim();
      if (!name) { U.toast('Введите наименование', 'error'); return; }
      var payload = {
        token: Store.getToken(), objectId: id,
        line: {
          n: '', section: sectI.value.trim(), name: name, unit: unitI.value.trim(),
          qty: Number(qtyI.value) || 0, price: Number(priceI.value) || 0,
          coef: Number(coefI.value) || 1, material: matI.checked ? 1 : 0, note: noteI.value.trim()
        }
      };
      var btn = body.querySelector('.btn--primary');
      btn.disabled = true;
      var p = editing
        ? apiPost('records:update', { token: Store.getToken(), objectId: id, rowNum: line.__row, patch: payload.line })
        : apiPost('records:add', payload);
      p.then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        m.close();
        U.toast(editing ? 'Обновлено' : 'Добавлено', 'success');
        refresh();
      }).catch(function (e) { U.toast(e.message, 'error'); btn.disabled = false; });
    }
  }

  /* ---------------- ЗАКУПКА ---------------- */
  function renderPurchase(root, id, data, refresh) {
    var pur = data.purchases || [];
    var total = sum(pur, function (r) { return r.sum; });

    root.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('div', { class: 'section-head__title', text: 'Закупка (' + pur.length + ')' }),
      U.el('button', { class: 'linkbtn', text: '＋ Добавить', onclick: function () { purchaseModal(id, refresh); } })
    ]));

    if (!pur.length) {
      U.emptyState(root, 'Нет закупок', 'Добавьте покупку с фото чека при необходимости.');
    } else {
      pur.forEach(function (r) {
        root.appendChild(U.el('div', { class: 'card' }, [
          U.el('div', { class: 'objhead' }, [
            U.el('div', { class: 'card__title', text: r.name || '—' }),
            U.el('div', { class: 'money', text: U.money(r.sum) })
          ]),
          U.el('div', { class: 'card__sub' }, [
            U.date(r.date) + (Number(r.qty) ? ' · ' + r.qty + ' шт × ' + U.money(r.price) : '')
          ]),
          r.photo ? U.el('img', { class: 'thumb', src: r.photo, style: { marginTop: '6px' } }) : null,
          r.note ? U.el('div', { class: 'card__sub', text: '📝 ' + r.note }) : null,
          U.el('div', { class: 'row', style: { marginTop: '8px', justifyContent: 'flex-end' } }, [
            U.el('button', { class: 'btn btn--sm btn--danger', text: '✕', onclick: function () { removePurchase(id, r, refresh); } })
          ])
        ]));
      });
    }

    root.appendChild(U.el('div', { class: 'totals' }, [
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Итог закупки' }),
        U.el('div', { class: 'totals__value money', text: U.money(total) })
      ]),
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Позиций' }),
        U.el('div', { class: 'totals__value', text: String(pur.length) })
      ])
    ]));
  }

  function removePurchase(id, r, refresh) {
    U.confirm('Удалить закупку «' + (r.name || '') + '»?').then(function (ok) {
      if (!ok) return;
      apiPost('purchases:remove', { token: Store.getToken(), objectId: id, rowNum: r.__row })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); U.toast('Удалено', 'success'); refresh(); })
        .catch(function (e) { U.toast(e.message || 'Ошибка удаления', 'error'); });
    });
  }

  function purchaseModal(id, refresh) {
    var dateI = U.el('input', { class: 'input', type: 'date', value: U.todayISO() });
    var nameI = U.el('input', { class: 'input', placeholder: 'Наименование' });
    var qtyI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Кол-во', value: '1' });
    var priceI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Цена за ед.' });
    var noteI = U.el('textarea', { class: 'textarea', placeholder: 'Примечание' });
    var fileI = U.el('input', { class: 'input', type: 'file', accept: 'image/*' });

    var body = U.el('div', {}, [
      U.el('div', { class: 'modal__title', text: 'Новая закупка' }),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Дата' }), dateI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Наименование *' }), nameI]),
      U.el('div', { style: { display: 'flex', gap: '10px' } }, [
        U.el('div', { class: 'field', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Кол-во' }), qtyI]),
        U.el('div', { class: 'field', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Цена' }), priceI])
      ]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Фото чека (необязательно)' }), fileI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Примечание' }), noteI]),
      U.el('div', { class: 'row' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); } }),
        U.el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: save })
      ])
    ]);
    var m = U.modal(body);

    function save() {
      var name = nameI.value.trim();
      if (!name) { U.toast('Введите наименование', 'error'); return; }
      var btn = body.querySelector('.btn--primary');
      btn.disabled = true; btn.textContent = 'Сохранение…';
      var purchase = {
        date: dateI.value || U.todayISO(), name: name,
        qty: Number(qtyI.value) || 0, price: Number(priceI.value) || 0, note: noteI.value.trim()
      };
      function send(photo) {
        if (photo) purchase.photo = photo;
        apiPost('purchases:add', { token: Store.getToken(), objectId: id, purchase: purchase }).then(function (d) {
          if (!d.ok) throw new Error(d.error || 'Ошибка');
          m.close(); U.toast('Закупка добавлена', 'success'); refresh();
        }).catch(function (e) { U.toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Сохранить'; });
      }
      var f = fileI.files && fileI.files[0];
      if (f) {
        var rd = new FileReader();
        rd.onload = function () { send(String(rd.result).replace(/^data:.*;base64,/, '')); };
        rd.onerror = function () { send(''); };
        rd.readAsDataURL(f);
      } else { send(''); }
    }
  }

  /* ---------------- ДЕНЬ ---------------- */
  function renderDay(root, id, data, refresh) {
    var vis = data.visits || [];
    root.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('div', { class: 'section-head__title', text: 'Дни работ (' + vis.length + ')' }),
      U.el('button', { class: 'linkbtn', text: '＋ Добавить', onclick: function () { dayModal(id, refresh); } })
    ]));
    if (!vis.length) {
      U.emptyState(root, 'Нет записей о днях', 'Отмечайте выезды и выполненные работы.');
    } else {
      vis.forEach(function (r) {
        root.appendChild(U.el('div', { class: 'card' }, [
          U.el('div', { class: 'objhead' }, [
            U.el('div', { class: 'card__title', text: U.date(r.date) }),
            r.dayNumber ? U.el('div', { class: 'card__sub', text: 'День ' + r.dayNumber }) : null
          ]),
          r.master ? U.el('div', { class: 'card__sub', text: 'Мастер: ' + r.master }) : null,
          r.note ? U.el('div', { class: 'card__sub', text: '📝 ' + r.note }) : null
        ]));
      });
    }
  }

  function dayModal(id, refresh) {
    var u = Store.getUser() || {};
    var dateI = U.el('input', { class: 'input', type: 'date', value: U.todayISO() });
    var masterI = U.el('input', { class: 'input', value: u.name || u.login || '' });
    var dayI = U.el('input', { class: 'input', type: 'number', placeholder: '№ дня (необязательно)' });
    var noteI = U.el('textarea', { class: 'textarea', placeholder: 'Описание выполненных работ' });

    var body = U.el('div', {}, [
      U.el('div', { class: 'modal__title', text: 'Запись дня' }),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Дата' }), dateI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Мастер' }), masterI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: '№ дня' }), dayI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Описание' }), noteI]),
      U.el('div', { class: 'row' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); } }),
        U.el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: save })
      ])
    ]);
    var m = U.modal(body);

    function save() {
      var btn = body.querySelector('.btn--primary'); btn.disabled = true;
      apiPost('visits:add', {
        token: Store.getToken(), objectId: id,
        visit: { date: dateI.value || U.todayISO(), master: masterI.value.trim(), dayNumber: dayI.value.trim(), note: noteI.value.trim() }
      }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        m.close(); U.toast('День добавлен', 'success'); refresh();
      }).catch(function (e) { U.toast(e.message, 'error'); btn.disabled = false; });
    }
  }

  /* ---------------- ОТЧЁТ ---------------- */
  function renderReport(root, id, data, refresh) {
    var o = data.object || {};
    var calcTotal = sum(data.calc || [], function (r) { return r.sum; });
    if (o.commissioning == 1) calcTotal = Math.round(calcTotal * 1.30);
    var purTotal = sum(data.purchases || [], function (r) { return r.sum; });
    var profit = calcTotal - purTotal;

    root.appendChild(U.el('div', { class: 'totals' }, [
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Расчёт' }),
        U.el('div', { class: 'totals__value money', text: U.money(calcTotal) })
      ]),
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Закупка' }),
        U.el('div', { class: 'totals__value money', text: U.money(purTotal) })
      ]),
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Прибыль' }),
        U.el('div', { class: 'totals__value money ' + (profit >= 0 ? 'money--pos' : 'money--neg'), text: U.moneySigned(profit) })
      ]),
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Статус' }),
        U.el('div', { class: 'totals__value', style: { fontSize: '15px' }, text: o.status || '—' })
      ])
    ]));

    if (o.commissioning == 1) root.appendChild(U.el('div', { class: 'card__sub', text: '⚡ Учтён коэффициент пусконаладки +30%.' }));
    if (o.closedAt) root.appendChild(U.el('div', { class: 'card__sub', text: 'Закрыт: ' + U.datetime(o.closedAt) }));

    if (Store.isAdmin()) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__title', text: 'Действия руководителя' }),
        o.status !== 'закрыт' ? U.el('button', { class: 'btn btn--danger btn--block', text: 'Закрыть объект', style: { marginBottom: '8px' }, onclick: function () { closeObject(id, refresh); } }) : null,
        U.el('button', { class: 'btn btn--block', text: '🔗 Создать ссылку для клиента', onclick: function () { createCabinet(id); } })
      ]));
    }
  }

  function closeObject(id, refresh) {
    U.confirm('Закрыть объект? Данные попадут в архив, кабинет клиента аннулируется.', 'Закрыть').then(function (ok) {
      if (!ok) return;
      apiPost('objects:close', { token: Store.getToken(), id: id }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        U.toast('Объект закрыт', 'success');
        refresh('report');
      }).catch(function (e) { U.toast(e.message, 'error'); });
    });
  }

  function createCabinet(id) {
    apiPost('cabinet:create', { token: Store.getToken(), id: id }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'Ошибка');
      var url = location.origin + location.pathname + '#/cabinet/' + d.cabinet.token;
      var body = U.el('div', {}, [
        U.el('div', { class: 'modal__title', text: 'Ссылка для клиента' }),
        U.el('p', { class: 'card__sub', text: 'Открывается без входа. Доступна 60 дней.' }),
        U.el('div', { class: 'card', style: { wordBreak: 'break-all', userSelect: 'all' }, text: url }),
        U.el('div', { class: 'row' }, [
          U.el('button', { class: 'btn btn--ghost', text: 'Закрыть', onclick: function () { m.close(); } }),
          U.el('button', { class: 'btn btn--primary', text: 'Копировать', onclick: function () { U.copy(url).then(function () { U.toast('Скопировано', 'success'); }); } })
        ])
      ]);
      var m = U.modal(body);
    }).catch(function (e) { U.toast(e.message, 'error'); });
  }

  return { render: render };
})();
