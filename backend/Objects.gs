// Objects.gs — объекты: создание, список, статусы, per-object лист
function Objects_nextId() {
  var props = PropertiesService.getScriptProperties();
  var id = parseInt(props.getProperty('NEXT_OBJECT_ID') || '0', 10);
  if (!id) {
    var rows = readRows(CONFIG.SHEET_OBJECTS, 1);
    id = rows.reduce(function (m, r) {
      var n = parseInt(r.id, 10); return isNaN(n) ? m : Math.max(m, n);
    }, 0);
  }
  id += 1;
  props.setProperty('NEXT_OBJECT_ID', String(id));
  return id;
}

function Objects_create(data, byUser) {
  var id = Objects_nextId();
  var code = 'ОБ' + ('000' + id).slice(-3);
  var sheetName = objectSheetName(code, data.name);
  ensureObjectSheet(sheetName, code, data.name);
  var row = [
    id, code, data.name || 'Без названия', data.address || '', data.client || '',
    data.master || '', 'расчёт', nowISO(), '', '', sheetName, data.commissioning ? 1 : 0,
    data.purchaseMarkup ? 1 : 0
  ];
  appendRow(CONFIG.SHEET_OBJECTS, row);
  Objects_setStatus(id, 'расчёт', byUser ? byUser.login : 'system');
  syncObjectSheet(id);
  return Objects_get(id);
}

function Objects_list(filterMaster, isAdmin) {
  var rows = readRows(CONFIG.SHEET_OBJECTS, 1);
  if (!isAdmin && filterMaster) {
    rows = rows.filter(function (r) { return r.master === filterMaster; });
  }
  return rows.map(stripRow_);
}

function Objects_get(id) {
  var r = findRow(CONFIG.SHEET_OBJECTS, 'id', id);
  return r ? stripRow_(r) : null;
}

function Objects_update(id, patch) {
  var r = findRow(CONFIG.SHEET_OBJECTS, 'id', id);
  if (!r) throw new Error('Объект не найден');
  var row = [
    r.id, r.code,
    patch.name !== undefined ? patch.name : r.name,
    patch.address !== undefined ? patch.address : r.address,
    patch.client !== undefined ? patch.client : r.client,
    patch.master !== undefined ? patch.master : r.master,
    r.status, r.createdAt, r.closedAt, r.archiveYear, r.sheet,
    patch.commissioning !== undefined ? (patch.commissioning ? 1 : 0) : r.commissioning,
    patch.purchaseMarkup !== undefined ? (patch.purchaseMarkup ? 1 : 0) : (r.purchaseMarkup ? 1 : 0)
  ];
  updateRow(CONFIG.SHEET_OBJECTS, r.__row, row);
  syncObjectSheet(id);
  return Objects_get(id);
}

// Удаление объекта (только руководитель): строки расчёта/закупки/визитов,
// запись в архиве, отдельный лист объекта и саму строку объекта.
function deleteRowsByObjectId(sheetName, id) {
  var rows = readRows(sheetName, 1);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].objectId) === String(id)) {
      try { deleteRow(sheetName, rows[i].__row); } catch (e) {}
    }
  }
}

function Objects_delete(id, by) {
  var meta = Objects_get(id);
  if (meta) {
    try {
      var ss = SS();
      var sh = ss.getSheetByName(meta.sheet);
      if (sh) ss.deleteSheet(sh);
    } catch (e) {}
    try {
      SS().getSheets().forEach(function (s) {
        if (/^Архив_\d{4}$/.test(s.getName())) {
          var data = s.getDataRange().getValues();
          for (var ri = data.length - 1; ri >= 1; ri--) {
            if (String(data[ri][0]) === String(id)) { s.deleteRow(ri + 1); }
          }
        }
      });
    } catch (e) {}
  }
  deleteRowsByObjectId(CONFIG.SHEET_CALC, id);
  deleteRowsByObjectId(CONFIG.SHEET_PURCHASE, id);
  deleteRowsByObjectId(CONFIG.SHEET_VISITS, id);
  var r = findRow(CONFIG.SHEET_OBJECTS, 'id', id);
  if (r) deleteRow(CONFIG.SHEET_OBJECTS, r.__row);
  return { ok: true, deleted: id };
}

function Objects_setStatus(id, status, by) {
  var r = findRow(CONFIG.SHEET_OBJECTS, 'id', id);
  if (!r) throw new Error('Объект не найден');
  updateRow(CONFIG.SHEET_OBJECTS, r.__row,
    [r.id, r.code, r.name, r.address, r.client, r.master, status,
     r.createdAt, status === 'закрыт' ? nowISO() : r.closedAt, r.archiveYear, r.sheet, r.commissioning,
     r.purchaseMarkup ? 1 : 0]);
  appendRow(CONFIG.SHEET_STATUS, [id, nowISO(), status, by || 'system']);
}

// Синхронизирует человекочитаемый лист объекта из базовых листов
function syncObjectSheet(objectId) {
  var meta = Objects_get(objectId);
  if (!meta) return;
  var sh = SS().getSheetByName(meta.sheet);
  if (!sh) return;
  var calc = readRows(CONFIG.SHEET_CALC, 1)
    .filter(function (r) { return String(r.objectId) === String(objectId); });
  writeBlock(sh, 'РАСЧЁТ', calc.map(function (r) {
    return [r.n, r.section, r.name, r.unit, r.qty, r.price, r.coef, r.material, r.sum, r.note, r.from];
  }));
  var pur = readRows(CONFIG.SHEET_PURCHASE, 1)
    .filter(function (r) { return String(r.objectId) === String(objectId); });
  writeBlock(sh, 'ЗАКУПКА', pur.map(function (r) {
    return [r.date, r.n, r.name, r.qty, r.price, r.sum, r.photo, r.note];
  }));
  var vis = readRows(CONFIG.SHEET_VISITS, 1)
    .filter(function (r) { return String(r.objectId) === String(objectId); });
  writeBlock(sh, 'ДЕНЬ', vis.map(function (r) {
    return [r.date, r.master, r.note, '', ''];
  }));
}
