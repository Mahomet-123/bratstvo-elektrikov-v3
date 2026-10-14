// Records.gs — Расчёт объекта (позиции) и Закупка
function calcLineSum_(line) {
  var qty = Number(line.qty) || 0;
  var price = Number(line.price) || 0;
  var coef = Number(line.coef) || 1;
  var sum = price * qty * coef;
  if (line.material) {
    var markup = sum * CONFIG.MATERIAL_MARKUP;
    if (markup < CONFIG.MATERIAL_MIN) markup = CONFIG.MATERIAL_MIN;
    sum += markup;
  }
  return Math.round(sum);
}

function Records_calcAdd(objectId, line) {
  var sum = calcLineSum_(line);
  appendRow(CONFIG.SHEET_CALC, [
    objectId, line.n || '', line.section || '', line.name || '', line.unit || '',
    line.qty || 0, line.price || 0, line.coef || 1, line.material ? 1 : 0,
    line.from ? 1 : 0, sum, line.note || '', nowISO()
  ]);
  syncObjectSheet(objectId);
  return { ok: true, sum: sum };
}

function Records_calcList(objectId) {
  return readRows(CONFIG.SHEET_CALC, 1)
    .filter(function (r) { return String(r.objectId) === String(objectId); })
    .map(stripRow_);
}

function Records_calcUpdate(objectId, rowNum, patch) {
  var rows = readRows(CONFIG.SHEET_CALC, 1);
  var r = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].__row === rowNum && String(rows[i].objectId) === String(objectId)) r = rows[i];
  if (!r) throw new Error('Позиция расчёта не найдена');
  var line = {
    qty: patch.qty !== undefined ? patch.qty : r.qty,
    price: patch.price !== undefined ? patch.price : r.price,
    coef: patch.coef !== undefined ? patch.coef : r.coef,
    material: patch.material !== undefined ? patch.material : (r.material == 1)
  };
  var sum = calcLineSum_(line);
  updateRow(CONFIG.SHEET_CALC, rowNum, [
    r.objectId,
    patch.n !== undefined ? patch.n : r.n,
    patch.section !== undefined ? patch.section : r.section,
    patch.name !== undefined ? patch.name : r.name,
    patch.unit !== undefined ? patch.unit : r.unit,
    line.qty, line.price, line.coef, line.material ? 1 : 0,
    patch.from !== undefined ? (patch.from ? 1 : 0) : r.from,
    sum, patch.note !== undefined ? patch.note : r.note, r.createdAt
  ]);
  syncObjectSheet(objectId);
  return { ok: true, sum: sum };
}

function Records_calcRemove(objectId, rowNum) {
  deleteRow(CONFIG.SHEET_CALC, rowNum);
  syncObjectSheet(objectId);
  return { ok: true };
}

function Records_recalc(objectId) {
  var rows = readRows(CONFIG.SHEET_CALC, 1)
    .filter(function (r) { return String(r.objectId) === String(objectId); });
  var total = 0;
  rows.forEach(function (r) {
    var sum = calcLineSum_({ qty: r.qty, price: r.price, coef: r.coef, material: r.material == 1 });
    r.sum = sum; total += sum;
    updateRow(CONFIG.SHEET_CALC, r.__row,
      [r.objectId, r.n, r.section, r.name, r.unit, r.qty, r.price, r.coef, r.material, r.from, r.sum, r.note, r.createdAt]);
  });
  var meta = Objects_get(objectId);
  if (meta && meta.commissioning == 1) total = Math.round(total * CONFIG.COMMISSIONING_FACTOR);
  syncObjectSheet(objectId);
  return { ok: true, total: total, lines: rows.length };
}

// Закупка: при наличии фото — сначала загрузка в Drive
function Purchases_add(objectId, p) {
  var photoUrl = '';
  if (p.photo) {
    var res = Photos_upload('purchase_' + uid() + '.jpg', p.photo);
    photoUrl = res.url;
  }
  var price = Number(p.price) || 0;
  var qty = Number(p.qty) || 0;
  var sum = Math.round(price * qty);
  appendRow(CONFIG.SHEET_PURCHASE, [
    objectId, p.date || (new Date().toISOString().slice(0, 10)),
    p.n || '', p.name || '', qty, price, sum, photoUrl, p.note || '', nowISO()
  ]);
  syncObjectSheet(objectId);
  return { ok: true, sum: sum, photo: photoUrl };
}

function Purchases_list(objectId) {
  return readRows(CONFIG.SHEET_PURCHASE, 1)
    .filter(function (r) { return String(r.objectId) === String(objectId); })
    .map(stripRow_);
}
