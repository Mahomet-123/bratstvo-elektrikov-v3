// Проверка адаптивности на мобильном вьюпорте (iPhone 12).
const puppeteer = require('puppeteer-core');
const https = require('https');

const API = 'https://script.google.com/macros/s/AKfycbyKu6vKUx7jihgcPfX-xg3QPaM9--E64qQQ8OewnRPqcoSSHETGTzRKMvIaEIANCm6y6w/exec';
const SITE = 'https://mahomet-123.github.io/bratstvo-elektrikov-v3/';

function api(action, params, method) {
  method = method || 'GET';
  const url = new URL(API);
  if (method === 'GET') { url.searchParams.set('action', action); Object.keys(params || {}).forEach(k => url.searchParams.set(k, params[k])); }
  const opts = { method: method, redirect: 'follow' };
  if (method === 'POST') { opts.body = JSON.stringify(Object.assign({ action }, params)); opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' }; }
  return fetch(url.toString(), opts).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch (e) { throw new Error('bad json: ' + t.slice(0, 200)); } });
}

async function apiRetry(action, params, method, tries) {
  tries = tries || 4;
  for (let i = 0; i < tries; i++) {
    try { return await api(action, params, method); }
    catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 2500));
    }
  }
}

(async () => {
  // 1. Создаём объект + кабинет через API, чтобы проверить скрытие таббара
  let token = null, cabToken = null;
  try {
    let a = await apiRetry('login', { login: 'Руководитель', code: '0000' }, 'POST');
    token = a.token;
    let o = await apiRetry('objects:create', { token, name: 'MOBILE-TEST-' + Date.now(), client: 'тест' }, 'POST');
    let cab = await apiRetry('cabinet:create', { token, id: o.object.id }, 'POST');
    cabToken = cab.cabinet.token;
  } catch (e) { console.log('API prepare error:', e.message); }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }).catch(async () => {
    return puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(SITE, { waitUntil: 'networkidle2', timeout: 30000 });

  const res = await page.evaluate(() => {
    const de = document.documentElement;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      hasAppbar: !!document.querySelector('.appbar'),
      hasTabbar: !!document.querySelector('#tabbar'),
      title: (document.querySelector('#appTitle') || {}).textContent || ''
    };
  });
  console.log('Главная (не авторизован):');
  console.log('  scrollWidth=%d clientWidth=%d горизонтальный скролл=%s', res.scrollWidth, res.clientWidth, res.scrollWidth > res.clientWidth + 2 ? 'ЕСТЬ (ПЛОХО)' : 'нет (OK)');
  console.log('  appbar=%s tabbar=%s title="%s"', res.hasAppbar, res.hasTabbar, res.title);

  // 2. Проверяем кабинет клиента — таббар должен быть скрыт
  if (cabToken) {
    await page.goto(SITE + '#/cabinet/' + cabToken, { waitUntil: 'networkidle2', timeout: 30000 });
    // Ждём появления блока кабинета (до 8 сек)
    let rendered = false;
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500));
      rendered = await page.evaluate(() => !!document.querySelector('.cabinet, .empty'));
      if (rendered) break;
    }
    const cab = await page.evaluate(() => {
      const tb = document.querySelector('#tabbar');
      const de = document.documentElement;
      const empty = document.querySelector('.empty');
      return {
        tabbarHidden: tb ? tb.hidden : null,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        hasCabinet: !!document.querySelector('.cabinet'),
        emptyText: empty ? (empty.textContent || '').trim().slice(0, 80) : null
      };
    });
    console.log('Кабинет клиента (#/cabinet/' + cabToken + '):');
    console.log('  tabbar.hidden=%s (ожидается true) %s', cab.tabbarHidden, cab.tabbarHidden === true ? 'OK' : 'ПЛОХО');
    console.log('  горизонтальный скролл=%s', cab.scrollWidth > cab.clientWidth + 2 ? 'ЕСТЬ (ПЛОХО)' : 'нет (OK)');
    console.log('  syncBtn скрыт (hidden)=%s', await page.evaluate(() => document.querySelector('#syncBtn').hidden));
    console.log('  cabinet отрисован=%s', cab.hasCabinet);
    if (!cab.hasCabinet && cab.emptyText) console.log('  текст ошибки/пусто: "%s"', cab.emptyText);
  }

  await browser.close();
  console.log('\nГотово.');
})().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
