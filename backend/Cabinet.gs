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

// Возвращает активный (не истёкший) токен кабинета для объекта либо создаёт
// новый. Используется и кнопкой «Создать ссылку», и «Посмотреть как клиент»,
// чтобы не плодить орфан-кабинеты при повторных кликах.
function Cabinet_tokenFor(objectId, by) {
  var rows = readRows('Кабинеты', 1);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].objectId) === String(objectId) && rows[i].active == 1
        && new Date(rows[i].expiresAt).getTime() >= Date.now()) {
      return { ok: true, token: rows[i].token, expiresAt: rows[i].expiresAt, reused: true };
    }
  }
  var c = Cabinet_create(objectId, by, 60);
  return { ok: true, token: c.token, expiresAt: c.expiresAt, reused: false };
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
  var estimateTotal = calc.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0);
  if (meta.commissioning == 1) estimateTotal = Math.round(estimateTotal * CONFIG.COMMISSIONING_FACTOR);
  var purchases = Purchases_list(cab.objectId);
  var purchaseSubtotal = purchases.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0);
  var markup = Admin_markupForObject_(purchaseSubtotal, meta.purchaseMarkup);
  var materialTotal = purchaseSubtotal + markup;
  var grandTotal = estimateTotal + materialTotal;
  return {
    ok: true,
    object: meta,
    calc: calc,
    purchases: purchases,
    visits: Visits_list(cab.objectId),
    // Для обратной совместимости со старым кабинетом: total = итог к оплате.
    total: grandTotal,
    breakdown: {
      estimateTotal: estimateTotal,
      purchaseSubtotal: purchaseSubtotal,
      markup: markup,
      materialTotal: materialTotal,
      grandTotal: grandTotal
    }
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
