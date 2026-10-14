// Bot.gs — заглушка Telegram-бота (уведомления)
function Bot_setToken(token, chatId) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('TG_BOT_TOKEN', token || '');
  props.setProperty('TG_CHAT_ID', chatId || '');
  return { ok: true };
}

function Bot_notify(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TG_BOT_TOKEN');
  var chat = props.getProperty('TG_CHAT_ID');
  if (!token || !chat) {
    logMsg('bot', 'Telegram не настроен — уведомление пропущено: ' + text);
    return { ok: false, reason: 'not_configured' };
  }
  try {
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chat, text: String(text).slice(0, 4000) }),
      muteHttpExceptions: true
    });
    return { ok: true, response: res.getResponseCode() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
