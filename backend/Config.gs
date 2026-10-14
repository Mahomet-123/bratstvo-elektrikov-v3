// Config.gs — конфигурация проекта «Братство Электриков» (ЧР)
// Все значения берутся из ТЗ «как есть», не пересоздаём, не меняем.

var CONFIG = {
  // Таблица-БД (предоставлена пользователем)
  SPREADSHEET_ID: '1k5q56jJD4uzRnZnHv_p4ZIyJcJ9aazPypa91X14SzC8',

  // Листы базы
  SHEET_PRICE:  'Прайс',
  SHEET_USERS:  'Пользователи',
  SHEET_OBJECTS:'Объекты',
  SHEET_VISITS: 'Посещения',
  SHEET_STATUS: 'Статусы',
  SHEET_LOG:    'Лог',
  SHEET_CALC:   'Расчёт',
  SHEET_PURCHASE:'Закупка',

  // Папка Drive для фото закупок
  DRIVE_FOLDER_NAME: 'Братство Электриков / Фото',

  // Роли и доступ
  ADMIN_LOGIN: 'Руководитель',
  ADMIN_CODE:  '0000',
  MASTER_COUNT: 50,          // мастер 1..50

  // Финансовые правила (ТЗ §4)
  MATERIAL_MARKUP: 0.10,     // наценка на материал +10%
  MATERIAL_MIN: 1500,        // минимум наценки 1500 ₽
  COMMISSIONING_FACTOR: 1.30,// пусконаладка +30%

  // Служебный токен для административных вызовов API (смените в проде)
  API_TOKEN: 'bratstvo-admin-2026'
};
