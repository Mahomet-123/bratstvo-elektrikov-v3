// offline.js — очередь мутаций в IndexedDB на случай отсутствия сети.
window.Offline = (function () {
  var DB = 'bratstvo', STORE = 'queue', dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
    return dbp;
  }
  function store(mode) { return open().then(function (db) { return db.transaction(STORE, mode).objectStore(STORE); }); }

  function add(item) {
    return store('readwrite').then(function (s) {
      return new Promise(function (res, rej) {
        var r = s.add(item); r.onsuccess = function () { res(); }; r.onerror = function () { rej(r.error); };
      });
    });
  }
  function all() {
    return store('readonly').then(function (s) {
      return new Promise(function (res, rej) {
        var r = s.getAll(); r.onsuccess = function () { res(r.result || []); }; r.onerror = function () { rej(r.error); };
      });
    });
  }
  function del(id) {
    return store('readwrite').then(function (s) {
      return new Promise(function (res, rej) {
        var r = s.delete(id); r.onsuccess = function () { res(); }; r.onerror = function () { rej(r.error); };
      });
    });
  }
  function count() { return all().then(function (a) { return a.length; }); }

  function updateBadge() {
    return count().then(function (n) {
      var b = U.$('#offlineBadge'); if (!b) return;
      if (n > 0) { b.style.display = ''; b.textContent = '⚠ Офлайн: ' + n + ' операций в очереди'; }
      else { b.style.display = 'none'; }
      try { window.dispatchEvent(new CustomEvent('be:sync', { detail: { pending: n } })); } catch (e) {}
    });
  }

  return {
    queue: function (action, params) { return add({ action: action, params: params || {}, ts: Date.now() }).then(updateBadge); },
    pending: all,
    count: count,
    flush: function () {
      return all().then(function (items) {
        if (!items.length) return { sent: 0, dropped: 0, remaining: 0 };
        return Promise.all(items.map(function (it) {
          // Важно: мутации шлём именно POST (как apiPost), иначе вложенные
          // объекты (line/purchase) превратятся в «[object Object]» при GET.
          return api(it.action, it.params, { method: 'POST', queue: false, silent: true })
            .then(function () {
              // Сервер принял — удаляем из очереди.
              return del(it.id).then(function () { return { ok: true }; });
            })
            .catch(function (err) {
              if (err && err.serverError) {
                // Логическая ошибка сервера (ok:false) — повтор бессмысленен,
                // удаляем, чтобы не висели вечно в очереди.
                return del(it.id).then(function () { return { ok: false, server: true }; });
              }
              // Сетевой сбой — оставляем в очереди для повтора.
              return { ok: false, server: false };
            });
        })).then(function (results) {
          var sent = 0, dropped = 0;
          results.forEach(function (r) {
            if (r && r.ok) sent++;
            else if (r && r.server) dropped++;
          });
          var remaining = results.length - sent - dropped;
          return updateBadge().then(function () { return { sent: sent, dropped: dropped, remaining: remaining }; });
        });
      });
    },
    updateBadge: updateBadge
  };
})();

window.addEventListener('online', function () {
  if (window.Offline) {
    Offline.flush().then(function (res) {
      res = res || {};
      if (res.sent > 0) U.toast('Синхронизировано операций: ' + res.sent, 'success');
      if (res.dropped > 0) U.toast('Не удалось отправить: ' + res.dropped + ' (ошибка сервера)', 'error');
    });
  }
});
