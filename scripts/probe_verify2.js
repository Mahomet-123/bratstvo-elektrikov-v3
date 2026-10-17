// probe_verify2.js — проверка новых эндпоинтов: наценка на материал + мультифото закупки.
const API = 'https://script.google.com/macros/s/AKfycbyKu6vKUx7jihgcPfX-xg3QPaM9--E64qQQ8OewnRPqcoSSHETGTzRKMvIaEIANCm6y6w/exec';
const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function call(action, params, method, attempt = 0) {
  method = method || 'GET';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  let url = API; const opts = { method, signal: ctrl.signal, redirect: 'follow' };
  const body = Object.assign({ action }, params || {});
  if (method === 'GET') {
    const qs = [];
    for (const k in body) { const v = body[k]; if (v !== undefined && v !== null && v !== '') qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); }
    url += (url.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
  } else { opts.body = JSON.stringify(body); opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' }; }
  try {
    const r = await fetch(url, opts); clearTimeout(to);
    return JSON.parse(await r.text());
  } catch (e) {
    clearTimeout(to);
    if (attempt < 3) { await new Promise(r => setTimeout(r, 1200)); return call(action, params, method, attempt + 1); }
    throw e;
  }
}
const log = (ok, name, d) => console.log((ok ? 'PASS ' : 'FAIL ') + name + (d ? '  → ' + d : ''));

(async () => {
  try {
    let r = await call('ping'); log(r.ok, 'ping', r.serverTime);

    r = await call('login', { login: 'Руководитель', code: '0000' }, 'POST');
    log(r.ok && r.token, 'login', r.ok ? 'token=' + r.token.slice(0, 6) : r.error);
    if (!r.ok) return;
    const token = r.token;

    r = await call('objects:create', { token, name: 'PROBE-наценка', address: 'тест', client: 'тест', commissioning: false }, 'POST');
    log(r.ok && r.object, 'objects:create', r.ok ? 'id=' + r.object.id : r.error);
    const oid = r.object.id;

    // 1. наценка на материал на уровне объекта
    r = await call('objects:update', { token, id: oid, patch: { purchaseMarkup: true } }, 'POST');
    log(r.ok, 'objects:update purchaseMarkup', r.ok ? 'ok' : r.error);

    r = await call('object', { token, id: oid });
    log(r.ok && r.object && r.object.purchaseMarkup == 1, 'object.purchaseMarkup==1', r.ok ? 'purchaseMarkup=' + r.object.purchaseMarkup : r.error);

    // 2. закупка с несколькими фото
    r = await call('purchases:add', { token, objectId: oid, purchase: {
      date: '2026-10-16', name: 'Кабель ВВГ', qty: 10, price: 50, note: 'probe',
      photos: [PNG1x1, PNG1x1]
    } }, 'POST');
    log(r.ok && r.photos && r.photos.length === 2, 'purchases:add +2 фото', r.ok ? 'photos=' + (r.photos ? r.photos.length : 0) : r.error);

    r = await call('object', { token, id: oid });
    const pur = r.object && r.purchases && r.purchases[0];
    log(!!(pur && pur.photos && pur.photos.length === 2), 'purchases list photos', pur ? 'photos=' + (pur.photos ? pur.photos.length : 0) : 'нет');

    // 3. убираем наценку и закрываем объект (очистка)
    await call('objects:update', { token, id: oid, patch: { purchaseMarkup: false } }, 'POST');
    r = await call('objects:close', { token, id: oid }, 'POST');
    log(r.ok, 'objects:close (cleanup)', r.ok ? 'ok' : r.error);

    console.log('\nГОТОВО');
  } catch (e) {
    console.log('EXCEPTION', e.message);
  }
})();
