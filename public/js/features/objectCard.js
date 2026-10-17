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
    return Math.round(price * qty * coef);
  }

  // Итог закупки с учётом наценки на материал (хранится на объекте)
  function purchaseTotal(pur, o) {
    var s = sum(pur || [], function (r) { return r.sum; });
    if (o && o.purchaseMarkup) {
      var m = s * 0.10;
      if (m < 1500) m = 1500;
      s += m;
    }
    return Math.round(s);
  }
  // Только размер наценки (0, если не применена). Логика расчёта — как в purchaseTotal.
  function purchaseMarkup(pur, o) {
    if (!o || !o.purchaseMarkup) return 0;
    var s = sum(pur || [], function (r) { return r.sum; });
    var m = s * 0.10;
    if (m < 1500) m = 1500;
    return Math.round(m);
  }

  // Горизонтальная лента фото (поддержка нескольких фото чека)
  function photoStrip(r) {
    var urls = (r.photos && r.photos.length) ? r.photos : (r.photo ? [r.photo] : []);
    if (!urls.length) return null;
    return U.el('div', { class: 'photo-grid', style: { marginTop: '6px' } }, urls.map(function (u, i) {
      return U.el('div', { class: 'photo-item' }, [
        U.el('img', { class: 'photo-item__img', src: u, loading: 'lazy', onclick: function () { if (U.lightbox) U.lightbox(urls, i); } })
      ]);
    }));
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
    if (el) { el.className = 'pill ' + syncClass(SYNC[id]) + ' objsync__btn'; el.textContent = syncLabel(SYNC[id]); }
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

  // «Отпечаток» позиции для сопоставления локальной оптимистичной записи
  // с записью, пришедшей с сервера (пока бэкенд не возвращает номер строки).
  function fingerprint(r, k) {
    if (k === 'purchases') return (r.name || '') + '|' + (r.qty || '') + '|' + (r.price || '') + '|' + (r.date || '');
    if (k === 'visits') return (r.date || '') + '|' + (r.master || '') + '|' + (r.note || '') + '|' + (r.dayNumber || '');
    return (r.name || '') + '|' + (r.qty || '') + '|' + (r.price || '') + '|' + (r.coef || '');
  }

  // Мгновенная перерисовка из кеша (без сети и без фоновой перезагрузки).
  function renderFromCache(id, active) {
    active = active || ACTIVE[id] || 'calc';
    if (OBJ[id]) show(U.$('#app'), id, OBJ[id], active);
  }

  // Повторная отправка неотправленных операций по клику на индикатор.
  function retrySync(id) {
    if (!navigator.onLine) { U.toast('Нет подключения к сети', 'error'); return; }
    setSync(id, 'saving', 0);
    Offline.flush().catch(function () {}).then(function (n) {
      if (n > 0) U.toast('Отправлено операций: ' + n, 'success');
      bgSync(id);
    });
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
      // Сохраняем локальные оптимистичные позиции, которых ещё нет на сервере
      // (отправляются/в очереди) — иначе они «исчезают», а потом появляются.
      var prev = OBJ[id] || {};
      ['calc', 'purchases', 'visits'].forEach(function (k) {
        var opt = (prev[k] || []).filter(function (r) { return r.__cid; });
        if (!opt.length) return;
        var fp = {};
        (d[k] || []).forEach(function (r) { fp[fingerprint(r, k)] = true; });
        var add = opt.filter(function (r) { return !fp[fingerprint(r, k)]; });
        if (add.length) d[k] = (d[k] || []).concat(add);
      });
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
        U.el('button', { id: 'objSync', type: 'button', class: 'pill ' + syncClass(SYNC[id]) + ' objsync__btn', text: syncLabel(SYNC[id]), 'aria-label': 'Повторить отправку', onclick: function () { retrySync(id); } }),
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
          U.el('div', { class: 'line-actions' }, [
            U.el('div', { class: 'card__sub line-actions__text' }, [
              (Number(r.qty) || 0) + ' ' + (r.unit || '') + ' × ' + U.money(r.price) +
              (Number(r.coef) && Number(r.coef) != 1 ? ' × ' + r.coef : '') +
              (r.from == 1 ? ' · с' : '')
            ]),
            U.el('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '2px' } }, [
              U.el('button', { class: 'iconbtn iconbtn--sm', 'aria-label': 'Изменить', title: 'Изменить', text: '✎', onclick: function () { calcModal(id, r, refresh); } }),
              U.el('button', { class: 'iconbtn iconbtn--sm iconbtn--danger', 'aria-label': 'Удалить', title: 'Удалить', text: '✕', onclick: function () { removeCalc(id, r, refresh); } })
            ])
          ]),
          r.note ? U.el('div', { class: 'card__sub', text: '📝 ' + r.note }) : null
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
      renderFromCache(id, 'calc');
      apiPost('records:remove', { token: Store.getToken(), objectId: id, rowNum: r.__row })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); U.toast('Удалено', 'success'); bgSync(id); })
        .catch(function (e) { U.toast(e.message, 'error'); bgSync(id); });
    });
  }

  function calcModal(id, line, refresh) {
    var prices = Store.getPrices();
    var editing = !!line;

    var searchI = U.el('input', { class: 'input', placeholder: 'Поиск в прайс-листе…' });
    var listBox = U.el('div', { class: 'pricelist', style: { flex: '1 1 auto', minHeight: '260px', overflowY: 'auto', marginBottom: '0' } });
    var nameI = U.el('input', { class: 'input', placeholder: 'Наименование' });
    // Ед. изм. — компактный выпадающий список (собираем уникальные значения из прайса)
    var unitI = U.el('select', { class: 'select' });
    (function buildUnits() {
      var common = ['шт', 'м', 'м²', 'м³', 'кг', 'компл', 'уп', 'час', 'точка', 'пара'];
      var extra = {}; prices.forEach(function (p) { if (p.unit && common.indexOf(p.unit) < 0) extra[p.unit] = true; });
      ['—'].concat(common, Object.keys(extra)).forEach(function (u) {
        unitI.appendChild(U.el('option', { value: u === '—' ? '' : u, text: u }));
      });
      // При редактировании — гарантируем, что единица из существующей строки есть в списке
      if (editing && line && line.unit && !Array.prototype.some.call(unitI.options, function (o) { return o.value === line.unit; })) {
        unitI.appendChild(U.el('option', { value: line.unit, text: line.unit }));
      }
    })();
    var qtyI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Кол-во', value: '1' });
    var priceI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Цена' });
    var coefI = U.el('input', { class: 'input', type: 'number', step: 'any', value: '1', placeholder: 'Коэфф.' });
    var noteI = U.el('textarea', { class: 'textarea', placeholder: 'Примечание' });

    // --- Множественный выбор (пункт 1/2): тап по строке = выбор; общие инпуты
    // редактируют активную выбранную позицию, данные сохраняются за каждой. ---
    var selected = []; // [{ p, qty, coef, price, note }]
    var active = null; // активная выбранная позиция (чьи данные сейчас в инпутах)
    // ВАЖНО: ключ — сам объект прайс-позиции. В обычном объекте {} ключ бы
    // привёлся к "[object Object]" и все записи перезаписывали бы одну — поэтому Map
    // (хранит ссылочную идентичность, itemMap.get(p) всегда возвращает свой элемент).
    var itemMap = new Map(); // p -> элемент строки прайс-листа (для подсветки/свечения при выборе)

    function findSel(p) { return selected.filter(function (s) { return s.p === p; })[0]; }
    function isSelected(p) { return !!findSel(p); }

    function setActive(s) {
      active = s;
      if (!s) return;
      nameI.value = s.p.name; unitI.value = s.p.unit || '';
      qtyI.value = s.qty; priceI.value = s.price; coefI.value = s.coef; noteI.value = s.note || '';
    }
    function syncInputsToActive() {
      if (!active) return;
      active.qty = Number(qtyI.value) || 1;
      active.coef = Number(coefI.value) || 1;
      active.price = Number(priceI.value) || 0;
      active.note = noteI.value.trim();
    }

    function toggleSel(p) {
      var ex = findSel(p);
      if (ex) {
        selected = selected.filter(function (s) { return s !== ex; });
        if (active === ex) { active = selected[selected.length - 1] || null; setActive(active); }
      } else {
        var s = { p: p, qty: 1, coef: 1, price: Number(p.price) || 0, note: '' };
        selected.push(s);
        setActive(s);
      }
      var el = itemMap.get(p);
      if (el) {
        var sel = isSelected(p);
        el.classList.toggle('pricelist__item--selected', sel);
        el.setAttribute('aria-pressed', sel ? 'true' : 'false');
        el.setAttribute('aria-label', (sel ? 'Снять выбор: ' : 'Выбрать: ') + p.name);
      }
      updateSelBtn();
    }

    var addSelBtn = U.el('button', { class: 'btn btn--primary', text: 'Добавить выбранные (0)', disabled: 'disabled', onclick: addSelected });

    function updateSelBtn() {
      var manual = !!nameI.value.trim();
      addSelBtn.textContent = selected.length ? 'Добавить выбранные (' + selected.length + ')' : 'Добавить';
      if (selected.length > 0 || manual) addSelBtn.removeAttribute('disabled');
      else addSelBtn.setAttribute('disabled', 'disabled');
    }
    nameI.addEventListener('input', updateSelBtn);

    // правки в инпутах сразу сохраняются в активную выбранную позицию
    [qtyI, coefI, priceI, noteI].forEach(function (inp) {
      inp.addEventListener('input', syncInputsToActive);
    });

    var secOpen = {}; // разделы свёрнуты по умолчанию
    function renderList(q) {
      U.clear(listBox);
      itemMap.clear();
      var ql = (q || '').toLowerCase();
      var work = prices.filter(function (p) {
        if (p.type && p.type !== 'work') return false;
        return !ql || (p.name + ' ' + p.section).toLowerCase().indexOf(ql) >= 0;
      });
      listBox.appendChild(U.el('div', { class: 'card__sub', style: { marginBottom: '6px' }, text: 'Найдено работ: ' + work.length }));
      if (!work.length) { listBox.appendChild(U.el('div', { class: 'card__sub', text: 'Ничего не найдено' })); return; }
      var bySec = {};
      work.forEach(function (p) { (bySec[p.section] = bySec[p.section] || []).push(p); });
      Object.keys(bySec).forEach(function (sec) {
        var open = secOpen[sec] || ql; // при поиске — раскрываем все разделы
        var secHead = U.el('div', { class: 'pricelist__sec', style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
          U.el('span', { text: sec + ' (' + bySec[sec].length + ')' }),
          U.el('span', { text: open ? '▾' : '▸' })
        ]);
        secHead.addEventListener('click', function () { secOpen[sec] = !secOpen[sec]; renderList(q); });
        listBox.appendChild(secHead);
        if (!open) return;
        bySec[sec].forEach(function (p) {
          // Чекбокс и кружок-индикатор убраны ради компактности.
          // Выбор показывается только мягким свечением и акцентной левой полосой
          // через класс .pricelist__item--selected (см. style.css).
          var itemEl = U.el('div', {
            class: 'card pricelist__item' + (isSelected(p) ? ' pricelist__item--selected' : ''),
            role: 'button', tabindex: '0', 'aria-pressed': isSelected(p) ? 'true' : 'false', 'aria-label': (isSelected(p) ? 'Снять выбор: ' : 'Выбрать: ') + p.name,
            style: { padding: '8px 10px', marginBottom: '6px', cursor: 'pointer' },
            onclick: function () { toggleSel(p); },
            onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSel(p); } }
          }, [
            U.el('div', { style: { fontWeight: '600' }, text: p.name }),
            U.el('div', { class: 'card__sub', text: U.money(p.price) + '/' + (p.unit || '') })
          ]);
          itemMap.set(p, itemEl);
          listBox.appendChild(itemEl);
        });
      });
    }
    searchI.addEventListener('input', function () { renderList(searchI.value); });
    renderList('');

    if (editing) {
      nameI.value = line.name || ''; unitI.value = line.unit || '';
      qtyI.value = line.qty; priceI.value = line.price; coefI.value = line.coef || 1;
      noteI.value = line.note || '';
    }

    // Шапка (фиксированная): заголовок + поиск. Подвал (фиксированный):
    // поля + кнопки. Между ними прокручивается только список прайса.
    // Подвал компактный: без шапки «Общие параметры…», без подписи «Наименование»
    // (placeholder достаточно), «Коэф.» — в одном ряду с Ед./Кол-во/Цена (4 колонки),
    // чтобы список получал максимум места (на больших экранах ~3.5–4 работы видны).
    var header = U.el('div', { class: 'calc-modal__head' }, [
      U.el('div', { class: 'modal__title', text: editing ? 'Редактировать позицию' : 'Новая позиция' }),
      searchI
    ]);
    var footer = U.el('div', { class: 'calc-modal__foot' }, [
      U.el('div', { class: 'field field--sm' }, [nameI]),
      U.el('div', { style: { display: 'flex', gap: '10px' } }, [
        U.el('div', { class: 'field field--sm', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Ед.' }), unitI]),
        U.el('div', { class: 'field field--sm', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Кол-во' }), qtyI]),
        U.el('div', { class: 'field field--sm', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Цена' }), priceI]),
        U.el('div', { class: 'field field--sm', style: { flex: '1' } }, [U.el('label', { class: 'field__label', text: 'Коэф.' }), coefI])
      ]),
      U.el('div', { class: 'field field--sm' }, [U.el('label', { class: 'field__label', text: 'Примечание' }), noteI]),
      U.el('div', { class: 'row' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); } }),
        editing ? U.el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: save }) : addSelBtn
      ])
    ]);
    var body = U.el('div', { class: 'calc-modal' }, [ header, listBox, footer ]);
    var m = U.modal(body);

    // --- Пакетное добавление выбранных (пункт 1) ---
    function addSelected() {
      var lines = [];
      if (selected.length) {
        // Каждая выбранная позиция несёт свои сохранённые данные
        selected.forEach(function (s) {
          lines.push({
            n: '', section: s.p.section || '', name: s.p.name, unit: s.p.unit || '',
            qty: s.qty, price: s.price, coef: s.coef, note: s.note || ''
          });
        });
      } else {
        // Ручной ввод одной позиции
        var nm = nameI.value.trim();
        if (!nm) { U.toast('Отметьте работы в списке или введите наименование', 'error'); return; }
        lines.push({
          n: '', section: '', name: nm, unit: unitI.value.trim(),
          qty: Number(qtyI.value) || 1, price: Number(priceI.value) || 0,
          coef: Number(coefI.value) || 1, note: noteI.value.trim()
        });
      }
      lines.forEach(function (ld) { ld.sum = calcLineSum(ld); });

      // Оптимистично добавляем все в кеш
      if (OBJ[id]) {
        OBJ[id].calc = OBJ[id].calc || [];
        lines.forEach(function (ld) {
          ld.__row = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          ld.__cid = 'c_' + ld.__row; ld.__tmp = true;
          OBJ[id].calc.push(ld);
        });
        persist(id);
      }

      // Закрываем модалку и перерисовываем из кеша — мгновенно
      addSelBtn.disabled = true; addSelBtn.classList.add('is-loading');
      m.close();
      U.toast('Добавлено: ' + lines.length, 'success');
      renderFromCache(id, 'calc');

      // Отправляем на сервер последовательно
      var chain = Promise.resolve();
      lines.forEach(function (ld) {
        var send = Object.assign({}, ld); delete send.__row; delete send.__cid; delete send.__tmp;
        chain = chain.then(function () {
          return apiPost('records:add', { token: Store.getToken(), objectId: id, line: send });
        });
      });
      chain.then(function () {
        bgSync(id);
      }).catch(function (e) {
        U.toast(e.message || 'Ошибка отправки', 'error');
        bgSync(id);
      });
    }

    function save() {
      var name = nameI.value.trim();
      if (!name) { U.toast('Введите наименование', 'error'); return; }
      var btn = body.querySelector('.btn--primary');
      if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
      var lineData = {
        n: '', section: '', name: name, unit: unitI.value.trim(),
        qty: Number(qtyI.value) || 0, price: Number(priceI.value) || 0,
        coef: Number(coefI.value) || 1, note: noteI.value.trim()
      };
      lineData.sum = calcLineSum(lineData);

      // Оптимистичное обновление кеша
      if (!editing) {
        lineData.__row = 'tmp_' + Date.now(); // временный номер строки
        lineData.__cid = 'c_' + lineData.__row; lineData.__tmp = true;
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
      renderFromCache(id, 'calc');

      // Отправляем на сервер
      var sendData = Object.assign({}, lineData); delete sendData.__cid; delete sendData.__tmp;
      var p = editing
        ? apiPost('records:update', { token: Store.getToken(), objectId: id, rowNum: line.__row, patch: sendData })
        : apiPost('records:add', { token: Store.getToken(), objectId: id, line: sendData });
      p.then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка');
        // Фоновая синхронизация обновит кеш с сервера
        bgSync(id);
      }).catch(function (e) {
        U.toast(e.message, 'error');
        bgSync(id);
      });
    }
  }

  /* ---------------- ЗАКУПКА ---------------- */
  function renderPurchase(root, id, data, refresh) {
    var pur = data.purchases || [];
    var total = purchaseTotal(pur, data.object);
    var markup = purchaseMarkup(pur, data.object);

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
          U.el('div', { class: 'line-actions' }, [
            U.el('div', { class: 'card__sub line-actions__text' }, [
              U.date(r.date) + (Number(r.qty) ? ' · ' + r.qty + ' шт × ' + U.money(r.price) : '')
            ]),
            U.el('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '2px' } }, [
              U.el('button', { class: 'iconbtn iconbtn--sm', 'aria-label': 'Изменить', title: 'Изменить', text: '✎', onclick: function () { purchaseModal(id, refresh, r); } }),
              U.el('button', { class: 'iconbtn iconbtn--sm iconbtn--danger', 'aria-label': 'Удалить', title: 'Удалить', text: '✕', onclick: function () { removePurchase(id, r, refresh); } })
            ])
          ]),
          photoStrip(r),
          r.note ? U.el('div', { class: 'card__sub', text: '📝 ' + r.note }) : null
        ]));
      });
    }

    root.appendChild(U.el('div', { class: 'totals totals--3col' }, [
      U.el('div', { class: 'totals__cell' }, [
        U.el('div', { class: 'totals__label', text: 'Итог закупки' }),
        U.el('div', { class: 'totals__value money', text: U.money(total) })
      ]),
      U.el('div', {
        class: 'totals__cell totals__cell--clickable' + (data.object.purchaseMarkup ? '' : ' totals__cell--off'),
        title: 'Клик — вкл/выкл наценку на материал',
        onclick: function () { togglePurchaseMarkup(id); }
      }, [
        U.el('div', { class: 'totals__label', text: 'Наценка' }),
        U.el('div', { class: 'totals__value money', text: U.money(markup) }),
        U.el('div', { class: 'totals__hint', text: data.object.purchaseMarkup ? 'вкл · клик для выкл' : 'выкл · клик для вкл' })
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
      renderFromCache(id, 'purchase');
      apiPost('purchases:remove', { token: Store.getToken(), objectId: id, rowNum: r.__row })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); U.toast('Удалено', 'success'); bgSync(id); })
        .catch(function (e) { U.toast(e.message || 'Ошибка удаления', 'error'); bgSync(id); });
    });
  }

  // Клик по ячейке «Наценка» в сводке закупки — вкл/выкл наценки на материал.
  // Аналогично переключателю в модалке, но с мгновенной перерисовкой вкладки.
  function togglePurchaseMarkup(id) {
    var obj = OBJ[id] && OBJ[id].object;
    if (!obj) return;
    var on = obj.purchaseMarkup ? 0 : 1;
    obj.purchaseMarkup = on;
    persist(id);
    renderFromCache(id, 'purchase'); // мгновенно пересчитываем итоги из кеша
    apiPost('objects:update', { token: Store.getToken(), id: id, patch: { purchaseMarkup: on } })
      .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); })
      .catch(function () { /* фоновая синхронизация исправит */ });
  }

  function purchaseModal(id, refresh, existing) {
    var editing = !!existing;
    var data = OBJ[id] || {};
    var obj = data.object || {};

    var dateI = U.el('input', { class: 'input', type: 'date', value: (existing && existing.date) || U.todayISO() });
    var noteI = U.el('textarea', { class: 'textarea', placeholder: 'Примечание' });

    // Наценка на материал — хранится на уровне объекта
    var markupI = U.el('input', { type: 'checkbox' });
    markupI.checked = !!obj.purchaseMarkup;

    // Фото чеков (несколько)
    var photos = []; // [{ dataUrl, base64 }]
    var photoGrid = U.el('div', { class: 'photo-grid' });
    var fileI = U.el('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });

    function addPhoto(dataUrl) {
      photos.push({ dataUrl: dataUrl, base64: String(dataUrl).replace(/^data:.*;base64,/, '') });
      renderPhotos();
    }
    function renderPhotos() {
      U.clear(photoGrid);
      var urls = photos.map(function (p) { return p.dataUrl; });
      photos.forEach(function (ph, idx) {
        photoGrid.appendChild(U.el('div', { class: 'photo-item' }, [
          U.el('img', { class: 'photo-item__img', src: ph.dataUrl, loading: 'lazy', onclick: function () { if (U.lightbox) U.lightbox(urls, idx); } }),
          U.el('button', { class: 'photo-item__del', 'aria-label': 'Удалить фото', text: '✕', onclick: function () { photos.splice(idx, 1); renderPhotos(); } })
        ]));
      });
    }

    // Конвертация в webp через canvas
    function convertToWebp(file, cb) {
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          var c = document.createElement('canvas');
          if (c.toDataURL('image/webp').indexOf('image/webp') === -1) {
            cb(String(rd.result).replace(/^data:.*;base64,/, ''), rd.result);
            return;
          }
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
          var webpDataUrl = c.toDataURL('image/webp', 0.85);
          cb(webpDataUrl.replace(/^data:.*;base64,/, ''), webpDataUrl);
        };
        img.onerror = function () { cb(String(rd.result).replace(/^data:.*;base64,/, ''), rd.result); };
        img.src = String(rd.result);
      };
      rd.onerror = function () { cb(null, null); };
      rd.readAsDataURL(file);
    }
    function processFile(file) {
      if (!file) return;
      convertToWebp(file, function (base64, dataUrl) {
        if (!base64) { U.toast('Не удалось обработать фото', 'error'); return; }
        addPhoto(dataUrl);
      });
    }
    fileI.addEventListener('change', function () {
      Array.prototype.forEach.call(fileI.files || [], processFile);
      fileI.value = '';
    });

    // Камера: getUserMedia с фолбэком на input[capture]
    function openCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fallbackCamera(); return; }
      var streamRef = { s: null };
      var video = U.el('video', { class: 'camera-overlay__video', autoplay: true, playsinline: true });
      video.muted = true;
      var previewImg = U.el('img', { class: 'camera-overlay__preview', alt: 'Предпросмотр', style: { display: 'none' } });
      var capBtn = U.el('button', { class: 'btn btn--primary', text: '📷 Снять' });
      var overlay = U.el('div', { class: 'camera-overlay' }, [
        U.el('div', { class: 'camera-overlay__bar' }, [
          U.el('button', { class: 'iconbtn', 'aria-label': 'Закрыть', text: '✕', onclick: closeCam }),
          U.el('div', { class: 'camera-overlay__title', text: 'Фото чека' }),
          U.el('span', { style: { width: '38px' } })
        ]),
        U.el('div', { class: 'camera-overlay__stage' }, [video, previewImg]),
        U.el('div', { class: 'camera-overlay__hint', text: 'Нажмите «Снять», чтобы добавить фото. Можно сделать несколько — они все прикрепятся.' }),
        U.el('div', { class: 'camera-overlay__actions' }, [
          capBtn,
          U.el('button', { class: 'btn btn--ghost', text: '✓ Готово', onclick: closeCam })
        ])
      ]);
      function closeCam() {
        try { if (streamRef.s) streamRef.s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      function capture() {
        try {
          var c = document.createElement('canvas');
          c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720;
          var ctx = c.getContext('2d'); ctx.drawImage(video, 0, 0, c.width, c.height);
          var url = c.toDataURL('image/webp', 0.85);
          addPhoto(url);                 // сразу добавляем в ленту
          previewImg.src = url;           // и сразу показываем результат
          previewImg.style.display = 'block';
          capBtn.textContent = '📷 Ещё снимок';
        } catch (e) { U.toast('Не удалось снять фото', 'error'); }
      }
      capBtn.addEventListener('click', capture);
      document.body.appendChild(overlay);
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
        streamRef.s = stream; video.srcObject = stream;
      }).catch(function () { closeCam(); fallbackCamera(); });
    }
    function fallbackCamera() {
      var f = U.el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
      document.body.appendChild(f);
      f.addEventListener('change', function () { if (f.files && f.files[0]) processFile(f.files[0]); if (f.parentNode) f.parentNode.removeChild(f); });
      f.click();
    }

    // Строки материалов (несколько)
    var matBox = U.el('div', {});
    var rows = [];
    function addRow(preset) {
      preset = preset || {};
      var nameI = U.el('input', { class: 'input', placeholder: 'Наименование', value: preset.name || '' });
      var qtyI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Кол-во', value: preset.qty != null ? preset.qty : '1' });
      var priceI = U.el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Цена', value: preset.price != null ? preset.price : '' });
      var rowEl = U.el('div', { class: 'matrow' }, [
        nameI, qtyI, priceI,
        U.el('button', { class: 'iconbtn iconbtn--danger', 'aria-label': 'Удалить строку', text: '✕', onclick: function () {
          if (matBox.contains(rowEl)) matBox.removeChild(rowEl);
          rows = rows.filter(function (r) { return r.rowEl !== rowEl; });
        } })
      ]);
      rows.push({ nameI: nameI, qtyI: qtyI, priceI: priceI, rowEl: rowEl });
      matBox.appendChild(rowEl);
    }
    addRow(); addRow(); addRow(); // по умолчанию 3 строки

    var body = U.el('div', {}, [
      U.el('div', { class: 'modal__title', text: editing ? 'Редактировать закупку' : 'Новая закупка' }),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Дата' }), dateI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Материалы (наименование / кол-во / цена)' }), matBox]),
      U.el('button', { class: 'btn btn--ghost btn--sm', text: '＋ Добавить строку', 'aria-label': 'Добавить строку', onclick: function () { addRow(); } }),
      U.el('label', { class: 'checkbox', style: { margin: '10px 0' } }, [markupI, U.el('span', { text: 'Наценка на материал (+10%, мин. 1500 ₽)' })]),
      U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field__label', text: 'Фото чеков' }),
        U.el('div', { style: { display: 'flex', gap: '8px' } }, [
          U.el('button', { class: 'btn btn--block', text: '📷 Камера', 'aria-label': 'Камера', onclick: openCamera }),
          U.el('button', { class: 'btn btn--block', text: '🖼 Галерея', 'aria-label': 'Галерея', onclick: function () { fileI.click(); } })
        ]),
        photoGrid, fileI
      ]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Примечание' }), noteI]),
      U.el('div', { class: 'row' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); } }),
        U.el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: save })
      ])
    ]);
    var m = U.modal(body);

    if (editing) {
      U.clear(matBox); rows = [];
      addRow({ name: existing.name || '', qty: existing.qty, price: existing.price });
      noteI.value = existing.note || '';
      if (existing.photos && existing.photos.length) existing.photos.forEach(function (u) { addPhoto(u); });
      else if (existing.photo) addPhoto(existing.photo);
    }

    // наценка на материал сохраняется на уровень объекта и влияет на итоги
    markupI.addEventListener('change', function () {
      var on = markupI.checked;
      if (OBJ[id] && OBJ[id].object) OBJ[id].object.purchaseMarkup = on ? 1 : 0;
      persist(id);
      apiPost('objects:update', { token: Store.getToken(), id: id, patch: { purchaseMarkup: on } })
        .catch(function () { /* фоновая синхронизация исправит */ });
    });

    function save() {
      var valid = rows.filter(function (r) { return r.nameI.value.trim(); });
      if (!valid.length) { U.toast('Добавьте хотя бы одно наименование', 'error'); return; }
      var btn = body.querySelector('.btn--primary');
      btn.disabled = true; btn.classList.add('is-loading');
      var date = dateI.value || U.todayISO();
      var note = noteI.value.trim();
      var photoBase64 = photos.map(function (p) { return p.base64; });

      if (editing) {
        // редактирование — обновляем существующую запись первой строкой
        var r0 = valid[0];
        var ep = Number(r0.priceI.value) || 0, eq = Number(r0.qtyI.value) || 0;
        var upd = { date: date, name: r0.nameI.value.trim(), qty: eq, price: ep, note: note, photos: photoBase64 };
        if (OBJ[id] && OBJ[id].purchases) {
          OBJ[id].purchases = OBJ[id].purchases.map(function (x) {
            return x.__row === existing.__row ? Object.assign({}, x, {
              name: upd.name, qty: upd.qty, price: upd.price, note: upd.note, date: upd.date,
              photos: photos.map(function (p) { return p.dataUrl; }),
              photo: photos.length ? photos[0].dataUrl : null,
              sum: Math.round(ep * eq)
            }) : x;
          });
          persist(id);
        }
        m.close(); U.toast('Обновлено', 'success'); renderFromCache(id, 'purchase');
        apiPost('purchases:update', { token: Store.getToken(), objectId: id, rowNum: existing.__row, purchase: upd })
          .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); bgSync(id); })
          .catch(function (e) { U.toast(e.message, 'error'); bgSync(id); });
        return;
      }

      // добавляем все непустые строки как отдельные закупки
      var tmpLines = valid.map(function (r) {
        var price = Number(r.priceI.value) || 0, qty = Number(r.qtyI.value) || 0;
        return {
          name: r.nameI.value.trim(), qty: qty, price: price, note: note, date: date,
          sum: Math.round(price * qty),
          photos: photos.map(function (p) { return p.dataUrl; }),
          photo: photos.length ? photos[0].dataUrl : null
        };
      });
      if (OBJ[id]) {
        OBJ[id].purchases = OBJ[id].purchases || [];
        tmpLines.forEach(function (ld) {
          ld.__row = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          ld.__cid = 'c_' + ld.__row; ld.__tmp = true;
          OBJ[id].purchases.push(ld);
        });
        persist(id);
      }
      m.close();
      U.toast('Закупка добавлена: ' + tmpLines.length, 'success');
      renderFromCache(id, 'purchase');

      var chain = Promise.resolve();
      tmpLines.forEach(function (ld) {
        var send = Object.assign({}, ld); delete send.__row; delete send.__cid; delete send.__tmp;
        var purchase = { date: send.date, name: send.name, qty: send.qty, price: send.price, note: send.note, photos: photoBase64 };
        chain = chain.then(function () {
          return apiPost('purchases:add', { token: Store.getToken(), objectId: id, purchase: purchase });
        });
      });
      chain.then(function () { bgSync(id); })
           .catch(function (e) { U.toast(e.message || 'Ошибка отправки', 'error'); bgSync(id); });
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
        visit.__cid = 'c_' + visit.__row; visit.__tmp = true;
        OBJ[id].visits.push(visit);
        persist(id);
      }
      m.close(); U.toast('День добавлен', 'success'); renderFromCache(id, 'day');
      var sendVisit = Object.assign({}, visit); delete sendVisit.__cid; delete sendVisit.__tmp;
      apiPost('visits:add', { token: Store.getToken(), objectId: id, visit: sendVisit })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'Ошибка'); bgSync(id); })
        .catch(function (e) { U.toast(e.message, 'error'); bgSync(id); });
    }
  }

  /* ---------------- ОТЧЁТ ---------------- */
  function renderReport(root, id, data, refresh) {
    var o = data.object || {};
    var calcTotal = sum(data.calc || [], function (r) { return r.sum; });
    if (o.commissioning == 1) calcTotal = Math.round(calcTotal * 1.30);
    var purTotal = purchaseTotal(data.purchases || [], data.object);
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
    if (o.purchaseMarkup) root.appendChild(U.el('div', { class: 'card__sub', text: '💰 Учтена наценка на материал +10% (мин. 1500 ₽).' }));
    if (o.closedAt) root.appendChild(U.el('div', { class: 'card__sub', text: 'Закрыт: ' + U.datetime(o.closedAt) }));

    if (Store.isAdmin()) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__title', text: 'Действия руководителя' }),
        o.status !== 'закрыт' ? U.el('button', { class: 'btn btn--danger btn--block', text: 'Закрыть объект', style: { marginBottom: '8px' }, onclick: function () { closeObject(id, refresh); } }) : null,
        U.el('button', { class: 'btn btn--block', text: '🔗 Создать ссылку для клиента', onclick: function (e) { createCabinet(id, e.currentTarget); } })
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

  function createCabinet(id, btn) {
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    apiPost('cabinet:create', { token: Store.getToken(), id: id }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'Ошибка');
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
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
