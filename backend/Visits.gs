// Visits.gs — журнал дней (посещений) объекта
function Visits_add(objectId, v) {
  appendRow(CONFIG.SHEET_VISITS, [
    objectId,
    v.date || (new Date().toISOString().slice(0, 10)),
    v.master || '',
    v.dayNumber || '',
    v.note || '',
    nowISO(),
    v.deviceId || ''
  ]);
  syncObjectSheet(objectId);
  return { ok: true };
}

function Visits_list(objectId) {
  return readRows(CONFIG.SHEET_VISITS, 1)
    .filter(function (r) { return String(r.objectId) === String(objectId); })
    .map(stripRow_);
}

// Дубликаты дней не блокируем, но помечаем «изменено на другом устройстве»
function Visits_markConflict(objectId, rowNum) {
  var r = findRow(CONFIG.SHEET_VISITS, 'objectId', objectId);
  if (!r) return { ok: false };
  var cur = readRows(CONFIG.SHEET_VISITS, 1);
  var target = null;
  for (var i = 0; i < cur.length; i++) if (cur[i].__row === rowNum) target = cur[i];
  if (!target) return { ok: false };
  updateRow(CONFIG.SHEET_VISITS, rowNum, [
    target.objectId, target.date, target.master, target.dayNumber,
    'ИЗМЕНЕНО НА ДРУГОМ УСТРОЙСТВЕ: ' + target.note, target.createdAt, target.deviceId
  ]);
  return { ok: true };
}
