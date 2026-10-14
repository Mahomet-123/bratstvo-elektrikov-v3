// store.js — локальное состояние: токен, профиль, кеш прайса, тема.
window.Store = (function () {
  var K = { TOKEN: 'be_token', USER: 'be_user', PRICES: 'be_prices', THEME: 'be_theme' };
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function getJSON(k) { var s = get(k); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }
  function setJSON(k, v) { set(k, JSON.stringify(v)); }

  return {
    getToken: function () { return get(K.TOKEN); },
    setToken: function (t) { set(K.TOKEN, t || ''); },
    getUser: function () { return getJSON(K.USER); },
    setUser: function (u) { setJSON(K.USER, u); },
    isAdmin: function () { var u = this.getUser(); return !!(u && u.role === 'Руководитель'); },
    isAuthed: function () { return !!this.getToken(); },

    getPrices: function () { return getJSON(K.PRICES) || []; },
    setPrices: function (p) { setJSON(K.PRICES, p || []); },

    getTheme: function () { return get(K.THEME) || 'auto'; },
    setTheme: function (t) { set(K.THEME, t); },

    logout: function () { set(K.TOKEN, ''); set(K.USER, ''); }
  };
})();
