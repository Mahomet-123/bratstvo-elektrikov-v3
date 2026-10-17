// api.js — клиент к Web App (Google Apps Script).
// GET: параметры в query-string. POST: тело JSON с Content-Type text/plain (без CORS-preflight).
window.API_URL = 'https://script.google.com/macros/s/AKfycby-M2dqZuLWY8ltzL47x3zV3xIyv4H5-fNM0WVvKiHm5Kreta6auMz-LRj0Gf-NnrexHQ/exec';

window.api = function (action, params, opts) {
  opts = opts || {};
  var method = opts.method || 'GET';
  var url = API_URL;
  var fetchOpts = { method: method, redirect: 'follow' };
  var body = Object.assign({ action: action }, params || {});

  if (method === 'GET') {
    var qs = [];
    Object.keys(body).forEach(function (k) {
      var v = body[k];
      if (v !== undefined && v !== null && v !== '') qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    url += (url.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
  } else {
    fetchOpts.body = JSON.stringify(body);
    fetchOpts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  }

  return fetch(url, fetchOpts).then(function (r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw new Error('Некорректный ответ сервера'); }
    });
  }).then(function (data) {
    if (data && data.ok === false && data.error) {
      // сервер вернул логическую ошибку — бросаем, чтобы вызывающий обработал
      var err = new Error(data.error); err.serverError = true; throw err;
    }
    return data;
  }).catch(function (err) {
    // Сетевой сбой + это мутация → ставим в офлайн-очередь.
    if (method === 'POST' && opts.queue !== false) {
      if (window.Offline) {
        return Offline.queue(action, params).then(function () {
          return { ok: true, offline: true, queued: true };
        }).catch(function () { throw err; });
      }
    }
    if (!opts.silent) U.toast('Сетевая ошибка: ' + err.message, 'error');
    throw err;
  });
};

// Удобные обёртки.
window.apiGet = function (action, params, opts) { return api(action, params, Object.assign({ method: 'GET' }, opts)); };
window.apiPost = function (action, params, opts) { return api(action, params, Object.assign({ method: 'POST' }, opts)); };
