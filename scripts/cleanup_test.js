// Удаляет тестовые объекты (MOBILE-TEST-*, WEBP-TEST-*), созданные при проверках.
const API = 'https://script.google.com/macros/s/AKfycbyKu6vKUx7jihgcPfX-xg3QPaM9--E64qQQ8OewnRPqcoSSHETGTzRKMvIaEIANCm6y6w/exec';
function api(action, params, method) {
  method = method || 'GET';
  const url = new URL(API);
  if (method === 'GET') { url.searchParams.set('action', action); Object.keys(params || {}).forEach(k => url.searchParams.set(k, params[k])); }
  const opts = { method: method, redirect: 'follow' };
  if (method === 'POST') { opts.body = JSON.stringify(Object.assign({ action }, params)); opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' }; }
  return fetch(url.toString(), opts).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch (e) { throw new Error('bad json: ' + t.slice(0, 200)); } });
}
async function apiRetry(action, params, method, tries) {
  for (let i = 0; i < (tries || 4); i++) {
    try { return await api(action, params, method); }
    catch (e) { if (i === (tries || 4) - 1) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}
(async () => {
  try {
    let a = await apiRetry('login', { login: 'Руководитель', code: '0000' }, 'POST');
    const token = a.token;
    let list = await apiRetry('objects', { token }, 'GET');
    const objs = (list.objects || []).filter(o => /^(MOBILE-TEST|WEBP-TEST)/.test(o.name || ''));
    console.log('Найдено тестовых объектов:', objs.length);
    for (const o of objs) {
      let d = await apiRetry('objects:delete', { token, id: o.id }, 'POST');
      console.log('  удалён id=' + o.id + ' name=' + o.name + ' →', d.ok ? 'OK' : JSON.stringify(d));
    }
    console.log('Готово.');
  } catch (e) { console.log('ERR', e.message); }
})();
