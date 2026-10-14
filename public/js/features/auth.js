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
      btn.disabled = true; btn.textContent = 'Вход…';
      apiPost('login', { login: login, code: code }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Ошибка входа');
        Store.setToken(d.token); Store.setUser(d.user);
        U.toast('Добро пожаловать, ' + (d.user.name || d.user.login) + '!', 'success');
        Router.go('#/objects');
      }).catch(function (err) {
        U.toast(err.message || 'Ошибка входа', 'error');
        btn.disabled = false; btn.textContent = 'Войти';
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
      btn.disabled = true; btn.textContent = 'Сохранение…';
      apiPost('users:changeCode', { login: u.login, oldCode: oldCode, newCode: newCode }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Не удалось сменить код');
        U.toast('Код доступа изменён', 'success');
        Router.go('#/objects');
      }).catch(function (err) {
        U.toast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Сохранить код';
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

    app.appendChild(form);
    if (Store.isAdmin()) {
      app.appendChild(U.el('button', { class: 'btn btn--block', text: 'Панель руководителя', onclick: function () { Router.go('#/admin'); } }));
    }
  }
};
