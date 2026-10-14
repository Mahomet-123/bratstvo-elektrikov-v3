// router.js — хеш-роутер (без зависимостей).
window.Router = (function () {
  var routes = [];

  function raw() { return location.hash.replace(/^#/, ''); }
  function path() { var r = raw(); var q = r.indexOf('?'); return q >= 0 ? r.slice(0, q) : r; }

  function match(p) {
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].pattern.exec(p);
      if (m) return { route: routes[i], params: m.slice(1) };
    }
    return null;
  }

  function render() {
    var p = path() || '/';
    var m = match(p);
    if (!m) { location.hash = '#/objects'; return; }
    m.route.handler.apply(null, m.params.map(function (x) { return decodeURIComponent(x); }));
  }

  return {
    add: function (re, handler) { routes.push({ pattern: re, handler: handler }); },
    start: function () { window.addEventListener('hashchange', render); render(); },
    go: function (h) {
      if (location.hash === h) render(); else location.hash = h;
    }
  };
})();
