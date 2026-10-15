// objectCard.js — карточка объекта: Расчёт, Закупка, День, Отчёт.
// Данные объекта грузим 1 раз и храним на устройстве; переключение вкладок
// идёт из кеша (без сети). Мутации применяются оптимистично к локальному
// кешу, а фоновая синхронизация обновляет данные с сервера без блокировки UI.
window.ObjectCard = (function () {

  var TABS = [
    { key: 'calc', label: 'Расчёт' },
    { key: 'purchase', label: 'Закупка' },
    { key: 'day', label: 'День' },
    { key: 'report', label: 'Отчёт' }
  ];

  var OBJ = {};     // id -> данные объекта
  var SYNC = {};    // id -> { state, ts, pending }
  var ACTIVE = {};  // id -> последняя активная вкладка

  function sum(arr, f) { return arr.reduce(function (s, r) { return s + (Number(f(r)) || 0); }, 0); }

  function calcLineSum(line) {
    var qty = Number(line.qty) || 0;
    var price = Number(line.price) || 0;
    var coef = Number(line.coef) || 1;
    var s = price * qty * coef;
    if (line.material) {
      var markup = s * 0.10;
      if (markup < 1500) markup = 1500;
      s += markup;
    }
    return Math.round(s);
  }

  function statusPill(s) {
    if (s === 'закрыт') return U.el('span', { class: 'pill pill--closed', text: 'закрыт' });
    if (s === 'день') return U.el('span', { class: 'pill pill--day', text: 'день' });
    return U.el('span', { class: 'pill pill--calc', text: s || '—' });
  }

  function syncLabel(s) {
    if (!s) return '✓ Синхронизировано';
    if (s.state === 'pending') return '⏳ Не отправлено' + (s.pending ? ' (' + s.pending + ')' : '');
    if (s.state === 'saving') return '⏳ Сохранение…';
    if (s.state === 'error') return '⚠ Ошибка отправки';
    return '✓ Синхронизировано';
  }
  function syncClass(s) {
    if (!s) return 'pill--ok';
    if (s.state === 'pending') return 'pill--warn';
    if (s.state === 'error') return 'pill--danger';
    return 'pill--ok';
  }
  function setSync(id, state, pending) {
    SYNC[id] = { state: state, ts: Date.now(), pending: pending || 0 };
    var el = U.$('#objSync');
    if (el) { el.className = 'pill ' + syncClass(SYNC[id]); el.textContent = syncLabel(SYNC[id]); }
  }

  /* ---------- Локальное сохранение кеша ---------- */
  function persist(id) {
    if (OBJ[id]) Store.setObjectCache(id, OBJ[id]);
  }

  /* ---------- Оптимистичное обновление кеша после мутации ---------- */
  function patchCache(id, type, action, result) {
    if (!OBJ[id]) return;
    if (type === 'calc') {
      if (action === 'add' && result && result.line) {
        OBJ[id].calc = OBJ[id].calc || [];
        OBJ[id].calc.push(result.line);
      } else if (action === 'update' && result && result.rowNum && result.line) {
        OBJ[id].calc = (OBJ[id].calc || []).map(function (r) {
          return r.__row === result.rowNum ? result.line : r;
        });
      } else if (action === 'remove' && result && result.rowNum) {
        OBJ[id].calc = (OBJ[id].calc || []).filter(function (r) { return r.__row !== result.rowNum; });
      } else if (action === 'recalc' && result && result.lines) {
        // сервер вернул пересчитанные суммы — обновим локально
        (OBJ[id].calc || []).forEach(function (r) { /* суммы уже в кеше обновлены при add/update */ });
      }
    } else if (type === 'purchase') {
      if (action === 'add' && result && result.line) {
        OBJ[id].purchases = OBJ[id].purchases || [];
        OBJ[id].purchases.push(result.line);
      } else if (action === 'remove' && result && result.rowNum) {
        OBJ[id].purchases = (OBJ[id].purchases || []).filter(function (r) { return r.__row !== result.rowNum; });
      } else if (action === 'update' && result && result.rowNum && result.line) {
        OBJ[id].purchases = (OBJ[id].purchases || []).map(function (r) {
          return r.__row === result.rowNum ? result.line : r;
        });
      }
    } else if (type === 'visit') {
      if (action === 'add' && result && result.line) {
        OBJ[id].visits = OBJ[id].visits || [];
        OBJ[id].visits.push(result.line);
      }
    }
    persist(id);
  }

  /* ---------- Фоновая синхронизация (без блокировки UI) ---------- */
  function bgSync(id) {
    if (!navigator.onLine) {
      Offline.count().then(function (n) { setSync(id, n > 0 ? 'pending' : 'synced', n); });
      return;
    }
    setSync(id, 'saving', 0);
    apiGet('object', { token: Store.getToken(), id: id }, { silent: true }).then(function (d) {
      if (!d || !d.ok) return;
      OBJ[id] = d; Store.setObjectCache(id, d);
      setSync(id, 'synced', 0);
      // перерисовать текущую вкладку, если объект открыт
      var p = (location.hash.replace(/^#/, '') || '');
      var m = p.match(/^\/object\/(\d+)$/);
      if (m && m[1] === String(id)) {
        show(U.$('#app'), id, OBJ[id], ACTIVE[id] || 'calc');
      }
    }).catch(function () {
      Offline.count().then(function (n) { setSync(id, n > 0 ? 'pending' : 'error', n); });
    });
  }

  /* ---------- Загрузка с сервера или из кеша ---------- */
  function load(id, force) {
    if (OBJ[id] && !force) return Promise.resolve(OBJ[id]);
    return apiGet('object', { token: Store.getToken(), id: id }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'Ошибка');
      OBJ[id] = d; Store.setObjectCache(id, d);
      setSync(id, 'synced', 0);
      return d;
    });
  }

  /* ---------- Вход в карточку ---------- */
  function render(id, force) {
    if (!OBJ[id]) {
      var disk = Store.getObjectCache(id);
      if (disk && !force) OBJ[id] = disk;
    }
    if (OBJ[id] && !force) {
      ACTIVE[id] = ACTIVE[id] || 'calc';
      show(U.$('#app'), id, OBJ[id], ACTIVE[id]);
      return;
    }
    var app = U.$('#app');
    U.loading(app, force ? 'Синхронизация…' : 'Загрузка объекта…');
    load(id, force).then(function (data) {
      ACTIVE[id] = ACTIVE[id] || 'calc';
      show(app, id, data, ACTIVE[id]);
    }).catch(function (err) {
      U.emptyState(app, 'Не удалось загрузить', String(err && err.message || err));
    });
  }

  /* ---------- Ручная перезагрузка (кнопка ↻) ---------- */
  function reload(id) {
    var btn = U.$('#objSyncReload');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    setSync(id, 'saving', 0);
    load(id, true).then(function (data) {
      show(U.$('#app'), id, data, ACTIVE[id] || 'calc');
      U.toast('Данные обновлены', 'success');
    }).catch(function (err) {
      Offline.count().then(function (n) { setSync(id, n > 0 ? 'pending' : 'error', n); });
      U.toast(err.message || 'Не удалось обновить', 'error');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
    });
  }

  function show(app, id, data, active) {
    ACTIVE[id] = active;
    var o = data.object || {};
    U.clear(app);

    var objhead = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'objhead' }, [
        U.el('div', { class: 'card__title', text: o.name || 'Без названия' }),
        statusPill(o.status)
      ]),
      U.el('div', { class: 'objhead__code', text: o.code || '' }),
      o.client ? U.el('div', { class: 'card__sub', text: 'Клиент: ' + o.client }) : null,
      o.master ? U.el('div', { class: 'card__sub', text: 'Мастер: ' + o.master }) : null,
      o.commissioning == 1 ? U.el('div', { class: 'card__sub', text: '⚡ Пусконаладка +30%' }) : null,
      U.el('div', { class: 'objsync' }, [
        U.el('span', { id: 'objSync', class: 'pill ' + syncClass(SYNC[id]), text: syncLabel(SYNC[id]) }),
        U.el('button', { id: 'objSyncReload', class: 'btn btn--sm', text: '↻ Обновить', 'aria-label': 'Обновить с сервера', onclick: function () { reload(id); } })
      ])
    ]);
    app.appendChild(objhead);

    var tabsBar = U.el('div', { class: 'tabs' });
    TABS.forEach(function (t) {
      tabsBar.appendChild(U.el('button', {
        class: 'tabs__btn' + (t.key === active ? ' tabs__btn--active' : ''), text: t.label,
        onclick: function () { show(app, id, OBJ[id], t.key); }
      }));
    });
    app.appendChild(tabsBar);

    var content = U.el('div', { class: 'tab-content' });
    app.appendChild(content);

    if (active === 'calc') renderCalc(content, id, data, function (a) { afterMutation(id, a); });
    else if (active === 'purchase') renderPurchase(content, id, data, function () { afterMutation(id); });
    else if (active === 'day') renderDay(content, id, data, function () { afterMutation(id); });
    else renderReport(content, id, data, function (a) { afterMutation(id, a); });
  }

  /* ---------- После мутации: оптимистично обновляем кеш и перерисовываем.
                Фоновая синхронизация обновит данные с сервера без блокировки UI. ---------- */
  function afterMutation(id, active) {
    active = active || ACTIVE[id] || 'calc';
    // Перерисовываем из кеша — мгновенно, без сети.
    if (OBJ[id]) {
      show(U.$('#app'), id, OBJ[id], active);
    }
    // Фоновая синхронизация с сервера — без блокировки UI.
    setTimeout(function () { bgSync(id); }, 300);
  }

  /* ---------------- РАСЧЁТ ---------------- */
  function renderCalc(root, id, data, refresh) {
    var calc = data.calc || [];
    var total = sum(calc, function (r) { return r.sum; });
    if (data.object.commissioning == 1) total = Math.round(total * 1.30);

    root.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('div', { class: 'section-head__title', text: 'Позиции расчёта (' + calc.length + ')' }),
      U.el('button', { class: 'btn btn--sm btn--primary', text: '＋ Добавить', 'aria-label': 'Добавить работу', onclick: function () { calcModal(id, null, refresh); } })
    ]));

    var listEl = U.el('div', {});
    root.appendChild(listEl);

    if (!calc.length) {
      U.emptyState(listEl, 'Нет позиций', 'Нажмите «Добавить», выберите работу из прайс-листа или введите вручную.');
    } else {
      calc.forEach(function (r) {
        listEl.appendChild(U.el('div', { class: 'card' }, [
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
            U.el('button', { class: 'btn btn--sm', text: '✎ Изменить', 'aria-label': 'Изменить', onclick: function () { calcModal(id, r, refresh); } }),
            U.el('button', { class: 'btn btn--sm btn--danger', text: '✕ Удалить', 'aria-label': 'Удалить', onclick: function () { removeCalc(id, r, refresh); } })
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
    root.appendChild(U.el('button', { class: 'btn btn--block', text: '🔄 Пересчитать', 'aria-label': 'Пересчитать', onclick: recalc }));
    function recalc() {
      var btn = U.$('.btn--block', root);
      btn.disabled = true; btn.classList.add('is-loading');
      apiPost('records:recalc', { token: Store.getToken(), objectId: id }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        U.toast('Пересчитано: ' + U.money(d.result.total), 'success');
        refresh();
      }).catch(function (e) {
        U.toast(e.message, 'error');
        btn.disabled = false; btn.classList.remove('is-loading');
      });
    }
  }

  function removeCalc(id, r, refresh) {
    U.confirm('Удалить позицию «' + (r.name || '') + '»?').then(function (ok) {
      if (!ok) return;
      // Оптимистичное обновление: убираем из кеша сразу
      if (OBJ[id] && OBJ[id].calc) {
        OBJ[id].calc = OBJ[id].calc.filter(function (x) { return x.__row !== r.__row; });
        persist(id);
      }
      refresh();
      apiPost('records:remove', { token: Store.getToken(), objectId: id, rowNum: r.__row })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); U.toast('Удалено', 'success'); setTimeout(function () { bgSync(id); }, 300); })
        .catch(function (e) { U.toast(e.message, 'error'); setTimeout(function () { bgSync(id); }, 300); });
    });
  }

  function calcModal(id, line, refresh) {
    var prices = Store.getPrices();
    var editing = !!line;

    var searchI = U.el('input', { class: 'input', placeholder: 'Поиск в прайс-листе…' });
    var listBox = U.el('div', { class: 'pricelist', style: { maxHeight: '170px', overflowY: 'auto', marginBottom: '10px' } });
    var nameI = U.el('input', { class: 'input', placeholder: 'Наименование' });
    var sectI = U.el('input', { class: 'input', placeholder: 'Раздел' });
    var unitI = U.el('input', { class: 'input', placeholder: 'Ед. изм.' });
    var qtyI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Кол-во', value: '1' });
    var priceI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Цена' });
    var coefI = U.el('input', { class: 'input', type: 'number', step: 'any', value: '1', placeholder: 'Коэфф.' });
    var matI = U.el('input', { type: 'checkbox' }); // по умолчанию НЕ отмечен (пункт 1.1)
    var noteI = U.el('textarea', { class: 'textarea', placeholder: 'Примечание' });

    function applyPrice(p) {
      nameI.value = p.name; sectI.value = p.section; unitI.value = p.unit; priceI.value = p.price;
    }

    // --- Множественный выбор (пункт 1) ---
    var selected = []; // массив выбранных элементов прайс-листа
    function isSelected(p) { return selected.some(function (x) { return x.name === p.name && x.section === p.section && x.price === p.price; }); }
    function toggleSel(p, cb) {
      if (isSelected(p)) selected = selected.filter(function (x) { return x !== p; });
      else selected.push(p);
      updateSelBtn();
      if (cb) cb.checked = isSelected(p);
    }
    var addSelBtn = U.el('button', { class: 'btn btn--primary', text: 'Добавить выбранные (0)', disabled: 'disabled', onclick: addSelected });

    function updateSelBtn() {
      addSelBtn.textContent = 'Добавить выбранные (' + selected.length + ')';
      if (selected.length > 0) addSelBtn.removeAttribute('disabled');
      else addSelBtn.setAttribute('disabled', 'disabled');
    }

    function renderList(q) {
      U.clear(listBox);
      var ql = (q || '').toLowerCase();
      var work = prices.filter(function (p) {
        if (p.type && p.type !== 'work') return false;
        return !ql || (p.name + ' ' + p.section).toLowerCase().indexOf(ql) >= 0;
      });
      var hits = work.slice(0, 50);
      var countEl = U.el('div', { class: 'card__sub', style: { marginBottom: '6px' }, text: 'Найдено работ: ' + hits.length + ' из ' + work.length + (ql ? '' : ' (показаны первые 50)') });
      listBox.appendChild(countEl);
      if (!hits.length) { listBox.appendChild(U.el('div', { class: 'card__sub', text: 'Ничего не найдено' })); return; }
      var bySec = {};
      hits.forEach(function (p) { (bySec[p.section] = bySec[p.section] || []).push(p); });
      Object.keys(bySec).forEach(function (sec) {
        listBox.appendChild(U.el('div', { class: 'pricelist__sec', text: sec }));
        bySec[sec].forEach(function (p) {
          var cb = U.el('input', { type: 'checkbox', 'aria-label': 'Выбрать ' + p.name });
          cb.checked = isSelected(p);
          cb.addEventListener('change', function () { toggleSel(p, cb); });
          listBox.appendChild(U.el('div', { class: 'card pricelist__item', style: { padding: '8px 10px', marginBottom: '6px', display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
            U.el('div', { style: { paddingTop: '2px' } }, [cb]),
            U.el('div', { style: { flex: '1', minWidth: '0', cursor: 'pointer' }, onclick: function () { applyPrice(p); } }, [
              U.el('div', { style: { fontWeight: '600' }, text: p.name }),
              U.el('div', { class: 'card__sub', text: U.money(p.price) + '/' + (p.unit || '') })
            ])
          ]));
        });
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
      U.el('div', { class: 'card__sub', style: { marginBottom: '4px' }, text: 'Общие параметры для выбранных:' }),
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
        editing ? U.el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: save }) : addSelBtn
      ])
    ]);
    var m = U.modal(body);

    // --- Пакетное добавление выбранных (пункт 1) ---
    function addSelected() {
      if (!selected.length) { U.toast('Отметьте работы в списке', 'error'); return; }
      var qty = Number(qtyI.value) || 1;
      var coef = Number(coefI.value) || 1;
      var material = matI.checked ? 1 : 0;
      var note = noteI.value.trim();

      // Оптимистично добавляем все выбранные в кеш
      var tmpLines = selected.map(function (p, i) {
        var ld = {
          n: '', section: p.section || '', name: p.name, unit: p.unit || '',
          qty: qty, price: Number(p.price) || 0, coef: coef, material: material, note: note
        };
        ld.sum = calcLineSum(ld);
        ld.__row = 'tmp_' + Date.now() + '_' + i;
        return ld;
      });
      if (OBJ[id]) {
        OBJ[id].calc = OBJ[id].calc || [];
        tmpLines.forEach(function (ld) { OBJ[id].calc.push(ld); });
        persist(id);
      }

      // Закрываем модалку и перерисовываем из кеша — мгновенно
      addSelBtn.disabled = true; addSelBtn.classList.add('is-loading');
      m.close();
      U.toast('Добавлено: ' + tmpLines.length, 'success');
      refresh();

      // Отправляем на сервер последовательно
      var chain = Promise.resolve();
      selected.forEach(function (p) {
        var ld = {
          n: '', section: p.section || '', name: p.name, unit: p.unit || '',
          qty: qty, price: Number(p.price) || 0, coef: coef, material: material, note: note
        };
        chain = chain.then(function () {
          return apiPost('records:add', { token: Store.getToken(), objectId: id, line: ld });
        });
      });
      chain.then(function () {
        setTimeout(function () { bgSync(id); }, 300);
      }).catch(function (e) {
        U.toast(e.message || 'Ошибка отправки', 'error');
        setTimeout(function () { bgSync(id); }, 300);
      });
    }

    function save() {
      var name = nameI.value.trim();
      if (!name) { U.toast('Введите наименование', 'error'); return; }
      var btn = body.querySelector('.btn--primary');
      if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
      var lineData = {
        n: '', section: sectI.value.trim(), name: name, unit: unitI.value.trim(),
        qty: Number(qtyI.value) || 0, price: Number(priceI.value) || 0,
        coef: Number(coefI.value) || 1, material: matI.checked ? 1 : 0, note: noteI.value.trim()
      };
      lineData.sum = calcLineSum(lineData);

      // Оптимистичное обновление кеша
      if (!editing) {
        lineData.__row = 'tmp_' + Date.now(); // временный номер строки
        if (OBJ[id]) {
          OBJ[id].calc = OBJ[id].calc || [];
          OBJ[id].calc.push(lineData);
          persist(id);
        }
      } else {
        if (OBJ[id] && OBJ[id].calc) {
          OBJ[id].calc = OBJ[id].calc.map(function (r) {
            return r.__row === line.__row ? Object.assign({}, r, lineData) : r;
          });
          persist(id);
        }
      }

      // Закрываем модалку и перерисовываем из кеша — мгновенно
      m.close();
      U.toast(editing ? 'Обновлено' : 'Добавлено', 'success');
      refresh();

      // Отправляем на сервер
      var payload = { token: Store.getToken(), objectId: id, line: lineData };
      var p = editing
        ? apiPost('records:update', { token: Store.getToken(), objectId: id, rowNum: line.__row, patch: lineData })
        : apiPost('records:add', payload);
      p.then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        // Фоновая синхронизация обновит кеш с сервера
        setTimeout(function () { bgSync(id); }, 300);
      }).catch(function (e) {
        U.toast(e.message, 'error');
        setTimeout(function () { bgSync(id); }, 300);
      });
    }
  }

  /* ---------------- ЗАКУПКА ---------------- */
  function renderPurchase(root, id, data, refresh) {
    var pur = data.purchases || [];
    var total = sum(pur, function (r) { return r.sum; });

    root.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('div', { class: 'section-head__title', text: 'Закупка (' + pur.length + ')' }),
      U.el('button', { class: 'btn btn--sm btn--primary', text: '＋ Добавить', 'aria-label': 'Добавить закупку', onclick: function () { purchaseModal(id, refresh); } })
    ]));

    var listEl = U.el('div', {});
    root.appendChild(listEl);

    if (!pur.length) {
      U.emptyState(listEl, 'Нет закупок', 'Добавьте купленный материал и прикрепите фото чека.');
    } else {
      pur.forEach(function (r) {
        listEl.appendChild(U.el('div', { class: 'card' }, [
          U.el('div', { class: 'objhead' }, [
            U.el('div', { class: 'card__title', text: r.name || '—' }),
            U.el('div', { class: 'money', text: U.money(r.sum) })
          ]),
          U.el('div', { class: 'card__sub' }, [
            U.date(r.date) + (Number(r.qty) ? ' · ' + r.qty + ' шт × ' + U.money(r.price) : '')
          ]),
          r.photo ? U.el('img', { class: 'thumb thumb--block', src: r.photo, style: { marginTop: '6px' }, loading: 'lazy' }) : null,
          r.note ? U.el('div', { class: 'card__sub', text: '📝 ' + r.note }) : null,
          U.el('div', { class: 'row', style: { marginTop: '8px', justifyContent: 'flex-end' } }, [
            U.el('button', { class: 'btn btn--sm', text: '✎ Изменить', 'aria-label': 'Изменить', onclick: function () { purchaseModal(id, refresh, r); } }),
            U.el('button', { class: 'btn btn--sm btn--danger', text: '✕ Удалить', 'aria-label': 'Удалить', onclick: function () { removePurchase(id, r, refresh); } })
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
      // Оптимистичное обновление
      if (OBJ[id] && OBJ[id].purchases) {
        OBJ[id].purchases = OBJ[id].purchases.filter(function (x) { return x.__row !== r.__row; });
        persist(id);
      }
      refresh();
      apiPost('purchases:remove', { token: Store.getToken(), objectId: id, rowNum: r.__row })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); U.toast('Удалено', 'success'); setTimeout(function () { bgSync(id); }, 300); })
        .catch(function (e) { U.toast(e.message || 'Ошибка удаления', 'error'); setTimeout(function () { bgSync(id); }, 300); });
    });
  }

  function purchaseModal(id, refresh, existing) {
    var editing = !!existing;
    var dateI = U.el('input', { class: 'input', type: 'date', value: (existing && existing.date) || U.todayISO() });
    var nameI = U.el('input', { class: 'input', placeholder: 'Наименование материала' });
    var qtyI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Кол-во', value: (existing ? existing.qty : '1') || '1' });
    var priceI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Цена за ед.' });
    var noteI = U.el('textarea', { class: 'textarea', placeholder: 'Примечание' });
    // capture=environment — прямая съёмка камерой (пункт 1.1)
    var camI = U.el('input', { class: 'input', type: 'file', accept: 'image/*', capture: 'environment', 'aria-label': 'Сфотографировать чек' });
    var fileI = U.el('input', { class: 'input', type: 'file', accept: 'image/*', 'aria-label': 'Выбрать фото из галереи' });
    var preview = U.el('div', { style: { marginTop: '8px' } });
    var photoData = null; // base64 данные фото

    function showPreview(src) {
      U.clear(preview);
      if (src) preview.appendChild(U.el('img', { class: 'thumb thumb--block', src: src, style: { marginTop: '0' } }));
    }

    // Конвертация в webp через canvas (пункт 3)
    function convertToWebp(file, cb) {
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          // Проверяем поддержку webp
          var c = document.createElement('canvas');
          if (c.toDataURL('image/webp').indexOf('image/webp') === -1) {
            // webp не поддерживается — отдаём исходный base64
            cb(String(rd.result).replace(/^data:.*;base64,/, ''), rd.result);
            return;
          }
          // Конвертируем в webp
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          var webpDataUrl = c.toDataURL('image/webp', 0.85);
          var webpBase64 = webpDataUrl.replace(/^data:.*;base64,/, '');
          cb(webpBase64, webpDataUrl);
        };
        img.onerror = function () {
          cb(String(rd.result).replace(/^data:.*;base64,/, ''), rd.result);
        };
        img.src = String(rd.result);
      };
      rd.onerror = function () { cb(null, null); };
      rd.readAsDataURL(file);
    }

    function handleFile(file, input) {
      if (!file) return;
      convertToWebp(file, function (base64, dataUrl) {
        if (!base64) { U.toast('Не удалось обработать фото', 'error'); return; }
        photoData = base64;
        showPreview(dataUrl);
      });
    }

    camI.addEventListener('change', function () { handleFile(camI.files && camI.files[0], camI); });
    fileI.addEventListener('change', function () { handleFile(fileI.files && fileI.files[0], fileI); });

    var body = U.el('div', {}, [
      U.el('div', { class: 'modal__title', text: editing ? 'Редактировать закупку' : 'Новая закупка' }),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Дата' }), dateI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Наименование материала *' }), nameI]),
      U.el('div', { style: { display: 'flex', gap: '10px' } }, [
        U.el('div', { class: 'field', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Кол-во' }), qtyI]),
        U.el('div', { class: 'field', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Цена' }), priceI])
      ]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: '📷 Сфотографировать чек' }), camI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: '🖼 Выбрать из галереи' }), fileI]),
      preview,
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Примечание' }), noteI]),
      U.el('div', { class: 'row' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); } }),
        U.el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: save })
      ])
    ]);
    var m = U.modal(body);

    if (editing) {
      nameI.value = existing.name || '';
      priceI.value = existing.price || '';
      noteI.value = existing.note || '';
      if (existing.photo) showPreview(existing.photo);
    }

    function save() {
      var name = nameI.value.trim();
      if (!name) { U.toast('Введите наименование', 'error'); return; }
      var btn = body.querySelector('.btn--primary');
      btn.disabled = true; btn.classList.add('is-loading');
      var purchase = {
        date: dateI.value || U.todayISO(), name: name,
        qty: Number(qtyI.value) || 0, price: Number(priceI.value) || 0, note: noteI.value.trim()
      };
      var photo = photoData || (editing ? null : null);
      // Если редактируем и нет нового фото — сохраняем старый URL
      if (editing && !photo && existing && existing.photo) {
        purchase.photo = existing.photo;
      }

      // Оптимистичное обновление кеша
      var lineData = Object.assign({}, purchase);
      lineData.sum = Math.round((Number(purchase.price) || 0) * (Number(purchase.qty) || 0));
      if (!editing) {
        lineData.__row = 'tmp_' + Date.now();
        if (OBJ[id]) {
          OBJ[id].purchases = OBJ[id].purchases || [];
          OBJ[id].purchases.push(lineData);
          persist(id);
        }
      } else {
        if (OBJ[id] && OBJ[id].purchases) {
          OBJ[id].purchases = OBJ[id].purchases.map(function (r) {
            return r.__row === existing.__row ? Object.assign({}, r, lineData) : r;
          });
          persist(id);
        }
      }

      m.close();
      U.toast(editing ? 'Обновлено' : 'Закупка добавлена', 'success');
      refresh();

      // Отправка на сервер
      function send(photoBase64) {
        if (photoBase64) purchase.photo = photoBase64;
        var p = editing
          ? apiPost('purchases:update', { token: Store.getToken(), objectId: id, rowNum: existing.__row, purchase: purchase })
          : apiPost('purchases:add', { token: Store.getToken(), objectId: id, purchase: purchase });
        p.then(function (d) {
          if (!d.ok) throw new Error(d.error || 'Ошибка');
          setTimeout(function () { bgSync(id); }, 300);
        }).catch(function (e) {
          U.toast(e.message, 'error');
          setTimeout(function () { bgSync(id); }, 300);
        });
      }
      send(photo || null);
    }
  }

  /* ---------------- ДЕНЬ ---------------- */
  function renderDay(root, id, data, refresh) {
    var vis = data.visits || [];
    root.appendChild(U.el('div', { class: 'section-head' }, [
      U.el('div', { class: 'section-head__title', text: 'Дни работ (' + vis.length + ')' }),
      U.el('button', { class: 'btn btn--sm btn--primary', text: '＋ Добавить', 'aria-label': 'Добавить день', onclick: function () { dayModal(id, refresh); } })
    ]));
    var listEl = U.el('div', {});
    root.appendChild(listEl);
    if (!vis.length) {
      U.emptyState(listEl, 'Нет записей о днях', 'Отмечайте выезды и выполненные работы.');
    } else {
      vis.forEach(function (r) {
        listEl.appendChild(U.el('div', { class: 'card' }, [
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
      var btn = body.querySelector('.btn--primary'); btn.disabled = true; btn.classList.add('is-loading');
      var visit = { date: dateI.value || U.todayISO(), master: masterI.value.trim(), dayNumber: dayI.value.trim(), note: noteI.value.trim() };
      // Оптимистичное обновление
      if (OBJ[id]) {
        OBJ[id].visits = OBJ[id].visits || [];
        visit.__row = 'tmp_' + Date.now();
        OBJ[id].visits.push(visit);
        persist(id);
      }
      m.close(); U.toast('День добавлен', 'success'); refresh();
      apiPost('visits:add', { token: Store.getToken(), objectId: id, visit: visit })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); setTimeout(function () { bgSync(id); }, 300); })
        .catch(function (e) { U.toast(e.message, 'error'); setTimeout(function () { bgSync(id); }, 300); });
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
      var btn = U.$('.btn--danger');
      if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
      apiPost('objects:close', { token: Store.getToken(), id: id }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        U.toast('Объект закрыт', 'success');
        refresh('report');
      }).catch(function (e) { U.toast(e.message, 'error'); if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); } });
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

  return { render: render, reload: reload, bgSync: bgSync, OBJ: OBJ };
})();
