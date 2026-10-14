// Router.gs — REST-точка входа (doGet/doPost) и диспетчеризация действий.
// Фронтенд (PWA) стучится сюда; каждое действие требует/не требует токен.

function doGet(e) {
  return Router_handle(e);
}
function doPost(e) {
  return Router_handle(e);
}
function doOptions(e) {
  return json_({ ok: true });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Собирает параметры из GET (e.parameter) или POST (JSON-тело)
function Router_params(e) {
  var p = {};
  if (e && e.parameter) {
    for (var k in e.parameter) p[k] = e.parameter[k];
  }
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var k2 in body) p[k2] = body[k2];
    } catch (err) { /* не JSON — игнорируем */ }
  }
  return p;
}

function Router_user(token) {
  if (!token) return null;
  return Users_byToken(token);
}

function Router_isAdmin(user, token) {
  if (token && token === CONFIG.API_TOKEN) return true;
  return !!(user && user.role === CONFIG.ADMIN_LOGIN);
}

function Router_handle(e) {
  var p = Router_params(e);
  var action = p.action || '';
  try {
    switch (action) {

      // ---------- Публичные ----------
      case 'login': {
        var r = Users_auth(p.login, p.code);
        if (!r.ok) return json_({ ok: false, error: r.error });
        return json_({ ok: true, token: r.token, user: r.user });
      }
      case 'prices': {
        return json_({ ok: true, prices: Prices_list() });
      }
      case 'cabinet': {
        var cab = Cabinet_view(p.cabinet);
        if (!cab.ok) return json_({ ok: false, error: cab.error });
        return json_({ ok: true, cabinet: cab });
      }

      // ---------- По токену ----------
      case 'me': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        return json_({ ok: true, user: u });
      }
      case 'objects': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var isAdmin = Router_isAdmin(u, p.token);
        var list = Objects_list(isAdmin ? null : (u.role === CONFIG.ADMIN_LOGIN ? null : u.login), isAdmin);
        return json_({ ok: true, objects: list });
      }
      case 'object': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var obj = Objects_get(Number(p.id));
        if (!obj) return json_({ ok: false, error: 'Объект не найден' });
        return json_({
          ok: true,
          object: obj,
          calc: Records_calcList(Number(p.id)),
          purchases: Purchases_list(Number(p.id)),
          visits: Visits_list(Number(p.id))
        });
      }
      case 'objects:create': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var isAdmin = Router_isAdmin(u, p.token);
        var master = (u.role === CONFIG.ADMIN_LOGIN && p.master) ? p.master : (isAdmin ? (p.master || '') : u.login);
        var created = Objects_create({
          name: p.name, address: p.address, client: p.client,
          master: master, commissioning: !!p.commissioning
        }, u);
        var cab = null;
        try { cab = Cabinet_create(created.id, u.login, 60); } catch (e2) {}
        return json_({ ok: true, object: created, cabinet: cab });
      }
      case 'objects:update': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var obj = Objects_get(Number(p.id));
        if (!obj) return json_({ ok: false, error: 'Объект не найден' });
        var isAdmin = Router_isAdmin(u, p.token);
        if (!isAdmin && obj.master !== u.login)
          return json_({ ok: false, error: 'Нет прав на этот объект' });
        var upd = Objects_update(Number(p.id), p.patch || {});
        return json_({ ok: true, object: upd });
      }
      case 'objects:close': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        if (!Router_isAdmin(u, p.token)) return json_({ ok: false, error: 'Только руководитель' });
        var res = Archive_close(Number(p.id), u.login);
        return json_({ ok: true, result: res });
      }
      case 'records:add': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var r = Records_calcAdd(Number(p.objectId), p.line || {});
        return json_({ ok: true, result: r });
      }
      case 'records:update': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var r = Records_calcUpdate(Number(p.objectId), Number(p.rowNum), p.patch || {});
        return json_({ ok: true, result: r });
      }
      case 'records:remove': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var r = Records_calcRemove(Number(p.objectId), Number(p.rowNum));
        return json_({ ok: true, result: r });
      }
      case 'records:recalc': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var r = Records_recalc(Number(p.objectId));
        return json_({ ok: true, result: r });
      }
      case 'purchases:add': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var r = Purchases_add(Number(p.objectId), p.purchase || {});
        return json_({ ok: true, result: r });
      }
      case 'photos:upload': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var r = Photos_upload(p.name || ('photo_' + uid() + '.jpg'), p.base64 || '');
        return json_({ ok: true, result: r });
      }
      case 'visits:add': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var r = Visits_add(Number(p.objectId), p.visit || {});
        return json_({ ok: true, result: r });
      }
      case 'users:changeCode': {
        var u = Router_user(p.token);
        if (!u) return json_({ ok: false, error: 'Нужна авторизация' });
        var isAdmin = Router_isAdmin(u, p.token);
        // обычный мастер меняет только свой код (нужен старый); админ — любой
        var login = isAdmin && p.login ? p.login : u.login;
        var r = Users_changeCode(login, p.oldCode, p.newCode, isAdmin);
        if (!r.ok) return json_({ ok: false, error: r.error });
        return json_({ ok: true });
      }

      // ---------- Только админ ----------
      case 'status:report': {
        var u = Router_user(p.token);
        if (!Router_isAdmin(u, p.token)) return json_({ ok: false, error: 'Нет прав' });
        return json_({ ok: true, report: Admin_report() });
      }
      case 'analytics': {
        var u = Router_user(p.token);
        if (!Router_isAdmin(u, p.token)) return json_({ ok: false, error: 'Нет прав' });
        return json_({ ok: true, analytics: Admin_analytics() });
      }
      case 'archive': {
        var u = Router_user(p.token);
        if (!Router_isAdmin(u, p.token)) return json_({ ok: false, error: 'Нет прав' });
        return json_({ ok: true, archive: Archive_list() });
      }
      case 'users:save': {
        var u = Router_user(p.token);
        if (!Router_isAdmin(u, p.token)) return json_({ ok: false, error: 'Нет прав' });
        var saved = Users_save(p.user || {});
        return json_({ ok: true, user: saved });
      }
      case 'users:list': {
        var u = Router_user(p.token);
        if (!Router_isAdmin(u, p.token)) return json_({ ok: false, error: 'Нет прав' });
        return json_({ ok: true, users: Users_list() });
      }
      case 'seed': {
        var u = Router_user(p.token);
        if (!Router_isAdmin(u, p.token)) return json_({ ok: false, error: 'Нет прав' });
        return json_({ ok: true, result: Seed_run() });
      }
      case 'ping': {
        return json_({ ok: true, serverTime: nowISO() });
      }
      default:
        return json_({ ok: false, error: 'Неизвестное действие: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
