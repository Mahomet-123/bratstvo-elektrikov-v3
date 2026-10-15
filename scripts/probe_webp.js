// Проверка загрузки webp фото через бэкенд (Photos.gs v2).
const WEBP_B64 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAAAfQ//73v70KicBfYYMAAAA=';
const API = 'https://script.google.com/macros/s/AKfycbyKu6vKUx7jihgcPfX-xg3QPaM9--E64qQQ8OewnRPqcoSSHETGTzRKMvIaEIANCm6y6w/exec';
const TOKEN = 'bratstvo-admin-2026';

function api(action, params, method) {
  method = method || 'GET';
  const url = new URL(API);
  if (method === 'GET') {
    url.searchParams.set('action', action);
    Object.keys(params || {}).forEach(k => url.searchParams.set(k, params[k]));
  }
  const opts = { method: method, redirect: 'follow' };
  if (method === 'POST') {
    opts.body = JSON.stringify(Object.assign({ action }, params));
    opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  }
  return fetch(url.toString(), opts).then(r => r.text()).then(t => {
    try { return JSON.parse(t); } catch (e) { throw new Error('bad json: ' + t.slice(0, 200)); }
  });
}

(async () => {
  try {
    let d = await api('ping', {}, 'GET');
    console.log('ping:', d.ok ? 'OK' : 'FAIL', d.ping || '');
    // логин как руководитель (код по умолчанию 0000)
    let auth = await api('login', { login: 'Руководитель', code: '0000' }, 'POST');
    if (!auth.ok) throw new Error('login failed: ' + JSON.stringify(auth));
    const TOKEN = auth.token;
    console.log('login OK, token получен');
    let o = await api('objects:create', { token: TOKEN, name: 'WEBP-TEST-' + Date.now(), client: 'тест' }, 'POST');
    if (!o.ok) throw new Error('create failed: ' + JSON.stringify(o));
    const objId = o.object.id;
    console.log('object created id=', objId);
    let pur = await api('purchases:add', {
      token: TOKEN, objectId: objId,
      purchase: { date: '2026-10-16', name: 'Тест материал', qty: 2, price: 100, photo: WEBP_B64 }
    }, 'POST');
    if (!pur.ok) throw new Error('purchase failed: ' + JSON.stringify(pur));
    console.log('purchase added, photo URL:', pur.photo);
    console.log('URL содержит thumbnail:', /thumbnail/.test(pur.photo) ? 'ДА' : 'НЕТ');
    await api('objects:delete', { token: TOKEN, id: objId }, 'POST');
    console.log('object deleted');
  } catch (e) {
    console.log('ERROR:', e.message);
  }
})();
