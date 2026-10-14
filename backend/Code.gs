// Code.gs — точка входа + первичная инициализация структуры (гейт разрешений)
// Запускается пользователем ОДИН раз, чтобы выдать сразу ВСЕ OAuth-разрешения,
// которые может потребовать приложение (Таблицы, Диск, внешние запросы,
// API Apps Script для clasp, email), и создать базовые листы + папку Drive.

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Братство')
      .addItem('1. Создать структуру и выдать разрешения', 'ensureStructure')
      .addItem('2. Наполнить прайс и профили', 'seedAll')
      .addToUi();
  } catch (e) {
    // в автономном скрипте getUi() может быть недоступен — не критично
  }
}

/**
 * Создаёт базовую структуру и «трогает» каждый сервис, чтобы окно согласия
 * запросило ВСЕ нужные scope за один раз. После этого никакие будущие версии
 * бэкенда не потребуют повторного подтверждения.
 */
function ensureStructure() {
  // 1) SpreadsheetApp -> scope spreadsheets
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var needed = [
    CONFIG.SHEET_PRICE,
    CONFIG.SHEET_USERS,
    CONFIG.SHEET_OBJECTS,
    CONFIG.SHEET_VISITS,
    CONFIG.SHEET_STATUS,
    CONFIG.SHEET_LOG
  ];
  var existing = ss.getSheets().map(function (s) { return s.getName(); });
  needed.forEach(function (name) {
    if (existing.indexOf(name) === -1) {
      ss.insertSheet(name);
    }
  });

  // 2) DriveApp -> scope drive (папка для фото закупок)
  var folderName = CONFIG.DRIVE_FOLDER_NAME;
  var folders = DriveApp.getFoldersByName(folderName);
  var folderId;
  if (folders.hasNext()) {
    folderId = folders.next().getId();
  } else {
    folderId = DriveApp.createFolder(folderName).getId();
  }
  PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ID', folderId);

  // 3) Session.getActiveUser().getEmail() -> scope userinfo.email
  var actor = 'system';
  try {
    var u = Session.getActiveUser();
    if (u) { actor = u.getEmail() || 'user'; }
  } catch (e) { /* scope ещё не выдан — окно согласия его запросит */ }

  // 4) UrlFetchApp -> scope script.external_request (безопасный запрос)
  try {
    UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  } catch (e) { /* не критично */ }

  // script.projects / script.deployments обслуживаются clasp (его собственный OAuth),
  // но объявлены в манифесте, поэтому будут запрошены в этом же окне согласия.

  log_('ensureStructure: базовая структура создана (листов: ' + needed.length + ', папка Drive: ' + folderId + ')');
  return { ok: true, sheets: needed, folderId: folderId, actor: actor };
}

// Полное наполнение (прайс + профили) реализуется в Seed.gs и вызывается
// либо из меню (п.2), либо по API после загрузки полного бэкенда.
function seedAll() {
  if (typeof Seed_run === 'function') { return Seed_run(); }
  return { ok: false, error: 'Seed.gs ещё не загружен. Выполните полный clasp push.' };
}

function log_(msg) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_LOG);
    if (!sh) { sh = ss.insertSheet(CONFIG.SHEET_LOG); }
    sh.appendRow([new Date(), 'system', msg]);
  } catch (e) { /* лог не критичен */ }
}
