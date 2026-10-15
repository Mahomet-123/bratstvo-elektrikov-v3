// Photos.gs — загрузка фото закупок в Google Drive
// Определяет формат по сигнатуре байтов (webp, jpeg, png).
// Использует thumbnail URL для надёжного отображения в PWA.
function Photos_upload(name, base64) {
  var b64 = String(base64 || '');
  // отрезаем префикс data:image/...;base64, если есть
  var idx = b64.indexOf(',');
  if (idx >= 0 && /data:/.test(b64)) b64 = b64.slice(idx + 1);
  var bytes = Utilities.base64Decode(b64);

  // Определяем формат по сигнатуре (первые байты)
  var mime = 'image/jpeg';
  var ext = '.jpg';
  if (bytes.length >= 12) {
    // webp: RIFF....WEBP
    var sig = '';
    for (var i = 0; i < 12; i++) { sig += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); }
    if (sig.substring(0, 8) === '52494646' && sig.substring(16, 24) === '57454250') {
      mime = 'image/webp'; ext = '.webp';
    } else if (sig.substring(0, 4) === 'ffd8ff') {
      mime = 'image/jpeg'; ext = '.jpg';
    } else if (sig.substring(0, 8) === '89504e47') {
      mime = 'image/png'; ext = '.png';
    }
  }

  var folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  var folder;
  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
  } else {
    folder = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME).next();
  }
  var fileName = name ? name.replace(/\.[^.]+$/, '') + ext : 'photo_' + uid() + ext;
  var blob = Utilities.newBlob(bytes, mime, fileName);
  var file = folder.createFile(blob);
  // открываем доступ на просмотр всем, чтобы PWA мог показывать фото
  file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);
  var fileId = file.getId();
  return {
    ok: true,
    id: fileId,
    mime: mime,
    url: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w800'
  };
}
