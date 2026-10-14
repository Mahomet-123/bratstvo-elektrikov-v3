// Photos.gs — загрузка фото закупок в Google Drive
function Photos_upload(name, base64) {
  var b64 = String(base64 || '');
  // отрезаем префикс data:image/...;base64, если есть
  var idx = b64.indexOf(',');
  if (idx >= 0 && /data:/.test(b64)) b64 = b64.slice(idx + 1);
  var bytes = Utilities.base64Decode(b64);

  var folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  var folder;
  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
  } else {
    folder = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME).next();
  }
  var blob = Utilities.newBlob(bytes, 'image/jpeg', name);
  var file = folder.createFile(blob);
  // открываем доступ на просмотр всем, чтобы PWA мог показывать фото
  file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);
  return {
    ok: true,
    id: file.getId(),
    url: 'https://drive.google.com/uc?export=view&id=' + file.getId()
  };
}
