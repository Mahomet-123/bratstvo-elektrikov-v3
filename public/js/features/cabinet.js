// cabinet.js — публичный кабинет клиента (без входа), по токену.
window.Cabinet = {
  render: function (token) {
    var app = U.$('#app');
    U.loading(app, 'Загрузка кабинета…');
    apiGet('cabinet', { cabinet: token }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'Кабинет недоступен');
      show(app, d.cabinet);
    }).catch(function (err) {
      U.emptyState(app, 'Кабинет недоступен', String(err && err.message || err));
    });
  }
};

function show(app, cab) {
  U.clear(app);
  var o = cab.object || {};
  app.appendChild(U.el('div', { class: 'cabinet' }, [
    U.el('div', { class: 'cabinet__brand' }, [
      U.el('div', { class: 'cabinet__brand-logo', text: '⚡' }),
      U.el('div', { style: { fontWeight: '700', fontSize: '18px' }, text: 'Братство Электриков' })
    ]),
    U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__title', text: o.name || 'Объект' }),
      o.code ? U.el('div', { class: 'objhead__code', text: o.code }) : null,
      o.client ? U.el('div', { class: 'card__sub', text: 'Клиент: ' + o.client }) : null,
      o.address ? U.el('div', { class: 'card__sub', text: '📍 ' + o.address }) : null
    ]),
    U.el('div', { class: 'totals' }, [
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Итого к оплате' }), U.el('div', { class: 'totals__value money', text: U.money(cab.total) })]),
      U.el('div', { class: 'totals__cell' }, [U.el('div', { class: 'totals__label', text: 'Позиций' }), U.el('div', { class: 'totals__value', text: String((cab.calc || []).length) })])
    ]),
    // --- Смета ---
    U.el('div', { class: 'section-head' }, [U.el('div', { class: 'section-head__title', text: 'Смета' })]),
    (cab.calc && cab.calc.length) ? renderTable(cab.calc) : U.el('div', { class: 'card card__sub', style: { textAlign: 'center' }, text: 'Позиций пока нет' }),
    // --- Закупки (материалы и фото накладных) ---
    U.el('div', { class: 'section-head', style: { marginTop: '14px' } }, [U.el('div', { class: 'section-head__title', text: 'Закупки материалов' })]),
    (cab.purchases && cab.purchases.length) ? renderPurchases(cab.purchases) : U.el('div', { class: 'card card__sub', style: { textAlign: 'center' }, text: 'Закупок пока нет' }),
    U.el('div', { class: 'card__sub', style: { marginTop: '14px', textAlign: 'center' }, text: 'Документ сформирован автоматически. Всего доброго!' })
  ]));
}

function renderTable(calc) {
  var rows = calc.map(function (r) {
    return U.el('tr', {}, [
      U.el('td', { text: r.name || '' }),
      U.el('td', { class: 'right', text: String(Number(r.qty) || 0) }),
      U.el('td', { class: 'right money', text: U.money(r.price) }),
      U.el('td', { class: 'right money', text: U.money(r.sum) })
    ]);
  });
  return U.el('div', { class: 'card', style: { overflowX: 'auto' } }, [
    U.el('table', { class: 'table' }, [
      U.el('thead', {}, [U.el('tr', {}, [U.el('th', { text: 'Наименование' }), U.el('th', { class: 'right', text: 'Кол-во' }), U.el('th', { class: 'right', text: 'Цена' }), U.el('th', { class: 'right', text: 'Сумма' })])]),
      U.el('tbody', {}, rows)
    ])
  ]);
}

function renderPurchases(purchases) {
  var cards = purchases.map(function (r) {
    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'objhead' }, [
        U.el('div', { class: 'card__title', text: r.name || '—' }),
        U.el('div', { class: 'money', text: U.money(r.sum) })
      ]),
      U.el('div', { class: 'card__sub' }, [
        U.date(r.date) + (Number(r.qty) ? ' · ' + r.qty + ' шт × ' + U.money(r.price) : '')
      ]),
      (function () {
        var urls = (r.photos && r.photos.length) ? r.photos : (r.photo ? [r.photo] : []);
        if (!urls.length) return null;
        return U.el('div', { class: 'photo-grid', style: { marginTop: '6px' } }, urls.map(function (u, i) {
          return U.el('div', { class: 'photo-item' }, [
            U.el('img', { class: 'photo-item__img', src: u, loading: 'lazy', alt: 'Фото накладной', onclick: function () { if (U.lightbox) U.lightbox(urls, i); } })
          ]);
        }));
      })(),
      r.note ? U.el('div', { class: 'card__sub', text: '📝 ' + r.note }) : null
    ]);
  });
  // Оборачиваем в контейнер
  var wrap = U.el('div', {});
  cards.forEach(function (c) { wrap.appendChild(c); });
  return wrap;
}
