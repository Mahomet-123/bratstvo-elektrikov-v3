// Archive.gs — закрытие объекта и архив по годам
function Archive_close(objectId, by) {
  var meta = Objects_get(objectId);
  if (!meta) throw new Error('Объект не найден');

  var calc = Records_calcList(objectId);
  var totalCalc = calc.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0);
  if (meta.commissioning == 1) totalCalc = Math.round(totalCalc * CONFIG.COMMISSIONING_FACTOR);
  var pur = Purchases_list(objectId);
  var totalPur = pur.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0);

  Objects_setStatus(objectId, 'закрыт', by);

  // годовой лист архива
  var year = new Date().getFullYear();
  var archName = 'Архив_' + year;
  var sh = getSheet_(archName, true);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['id', 'code', 'name', 'master', 'client', 'ИтогРасчёт', 'ИтогЗакупка', 'closedAt']);
  }
  sh.appendRow([objectId, meta.code, meta.name, meta.master, meta.client, totalCalc, totalPur, nowISO()]);

  // проставить год архива в мете объекта
  var r = findRow(CONFIG.SHEET_OBJECTS, 'id', objectId);
  updateRow(CONFIG.SHEET_OBJECTS, r.__row,
    [r.id, r.code, r.name, r.address, r.client, r.master, r.status, r.createdAt, r.closedAt, year, r.sheet, r.commissioning]);

  // кабинет клиента аннулируем
  Cabinet_revokeFor(objectId);

  return { ok: true, totalCalc: totalCalc, totalPurchase: totalPur, archive: archName };
}

function Archive_list() {
  return readRows(CONFIG.SHEET_OBJECTS, 1)
    .filter(function (r) { return r.status === 'закрыт'; })
    .map(stripRow_);
}

function Archive_yearSheets() {
  var ss = SS();
  return ss.getSheets().map(function (s) { return s.getName(); })
    .filter(function (n) { return /^Архив_\d{4}$/.test(n); });
}
