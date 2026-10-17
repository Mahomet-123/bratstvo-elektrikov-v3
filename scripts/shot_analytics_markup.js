// shot_analytics_markup.js — снимает скриншот вкладки «Аналитика»
// панели руководителя с блоком «Наценка» (в таблице «По мастерам»
// и в нижних итогах «Всего наценка»).
// Мок fetch, как в ui_full_test.js / shot_purchase_markup.js.

const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8126;
const ROOT = path.resolve(__dirname, '..', 'public');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MOCK_JS = `
  (function () {
    function mockApi(action, p) {
      if (action === 'login') {
        var u = { login: 'Руководитель', code: '0000', role: 'Руководитель', name: 'Руководитель' };
        if (p.login === u.login && p.code === u.code) return { ok: true, token: 'mock-token', user: { login: u.login, role: u.role, name: u.name } };
        return { ok: false, error: 'bad_credentials' };
      }
      if (action === 'prices') return { ok: true, prices: [{ section: 'Монтажные', name: 'Распайка', unit: 'шт.', price: 150 }] };
      if (action === 'objects') return { ok: true, objects: [] };
      if (action === 'status:report') return { ok: true, report: {
        counts: { objects: 3, byStatus: { 'расчёт': 2, 'закрыт': 1 }, masters: 2 },
        money: { totalCalc: 62000, totalPurchase: 28000, profit: 34000 },
        lastVisits: []
      } };
      if (action === 'analytics') return { ok: true, analytics: {
        // Наценка считается на бэкенде: max(закупка*0.10, 1500) для объектов с purchaseMarkup.
        // Здесь подставлены уже посчитанные значения для наглядного скриншота.
        byMaster: {
          'Иван Иванов': { objects: 2, calc: 50000, purchase: 20000, markup: 2000 },
          'Пётр Петров': { objects: 1, calc: 12000, purchase: 8000, markup: 1500 }
        },
        bySection: { 'Монтажные работы': 50000, 'Черновые работы': 12000 },
        totals: { calc: 62000, purchase: 28000, markup: 3500 }
      } };
      if (action === 'archive') return { ok: true, archive: [] };
      if (action === 'users:list') return { ok: true, users: [
        { login: 'Руководитель', name: 'Руководитель', role: 'admin', active: true },
        { login: 'Мастер', name: 'Мастер', role: 'мастер', active: true }
      ] };
      return { ok: true };
    }
    function parseReq(url, opts) {
      var action, params = {};
      try {
        var method = (opts && opts.method) || 'GET';
        if (method === 'GET') {
          var qIdx = String(url).indexOf('?');
          if (qIdx >= 0) {
            String(url).substring(qIdx + 1).split('&').forEach(function (kv) {
              var i = kv.indexOf('=');
              if (i < 0) return;
              var k = decodeURIComponent(kv.substring(0, i));
              var v = decodeURIComponent(kv.substring(i + 1));
              if (k === 'action') action = v; else params[k] = v;
            });
          }
        } else {
          var obj = JSON.parse(String(opts && opts.body || '{}'));
          action = obj.action;
          Object.keys(obj).forEach(function (k) { if (k !== 'action') params[k] = obj[k]; });
        }
      } catch (e) {}
      return { action: action, params: params };
    }
    var origFetch = window.fetch;
    window.fetch = function (url, opts) {
      var u = String(url || '');
      if (u.indexOf('script.google.com/macros') < 0 && u.indexOf('/exec') < 0) {
        return origFetch.apply(this, arguments);
      }
      return new Promise(function (resolve) {
        setTimeout(function () {
          var parsed = parseReq(u, opts);
          var result = mockApi(parsed.action, parsed.params);
          resolve(new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          }));
        }, 5);
      });
    };
  })();
`;

function startServer() {
  return new Promise(function (resolve) {
    var types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    var server = http.createServer(function (req, res) {
      var url = (req.url || '/').split('?')[0];
      if (url === '/') url = '/index.html';
      var file = path.join(ROOT, url);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, function (err, data) {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        var ext = path.extname(file).toLowerCase();
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, function () { resolve(server); });
  });
}

function rec(step, ok, detail) {
  console.log((ok ? '✓ ' : '✗ ') + step + (detail ? ' — ' + JSON.stringify(detail) : ''));
}

(async function main() {
  var server = await startServer();
  var browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  var page = await browser.newPage();
  await page.setViewport({ width: 420, height: 820, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(MOCK_JS);

  page.on('pageerror', function (err) { console.log('PAGEERROR:', err.message); });
  page.on('console', function (msg) { if (msg.type() === 'error') console.log('CONSOLE.ERROR:', msg.text()); });

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForSelector('input[type="password"]', { timeout: 5000 });
  await page.type('input[autocomplete="username"]', 'Руководитель');
  await page.type('input[type="password"]', '0000');
  await page.click('button[type="submit"]');
  await page.waitForFunction(function () { return location.hash.indexOf('#/objects') === 0; }, { timeout: 10000 });
  rec('Логин', true);

  await page.evaluate(function () { location.hash = '#/admin'; });
  try {
    await page.waitForFunction(function () {
      return !!document.querySelector('.tabs') && Array.prototype.some.call(document.querySelectorAll('.section-head__title'), function (t) { return t.textContent.indexOf('Панель руководителя') >= 0; });
    }, { timeout: 6000 });
    rec('Панель руководителя открыта', true);
  } catch (e) {
    var diag = await page.evaluate(function () {
      return {
        hash: location.hash,
        isAdmin: (window.Store && Store.isAdmin && Store.isAdmin()) || false,
        bodyText: (document.body.innerText || '').slice(0, 300),
        hasTabs: !!document.querySelector('.tabs')
      };
    });
    console.log('DIAG admin:', JSON.stringify(diag));
    await page.screenshot({ path: path.join(__dirname, 'shot_analytics_markup.png'), fullPage: false });
    await browser.close(); server.close();
    process.exit(1);
  }

  // Переключаемся на вкладку «Аналитика» (по умолчанию открыта «Сводка»)
  var analyticsTab = await page.evaluate(function () {
    var btns = Array.prototype.slice.call(document.querySelectorAll('.tabs__btn'));
    var b = btns.find(function (x) { return x.textContent.trim() === 'Аналитика'; });
    if (b) { b.click(); return true; }
    return false;
  });
  rec('Открыта вкладка «Аналитика»', analyticsTab);

  await page.waitForSelector('table', { timeout: 5000 });
  await page.waitForFunction(function () { return /Наценка/.test(document.body.textContent || ''); }, { timeout: 5000 });
  rec('Таблица «По мастерам» с колонкой «Наценка» отрисована', true);

  var diag = await page.evaluate(function () {
    var cells = Array.prototype.slice.call(document.querySelectorAll('.totals__cell'));
    return {
      headHas: (document.body.textContent || '').indexOf('По мастерам') >= 0,
      totalHas: (document.body.textContent || '').indexOf('Всего наценка') >= 0,
      bottomCells: cells.map(function (c) { return c.textContent.replace(/\\s+/g, ' ').trim(); })
    };
  });
  rec('Нижние итоги содержат «Всего наценка»', diag.totalHas, diag);

  await page.screenshot({ path: path.join(__dirname, 'shot_analytics_markup.png'), fullPage: false });
  rec('Скриншот shot_analytics_markup.png сохранён', true);

  await browser.close();
  server.close();
  console.log('\\n==== Готово ====');
})().catch(function (e) { console.error('FATAL:', e); process.exit(1); });
