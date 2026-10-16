// auth.js — вход и профиль (смена кода доступа).
window.Auth = {
  render: function () {
    var app = U.$('#app');
    U.clear(app);
    var loginI = U.el('input', { class: 'input', id: 'login', placeholder: 'Логин (напр. Руководитель)', autocomplete: 'username' });
    var codeI = U.el('input', { class: 'input', id: 'code', type: 'password', inputmode: 'numeric', placeholder: 'Код доступа', autocomplete: 'current-password' });

    function submit(e) {
      if (e) e.preventDefault();
      var login = loginI.value.trim();
      var code = codeI.value.trim();
      if (!login || !code) { U.toast('Введите логин и код', 'error'); return; }
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.classList.add('is-loading');
      apiPost('login', { login: login, code: code }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка входа');
        Store.setToken(d.token); Store.setUser(d.user);
        U.toast('Добро пожаловать, ' + (d.user.name || d.user.login) + '!', 'success');
        Router.go('#/objects');
      }).catch(function (err) {
        U.toast(err.message || 'Ошибка входа', 'error');
        btn.disabled = false; btn.classList.remove('is-loading');
      });
    }

    var form = U.el('form', { class: 'card', onsubmit: submit }, [
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Логин' }), loginI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Код доступа' }), codeI]),
      U.el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Войти' })
    ]);

    var wrap = U.el('div', { class: 'auth' }, [
      U.el('div', { class: 'auth__logo', text: '⚡' }),
      U.el('div', { class: 'auth__head' }, [
        U.el('h2', { text: 'Братство Электриков' }),
        U.el('div', { class: 'card__sub', text: 'Вход для бригады' })
      ]),
      form,
      U.el('div', { class: 'auth__hint', text: 'Код руководителя по умолчанию: 0000' })
    ]);
    app.appendChild(wrap);
    setTimeout(function () { loginI.focus(); }, 50);
  }
};

window.Profile = {
  render: function () {
    var app = U.$('#app');
    U.clear(app);
    var u = Store.getUser() || {};

    var oldI = U.el('input', { class: 'input', id: 'oldCode', type: 'password', inputmode: 'numeric', placeholder: 'Текущий код' });
    var newI = U.el('input', { class: 'input', id: 'newCode', type: 'password', inputmode: 'numeric', placeholder: 'Новый код' });
    var new2I = U.el('input', { class: 'input', id: 'newCode2', type: 'password', inputmode: 'numeric', placeholder: 'Повторите новый код' });

    function save(e) {
      e.preventDefault();
      var oldCode = oldI.value.trim();
      var newCode = newI.value.trim();
      var new2 = new2I.value.trim();
      if (!newCode) { U.toast('Введите новый код', 'error'); return; }
      if (newCode !== new2) { U.toast('Коды не совпадают', 'error'); return; }
      if (Store.isAdmin() && !oldCode) oldCode = ''; // руководитель меняет без старого
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.classList.add('is-loading');
      apiPost('users:changeCode', { login: u.login, oldCode: oldCode, newCode: newCode }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Не удалось сменить код');
        U.toast('Код доступа изменён', 'success');
        Router.go('#/objects');
      }).catch(function (err) {
        U.toast(err.message, 'error');
        btn.disabled = false; btn.classList.remove('is-loading');
      });
    }

    var form = U.el('form', { class: 'card', onsubmit: save }, [
      U.el('div', { class: 'card__title', text: 'Профиль' }),
      U.el('div', { class: 'card__sub', text: (u.name || u.login) + (u.role ? ' · ' + u.role : '') }),
      U.el('div', { style: { height: '10px' } }),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Текущий код' + (Store.isAdmin() ? ' (необязательно)' : '') }), oldI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Новый код' }), newI]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label', text: 'Повторите новый код' }), new2I]),
      U.el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Сохранить код' })
    ]);

    // Полный прайс-лист (только просмотр) — пункт 4
    function openPriceList() {
      var prices = Store.getPrices() || [];
      var work = prices.filter(function (p) { return !p.type || p.type === 'work'; });
      var searchI = U.el('input', { class: 'input', placeholder: 'Поиск в прайс-листе…' });
      var listBox = U.el('div', { class: 'pricelist', style: { maxHeight: '62vh', overflowY: 'auto' } });
      var secOpen = {};
      function renderList(q) {
        U.clear(listBox);
        var ql = (q || '').toLowerCase();
        var filtered = work.filter(function (p) { return !ql || (p.name + ' ' + p.section).toLowerCase().indexOf(ql) >= 0; });
        listBox.appendChild(U.el('div', { class: 'card__sub', style: { marginBottom: '6px' }, text: 'Всего позиций: ' + work.length + (ql ? ' · найдено: ' + filtered.length : '') }));
        if (!filtered.length) { listBox.appendChild(U.el('div', { class: 'card__sub', text: 'Ничего не найдено' })); return; }
        var bySec = {};
        filtered.forEach(function (p) { (bySec[p.section] = bySec[p.section] || []).push(p); });
        Object.keys(bySec).forEach(function (sec) {
          var open = secOpen[sec] || ql;
          var secHead = U.el('div', { class: 'pricelist__sec', style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
            U.el('span', { text: sec + ' (' + bySec[sec].length + ')' }),
            U.el('span', { text: open ? '▾' : '▸' })
          ]);
          secHead.addEventListener('click', function () { secOpen[sec] = !secOpen[sec]; renderList(q); });
          listBox.appendChild(secHead);
          if (!open) return;
          bySec[sec].forEach(function (p) {
            listBox.appendChild(U.el('div', { class: 'card pricelist__item', style: { padding: '8px 10px', marginBottom: '6px', display: 'flex', gap: '8px', alignItems: 'center' } }, [
              U.el('div', { style: { flex: '1', minWidth: '0' } }, [
                U.el('div', { style: { fontWeight: '600' }, text: p.name }),
                U.el('div', { class: 'card__sub', text: U.money(p.price) + '/' + (p.unit || '') })
              ]),
              U.el('div', { class: 'money', text: U.money(p.price) })
            ]));
          });
        });
      }
      searchI.addEventListener('input', function () { renderList(searchI.value); });
      renderList('');
      var body = U.el('div', {}, [
        U.el('div', { class: 'modal__title', text: '📋 Прайс-лист' }),
        searchI, listBox,
        U.el('div', { class: 'row' }, [
          U.el('button', { class: 'btn btn--ghost', text: 'Закрыть', onclick: function () { m.close(); } })
        ])
      ]);
      var m = U.modal(body);
    }

    app.appendChild(form);
    if (Store.isAdmin()) {
      app.appendChild(U.el('button', { class: 'btn btn--block', text: 'Панель руководителя', onclick: function () { Router.go('#/admin'); } }));
    }
    app.appendChild(U.el('button', { class: 'btn btn--block', style: { marginTop: '10px' }, text: '📋 Прайс-лист', onclick: function () { openPriceList(); } }));
  }
};
