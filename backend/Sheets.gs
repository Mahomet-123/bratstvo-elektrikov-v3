// Sheets.gs — низкоуровневая работа с таблицей-БД и per-object листами.
// Все модули бэкенда используют эти хелперы. Глобальная область Apps Script:
// функции доступны из любого .gs-файла проекта.

function SS() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function nowISO() { return new Date().toISOString(); }

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getSheet_(name, create) {
  var ss = SS();
  var sh = ss.getSheetByName(name);
  if (!sh && create) sh = ss.insertSheet(name);
  return sh;
}

// Базовые листы и их заголовки (создаются один раз, устойчиво к повторам)
function ensureBaseSheets() {
  var specs = [
    [CONFIG.SHEET_PRICE,    ['n', 'section', 'name', 'unit', 'price', 'from', 'type']],
    [CONFIG.SHEET_USERS,    ['login', 'code', 'role', 'name', 'phone', 'active', 'token']],
    [CONFIG.SHEET_OBJECTS,  ['id', 'code', 'name', 'address', 'client', 'master', 'status', 'createdAt', 'closedAt', 'archiveYear', 'sheet', 'commissioning', 'purchaseMarkup']],
    [CONFIG.SHEET_VISITS,   ['objectId', 'date', 'master', 'dayNumber', 'note', 'createdAt', 'deviceId']],
    [CONFIG.SHEET_STATUS,   ['objectId', 'ts', 'status', 'by']],
    [CONFIG.SHEET_LOG,      ['ts', 'actor', 'msg']],
    [CONFIG.SHEET_CALC,     ['objectId', 'n', 'section', 'name', 'unit', 'qty', 'price', 'coef', 'material', 'from', 'sum', 'note', 'createdAt']],
    [CONFIG.SHEET_PURCHASE, ['objectId', 'date', 'n', 'name', 'qty', 'price', 'sum', 'photo', 'note', 'createdAt', 'photos']],
    ['Кабинеты',            ['token', 'objectId', 'createdAt', 'expiresAt', 'active']]
  ];
  var ss = SS();
  specs.forEach(function (sp) {
    var name = sp[0];
    try {
      if (!ss.getSheetByName(name)) ss.insertSheet(name);
    } catch (e) { /* лист уже есть */ }
  });
  specs.forEach(function (sp) {
    try { setHeaders_(sp[0], sp[1]); } catch (e) { /* заголовки уже есть */ }
  });
}

function setHeaders_(name, headers) {
  var sh = getSheet_(name, true);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
}

// Добавляет недостающие колонки в УЖЕ существующие листы (миграция схемы).
// setHeaders_ срабатывает только для пустых листов, поэтому для живых
// таблиц нужна отдельная дозапись заголовков в конец.
function migrateSchema() {
  ensureColumn_(CONFIG.SHEET_PURCHASE, 10, 'photos');
  ensureColumn_(CONFIG.SHEET_OBJECTS, 12, 'purchaseMarkup');
}

function ensureColumn_(name, colIndex, headerName) {
  try {
    var sh = getSheet_(name, false);
    if (!sh) return;
    var lastCol = sh.getLastColumn();
    var header;
    try {
      header = sh.getRange(1, 1, 1, Math.max(lastCol, colIndex + 1)).getValues()[0];
    } catch (e) { return; }
    if (header[colIndex] === headerName) return; // уже есть
    sh.getRange(1, colIndex + 1).setValue(headerName);
  } catch (e) { /* не критично */ }
}

// Нормализует поле photos из разных источников в массив URL.
function parsePhotos_(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string' && raw) {
    var s = raw.trim();
    if (s.charAt(0) === '[') {
      try { var a = JSON.parse(s); if (Array.isArray(a)) return a.filter(Boolean); } catch (e) {}
    }
    return [s]; // одиночный URL
  }
  return [];
}

// Чтение всех строк листа в массив объектов (по заголовкам)
function readRows(name, headerRow) {
  headerRow = headerRow || 1;
  var sh = getSheet_(name, false);
  if (!sh || sh.getLastRow() < headerRow) return [];
  var data = sh.getDataRange().getValues();
  var headers = data[headerRow - 1];
  var out = [];
  for (var r = headerRow; r < data.length; r++) {
    var row = data[r];
    if (row.length && row.every(function (c) { return c === '' || c === null || c === undefined; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
    obj.__row = r + 1;
    out.push(obj);
  }
  return out;
}

function appendRow(name, values) {
  var sh = getSheet_(name, true);
  sh.appendRow(values);
  return sh.getLastRow();
}

function updateRow(name, rowNum, values) {
  var sh = getSheet_(name, false);
  sh.getRange(rowNum, 1, 1, values.length).setValues([values]);
}

function findRow(name, colName, value) {
  var rows = readRows(name, 1);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][colName]) === String(value)) return rows[i];
  }
  return null;
}

function deleteRow(name, rowNum) {
  var sh = getSheet_(name, false);
  if (sh) sh.deleteRow(rowNum);
}

function logMsg(actor, msg) {
  try { appendRow(CONFIG.SHEET_LOG, [nowISO(), actor || 'system', msg]); }
  catch (e) { /* лог не критичен */ }
}

// ---------- Per-object листы (РАСЧЁТ / ДЕНЬ / ЗАКУПКА) ----------

// Фиксированная разметка блоков внутри листа объекта
var BLOCKS = {
  'РАСЧЁТ':  { label: 3,  header: 4,   start: 5,   end: 59 },
  'ДЕНЬ':    { label: 61, header: 62,  start: 63,  end: 119 },
  'ЗАКУПКА': { label: 121, header: 122, start: 123, end: 220 }
};

function getObjectSheet(objectId) {
  var meta = findRow(CONFIG.SHEET_OBJECTS, 'id', objectId);
  if (!meta) throw new Error('Объект не найден: ' + objectId);
  var sh = SS().getSheetByName(meta.sheet);
  if (!sh) throw new Error('Лист объекта не найден: ' + meta.sheet);
  return sh;
}

function objectSheetName(code, name) {
  var clean = String(name).replace(/[\\/:?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length > 60) clean = clean.slice(0, 60);
  return String(code) + '_' + clean;
}

function ensureObjectSheet(sheetName, code, objName) {
  var ss = SS();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1).setValue('Братство Электриков — Объект #' + code + ': ' + objName);
    sh.getRange(BLOCKS['РАСЧЁТ'].label, 1).setValue('РАСЧЁТ');
    sh.getRange(BLOCKS['РАСЧЁТ'].header, 1, 1, 11)
      .setValues([['№', 'Раздел', 'Наименование', 'Ед.', 'Кол-во', 'Цена', 'Коэф.', 'Материал', 'Сумма', 'Примечание', 'from']]);
    sh.getRange(BLOCKS['ДЕНЬ'].label, 1).setValue('ДЕНЬ');
    sh.getRange(BLOCKS['ДЕНЬ'].header, 1, 1, 5)
      .setValues([['Дата', 'Мастер', 'Описание', 'Примечание', 'Фото']]);
    sh.getRange(BLOCKS['ЗАКУПКА'].label, 1).setValue('ЗАКУПКА');
    sh.getRange(BLOCKS['ЗАКУПКА'].header, 1, 1, 8)
      .setValues([['Дата', 'Позиция', 'Наименование', 'Кол-во', 'Цена', 'Сумма', 'Фото', 'Примечание']]);
    [BLOCKS['РАСЧЁТ'].label, BLOCKS['ДЕНЬ'].label, BLOCKS['ЗАКУПКА'].label].forEach(function (lr) {
      sh.getRange(lr, 1).setFontWeight('bold');
    });
    [BLOCKS['РАСЧЁТ'].header, BLOCKS['ДЕНЬ'].header, BLOCKS['ЗАКУПКА'].header].forEach(function (hr) {
      sh.getRange(hr, 1, 1, sh.getLastColumn()).setFontWeight('bold');
    });
  }
  return sh;
}

// Возвращает {header, firstData, lastData, nextRow} для блока
function blockInfo(sheet, label) {
  var b = BLOCKS[label];
  if (!b) throw new Error('Неизвестный блок: ' + label);
  var last = b.start - 1;
  for (var r = b.start; r <= b.end; r++) {
    var row = sheet.getRange(r, 1, 1, sheet.getMaxColumns()).getValues()[0];
    if (row.some(function (c) { return c !== '' && c !== null && c !== undefined; })) last = r;
  }
  return { header: b.header, firstData: b.start, lastData: last, nextRow: last + 1 };
}

// Добавляет строку в блок (с учётом переполнения)
function blockAppend(sheet, label, values) {
  var b = BLOCKS[label];
  var info = blockInfo(sheet, label);
  var row = info.nextRow;
  if (row > b.end) row = b.end; // переполнение — пишем в последнюю строку блока
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  return row;
}

// Читает строки блока как объекты по заголовку блока
function blockRead(sheet, label) {
  var b = BLOCKS[label];
  var info = blockInfo(sheet, label);
  if (info.lastData < b.start) return [];
  var data = sheet.getRange(b.header, 1, (info.lastData - b.header + 1), sheet.getMaxColumns()).getValues();
  var headers = data[0];
  var out = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (row.every(function (c) { return c === '' || c === null || c === undefined; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
    obj.__row = b.header + r;
    out.push(obj);
  }
  return out;
}

function blockUpdate(sheet, label, rowNum, values) {
  sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
}

function blockDelete(sheet, rowNum) {
  sheet.deleteRow(rowNum);
}

// Полная перезапись блока (для синхронизации вида объекта)
function writeBlock(sheet, label, rows) {
  var b = BLOCKS[label];
  if (!b) throw new Error('Неизвестный блок: ' + label);
  sheet.getRange(b.start, 1, (b.end - b.start + 1), sheet.getMaxColumns()).clearContent();
  for (var i = 0; i < rows.length; i++) {
    var r = b.start + i;
    if (r > b.end) break;
    sheet.getRange(r, 1, 1, rows[i].length).setValues([rows[i]]);
  }
}
