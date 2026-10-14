// Cabinet.gs — временный кабинет клиента (только для чтения, умирает при закрытии)
function Cabinet_create(objectId, by, ttlDays) {
  var meta = Objects_get(objectId);
  if (!meta) throw new Error('Объект не найден');
  var token = uid() + uid();
  var ttl = ttlDays || 60;
  var expires = new Date(Date.now() + ttl * 86400000).toISOString();
  appendRow('Кабинеты', [token, objectId, nowISO(), expires, 1]);
  logMsg(by || 'system', 'Создан кабинет клиента для объекта ' + objectId);
  return { ok: true, token: token, expiresAt: expires };
}

function Cabinet_view(token) {
  if (!token) return { ok: false, error: 'Нет токена' };
  var rows = readRows('Кабинеты', 1);
  var cab = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].token === token && rows[i].active == 1) cab = rows[i];
  if (!cab) return { ok: false, error: 'Кабинет недоступен или истёк' };
  if (new Date(cab.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'Срок кабинета истёк' };
  }
  var meta = Objects_get(cab.objectId);
  if (!meta) return { ok: false, error: 'Объект не найден' };
  var calc = Records_calcList(cab.objectId);
  var total = calc.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0);
  if (meta.commissioning == 1) total = Math.round(total * CONFIG.COMMISSIONING_FACTOR);
  return {
    ok: true,
    object: meta,
    calc: calc,
    purchases: Purchases_list(cab.objectId),
    visits: Visits_list(cab.objectId),
    total: total
  };
}

function Cabinet_revokeFor(objectId) {
  var rows = readRows('Кабинеты', 1);
  rows.forEach(function (r) {
    if (String(r.objectId) === String(objectId) && r.active == 1) {
      updateRow('Кабинеты', r.__row, [r.token, r.objectId, r.createdAt, r.expiresAt, 0]);
    }
  });
}

function Cabinet_revoke(token) {
  var rows = readRows('Кабинеты', 1);
  rows.forEach(function (r) {
    if (r.token === token && r.active == 1) {
      updateRow('Кабинеты', r.__row, [r.token, r.objectId, r.createdAt, r.expiresAt, 0]);
    }
  });
  return { ok: true };
}
