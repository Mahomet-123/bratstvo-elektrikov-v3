// Users.gs — профили, авторизация, сид 51 профиля (Руководитель + мастер 1..50)
function stripRow_(r) {
  var o = {};
  for (var k in r) { if (k !== '__row') o[k] = r[k]; }
  return o;
}
function publicUser_(r) {
  return { login: r.login, role: r.role, name: r.name, phone: r.phone, active: r.active };
}

function Users_list() {
  return readRows(CONFIG.SHEET_USERS, 1).map(stripRow_);
}

function Users_get(login) {
  var r = findRow(CONFIG.SHEET_USERS, 'login', login);
  return r ? stripRow_(r) : null;
}

function Users_byToken(token) {
  if (!token) return null;
  var rows = readRows(CONFIG.SHEET_USERS, 1);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].token === token) return stripRow_(rows[i]);
  }
  return null;
}

function Users_auth(login, code) {
  var r = findRow(CONFIG.SHEET_USERS, 'login', login);
  if (!r) return { ok: false, error: 'Пользователь не найден' };
  if (!code && code !== 0) return { ok: false, error: 'Введите код доступа' };
  if (String(Number(r.code)) !== String(Number(code))) return { ok: false, error: 'Неверный код доступа' };
  var token = uid();
  updateRow(CONFIG.SHEET_USERS, r.__row, [r.login, r.code, r.role, r.name, r.phone, r.active, token]);
  logMsg(r.login, 'Вход выполнен');
  return { ok: true, token: token, user: publicUser_(r) };
}

function Users_save(user) {
  var r = findRow(CONFIG.SHEET_USERS, 'login', user.login);
  if (r) {
    updateRow(CONFIG.SHEET_USERS, r.__row,
      [user.login, user.code, user.role, user.name || r.name, user.phone || r.phone,
       user.active !== undefined ? user.active : r.active, r.token]);
    return stripRow_(user);
  }
  appendRow(CONFIG.SHEET_USERS, [user.login, user.code, user.role, user.name || '', user.phone || '', user.active !== undefined ? user.active : 1, '']);
  return user;
}

// Смена своего кода: обычный мастер — только со старым кодом; Руководитель — сразу.
function Users_changeCode(login, oldCode, newCode, isAdmin) {
  var r = findRow(CONFIG.SHEET_USERS, 'login', login);
  if (!r) return { ok: false, error: 'Пользователь не найден' };
  if (!isAdmin && String(Number(r.code)) !== String(Number(oldCode))) {
    return { ok: false, error: 'Старый код неверен' };
  }
  updateRow(CONFIG.SHEET_USERS, r.__row,
    [r.login, newCode, r.role, r.name, r.phone, r.active, r.token]);
  return { ok: true };
}

function Users_seed() {
  var sh = getSheet_(CONFIG.SHEET_USERS, true);
  var header = ['login', 'code', 'role', 'name', 'phone', 'active', 'token'];
  var rows = [header];
  rows.push([CONFIG.ADMIN_LOGIN, CONFIG.ADMIN_CODE, 'Руководитель', 'Руководитель', '', 1, '']);
  for (var j = 1; j <= CONFIG.MASTER_COUNT; j++) {
    rows.push(['Мастер ' + j, String(j), 'мастер', 'Мастер ' + j, '', 1, '']);
  }
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  return { ok: true, created: rows.length - 1, updated: 0 };
}
