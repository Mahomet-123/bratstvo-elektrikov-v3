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
        return Promise.all(items.map(function (it) {
          return api(it.action, it.params, { queue: false, silent: true })
            .then(function () { return del(it.id); })
            .catch(function () { /* оставляем в очереди при повторной ошибке */ });
        })).then(updateBadge).then(function () { return items.length; });
      });
    },
    updateBadge: updateBadge
  };
})();

window.addEventListener('online', function () {
  if (window.Offline) {
    Offline.flush().then(function (n) { if (n > 0) U.toast('Синхронизировано операций: ' + n, 'success'); });
  }
});
