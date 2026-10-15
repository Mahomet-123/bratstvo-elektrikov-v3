/**
 * probe_prices.js — проверка живого эндпоинта prices и reseed.
 * Диагностический скрипт, не часть приложения.
 */
const API = 'https://script.google.com/macros/s/AKfycbyKu6vKUx7jihgcPfX-xg3QPaM9--E64qQQ8OewnRPqcoSSHETGTzRKMvIaEIANCm6y6w/exec';
const TOKEN = 'bratstvo-admin-2026';

async function call(body) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return { raw: t.slice(0, 500) }; }
}

function summarize(prices) {
  if (!Array.isArray(prices)) { console.log('  цены — не массив:', typeof prices); return; }
  console.log('  всего позиций:', prices.length);
  const s = {};
  prices.forEach(p => { s[p.section] = (s[p.section] || 0) + 1; });
  console.log('  по секциям:', JSON.stringify(s));
  const t = {};
  prices.forEach(p => { t[p.type] = (t[p.type] || 0) + 1; });
  console.log('  по типам:', JSON.stringify(t));
}

(async () => {
  console.log('=== ДО reseed: prices ===');
  let r = await call({ action: 'prices' });
  if (!r.ok) { console.log('  ОШИБКА:', JSON.stringify(r).slice(0, 300)); }
  else { summarize(r.prices); }

  console.log('\n=== Запуск seed (token) ===');
  r = await call({ action: 'seed', token: TOKEN });
  console.log('  ответ:', JSON.stringify(r).slice(0, 500));

  console.log('\n=== ПОСЛЕ reseed: prices ===');
  r = await call({ action: 'prices' });
  if (!r.ok) { console.log('  ОШИБКА:', JSON.stringify(r).slice(0, 300)); }
  else { summarize(r.prices); }
})().catch(e => console.error('Ошибка:', e.message));
