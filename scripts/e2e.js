// e2e.js — сквозная проверка API «Братство Электриков» (ТЗ).
// Запуск: node scripts/e2e.js
const API = 'https://script.google.com/macros/s/AKfycbyKu6vKUx7jihgcPfX-xg3QPaM9--E64qQQ8OewnRPqcoSSHETGTzRKMvIaEIANCm6y6w/exec';

async function call(action, params, method, attempt = 0) {
  method = method || 'GET';
  let url = API;
  const opts = { method, redirect: 'follow' };
  const body = Object.assign({ action }, params || {});
  if (method === 'GET') {
    const qs = [];
    for (const k in body) { const v = body[k]; if (v !== undefined && v !== null && v !== '') qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); }
    url += (url.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
  } else {
    opts.body = JSON.stringify(body);
    opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  }
  try {
    const r = await fetch(url, opts);
    const t = await r.text();
    return JSON.parse(t);
  } catch (e) {
    if (attempt < 2) { await sleep(900); return call(action, params, method, attempt + 1); }
    throw e;
  }
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  try {
    // 1. ping
    let r = await call('ping'); check('ping', r.ok, r.serverTime);

    // 2. prices
    r = await call('prices'); check('prices список', r.ok && Array.isArray(r.prices) && r.prices.length > 0, 'позиций=' + (r.prices ? r.prices.length : 0));

    // 3. login руководителя
    r = await call('login', { login: 'Руководитель', code: '0000' }, 'POST');
    check('login руководителя', r.ok && r.token, r.ok ? 'token=' + r.token.slice(0, 6) + '…' : r.error);
    if (!r.ok) throw new Error('login failed');
    const token = r.token;

    // 4. me
    r = await call('me', { token }); check('me', r.ok && r.user && r.user.role === 'Руководитель', r.ok ? r.user.role : r.error);

    // 5. users:list
    r = await call('users:list', { token }); check('users:list', r.ok && r.users.length >= 50, 'users=' + (r.users ? r.users.length : 0));

    // 6. objects (изначально)
    r = await call('objects', { token }); check('objects список', r.ok && Array.isArray(r.objects), 'objects=' + (r.objects ? r.objects.length : 0));

    // 7. create object
    r = await call('objects:create', { token, name: 'E2E-тест объект', address: 'ул. Тестовая, 1', client: 'Тестовый клиент', commissioning: true, master: 'Мастер 1' }, 'POST');
    check('objects:create', r.ok && r.object && r.object.id, r.ok ? 'id=' + r.object.id + ' code=' + r.object.code : r.error);
    const oid = r.object.id;
    const cabToken = r.cabinet && r.cabinet.token;

    // 8. records:add (расчёт)
    const price = (await call('prices')).prices.find(p => p.section && p.price) || (await call('prices')).prices[0];
    r = await call('records:add', { token, objectId: oid, line: { section: price.section, name: price.name, unit: price.unit, qty: 2, price: Number(price.price) || 100, coef: 1, material: 1, note: 'e2e' } }, 'POST');
    check('records:add', r.ok && r.result && typeof r.result.sum === 'number', 'sum=' + (r.ok ? r.result.sum : r.error));

    // 9. records:update
    let obj = await call('object', { token, id: oid });
    const line = obj.calc[0];
    r = await call('records:update', { token, objectId: oid, rowNum: line.__row, patch: { qty: 5 } }, 'POST');
    check('records:update', r.ok && r.result && typeof r.result.sum === 'number', 'newSum=' + (r.ok ? r.result.sum : r.error));

    // 10. records:recalc (с коэффициентом пусконаладки)
    r = await call('records:recalc', { token, objectId: oid }, 'POST');
    check('records:recalc (+30%)', r.ok && r.result.total > 0, 'total=' + (r.ok ? r.result.total : r.error) + ' lines=' + (r.ok ? r.result.lines : '?'));

    // 11. purchases:add
    r = await call('purchases:add', { token, objectId: oid, purchase: { date: '2026-10-14', name: 'Кабель ВВГ', qty: 10, price: 50, note: 'e2e' } }, 'POST');
    check('purchases:add', r.ok && r.result && r.result.sum === 500, 'sum=' + (r.ok ? r.result.sum : r.error));

    // 12. visits:add
    r = await call('visits:add', { token, objectId: oid, visit: { date: '2026-10-14', master: 'Мастер 1', dayNumber: 1, note: 'e2e день' } }, 'POST');
    check('visits:add', r.ok, r.ok ? 'ok' : r.error);

    // 13. object (полная выгрузка)
    obj = await call('object', { token, id: oid });
    check('object полный', obj.ok && obj.calc.length === 1 && obj.purchases.length === 1 && obj.visits.length === 1,
      'calc=' + obj.calc.length + ' pur=' + obj.purchases.length + ' vis=' + obj.visits.length);

    // 14. cabinet:create
    r = await call('cabinet:create', { token, id: oid }, 'POST');
    check('cabinet:create', r.ok && r.cabinet && r.cabinet.token, r.ok ? 'token=' + r.cabinet.token.slice(0, 6) + '…' : r.error);
    const ct = r.ok ? r.cabinet.token : cabToken;

    // 15. cabinet (публично, без токена)
    r = await call('cabinet', { cabinet: ct });
    check('cabinet публичный', r.ok && r.cabinet && r.cabinet.total > 0, 'total=' + (r.ok ? r.cabinet.total : r.error));

    // 16. cabinet неверный токен
    r = await call('cabinet', { cabinet: 'wrongtoken' });
    check('cabinet неверный токен → ошибка', !r.ok, r.error || 'нет ошибки');

    // 17. users:changeCode (админ меняет код мастера)
    const before = (await call('users:list', { token })).users.find(u => u.login === 'Мастер 1');
    r = await call('users:changeCode', { token, login: 'Мастер 1', oldCode: before.code, newCode: '9999' }, 'POST');
    check('users:changeCode', r.ok, r.ok ? 'ok' : r.error);
    // вернём код обратно
    await call('users:changeCode', { token, login: 'Мастер 1', oldCode: '9999', newCode: '1' }, 'POST');

    // 18. users:save
    r = await call('users:save', { token, user: { login: 'Мастер 2', role: 'мастер', name: 'Мастер 2', phone: '+79000000002', code: '2', active: 1 } }, 'POST');
    check('users:save', r.ok, r.ok ? 'ok' : r.error);

    // 19. status:report
    r = await call('status:report', { token });
    check('status:report', r.ok && r.report && r.report.money, 'objects=' + (r.ok ? r.report.counts.objects : '?') + ' profit=' + (r.ok ? r.report.money.profit : '?'));

    // 20. analytics
    r = await call('analytics', { token });
    check('analytics', r.ok && r.analytics && r.analytics.totals, 'calc=' + (r.ok ? r.analytics.totals.calc : '?'));

    // 21. objects:update
    r = await call('objects:update', { token, id: oid, patch: { address: 'ул. Изменённая, 2' } }, 'POST');
    check('objects:update', r.ok && r.object.address === 'ул. Изменённая, 2', r.ok ? r.object.address : r.error);

    // 22. objects:close → архив
    r = await call('objects:close', { token, id: oid }, 'POST');
    check('objects:close', r.ok && r.result && r.result.archive, 'archive=' + (r.ok ? r.result.archive : r.error));

    // 23. archive
    r = await call('archive', { token });
    const inArch = r.archive && r.archive.some(o => o.id == oid);
    check('archive содержит закрытый объект', r.ok && inArch, 'archive=' + (r.ok ? r.archive.length : '?') + ' наш=' + inArch);

    // 24. objects:delete (и очистка тестовых данных)
    r = await call('objects:delete', { token, id: oid }, 'POST');
    check('objects:delete', r.ok && r.result && r.result.deleted == oid, r.ok ? 'deleted id=' + r.result.deleted : r.error);

    // Очистка: удаляем любые оставшиеся объекты с пометкой E2E
    try {
      const all = await call('objects', { token });
      for (const o of (all.objects || [])) {
        if (o.name && o.name.indexOf('E2E-тест') >= 0) {
          await call('objects:delete', { token, id: o.id }, 'POST');
        }
      }
    } catch (e) {}

    const passed = results.filter(x => x.ok).length;
    console.log('\n=== ИТОГО: ' + passed + '/' + results.length + ' ===');
    process.exit(passed === results.length ? 0 : 1);
  } catch (e) {
    console.error('E2E ERROR:', e.message);
    console.log('\n=== ИТОГО: ' + results.filter(x => x.ok).length + '/' + results.length + ' (упал с ошибкой) ===');
    process.exit(1);
  }
})();
