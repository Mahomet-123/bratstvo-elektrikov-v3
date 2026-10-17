// shot_purchase_markup.js — снимает скриншот вкладки «Закупка»
// в двух состояниях: с включённой и выключенной наценкой.
// Использует ту же технику мока fetch, что и ui_full_test.js.

const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8125;
const ROOT = path.resolve(__dirname, '..', 'public');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MOCK_JS = `
  (function () {
    function sum(arr) { return (arr || []).reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0); }
    var OBJ_ID = '1792206398570';
    function makeDb(markupOn) {
      var obj = { id: OBJ_ID, name: 'Квартира на Ленина', status: 'расчёт', purchaseMarkup: markupOn ? 1 : 0 };
      return {
        users: [
          { login: 'Руководитель', code: '0000', role: 'admin', name: 'Руководитель' },
          { login: 'Мастер', code: '1111', role: 'master', name: 'Мастер' }
        ],
        prices: [
          { section: 'Монтажные', name: 'Распайка', unit: 'шт.', price: 150 }
        ],
        objects: [obj],
        data: {
          [OBJ_ID]: {
            object: obj,
            calc: [],
            // Суммы подобраны так, чтобы 10% было ВЫШЕ минимума 1500:
            //   10000 * 0.10 = 1000 → минимум 1500 → наценка 1500
            //   20000 * 0.10 = 2000 → выше минимума → наценка 2000
            // Возьмём сумму 20000, тогда наценка 2000, итого 22000.
            purchases: [
              { __row: 1001, name: 'Кабель ВВГнг 3x2.5', qty: 100, price: 150, sum: 15000, unit: 'м', date: '2026-10-10' },
              { __row: 1002, name: 'Розетка с заземлением', qty: 14, price: 500, sum: 5000, unit: 'шт.', date: '2026-10-12' }
            ],
            visits: []
          }
        },
        cabinets: {}
      };
    }
    var DB = makeDb(true); // стартуем с включённой наценкой
    function mockApi(action, p) {
      if (action === 'login') {
        var u = DB.users.find(function (x) { return x.login === p.login && x.code === p.code; });
        if (!u) return { ok: false, error: 'bad_credentials' };
        return { ok: true, token: 'mock-token', user: { login: u.login, role: u.role, name: u.name } };
      }
      if (action === 'prices') return { ok: true, prices: DB.prices };
      if (action === 'objects') return { ok: true, objects: DB.objects };
      if (action === 'object') {
        // Плоский формат: коллекции на верхнем уровне, рядом с object.
        // Именно так app хранит OBJ[id] (см. objectCard.js: OBJ[id] = d).
        var d = DB.data[String(p.id)];
        if (!d) return { ok: false, error: 'not_found' };
        return { ok: true, object: d.object, calc: d.calc || [], purchases: d.purchases || [], visits: d.visits || [] };
      }
      if (action === 'objects:update') {
        var d2 = DB.data[String(p.id)];
        if (d2 && d2.object && p.patch) Object.assign(d2.object, p.patch);
        return { ok: true };
      }
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
    window.__mockHits = [];
    window.fetch = function (url, opts) {
      var u = String(url || '');
      if (u.indexOf('script.google.com/macros') < 0 && u.indexOf('/exec') < 0) {
        return origFetch.apply(this, arguments);
      }
      return new Promise(function (resolve) {
        setTimeout(function () {
          var parsed = parseReq(u, opts);
          var result = mockApi(parsed.action, parsed.params);
          window.__mockHits.push({ action: parsed.action, params: parsed.params, result: result });
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
  var tag = ok ? '✓' : '✗';
  console.log(tag + ' ' + step + (detail ? ' — ' + JSON.stringify(detail) : ''));
}

async function snap(page, file) {
  var out = path.join(__dirname, file);
  await page.screenshot({ path: out, fullPage: false });
  rec('Скриншот сохранён', true, { file: out });
}

(async function main() {
  var server = await startServer();
  var browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  var page = await browser.newPage();
  await page.setViewport({ width: 420, height: 760, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(MOCK_JS);

  page.on('pageerror', function (err) { console.log('PAGEERROR:', err.message); });
  page.on('console', function (msg) {
    if (msg.type() === 'error') console.log('CONSOLE.ERROR:', msg.text());
  });

  // Логин
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForSelector('input[type="password"]', { timeout: 5000 });
  await page.type('input[autocomplete="username"]', 'Руководитель');
  await page.type('input[type="password"]', '0000');
  await page.click('button[type="submit"]');
  await page.waitForFunction(function () { return location.hash.indexOf('#/objects') === 0; }, { timeout: 10000 });
  rec('Логин', true, { hash: await page.evaluate(function () { return location.hash; }) });

  // В карточку объекта
  await page.evaluate(function () { location.hash = '#/object/1792206398570'; });
  await page.waitForSelector('.tabs', { timeout: 5000 });
  rec('Карточка объекта открыта', true);

  // На вкладку «Закупка»
  var clicked = await page.evaluate(function () {
    var btns = Array.prototype.slice.call(document.querySelectorAll('.tabs__btn'));
    var b = btns.find(function (x) { return /Закупка/.test(x.textContent); });
    if (b) { b.click(); return true; }
    return false;
  });
  rec('Перешли на вкладку «Закупка»', clicked);

  // Даём время на fetch + рендер
  await new Promise(function (r) { setTimeout(r, 2000); });

  // Диагностика: какие action дёрнул мок
  var hits = await page.evaluate(function () { return window.__mockHits || []; });
  rec('Мок: список вызовов', true, { count: hits.length, actions: hits.map(function (h) { return h.action; }) });
  var lastObj = hits.filter(function (h) { return h.action === 'object'; }).slice(-1)[0];
  if (lastObj) {
    rec('Последний ответ «object»', true, { hasPurchases: !!(lastObj.result && lastObj.result.object && lastObj.result.object.purchases), purCount: (lastObj.result && lastObj.result.object && lastObj.result.object.purchases || []).length });
  }

  // Снимок 1: наценка ВКЛ (мок seeded с purchaseMarkup: 1)
  var totalsOn = await page.evaluate(function () {
    var cells = Array.prototype.slice.call(document.querySelectorAll('.totals__cell'));
    return cells.map(function (c) { return c.textContent.replace(/\\s+/g, ' ').trim(); });
  });
  rec('Состояние «наценка ВКЛ»', true, { cells: totalsOn });
  await snap(page, 'shot_purchase_markup_on.png');

  // Выключаем наценку через модалку добавления закупки:
  //   1) кликаем «＋ Добавить» → откроется модалка
  //   2) находим чекбокс «Наценка на материал…» и снимаем галочку
  //      (change-handler кладёт 0 в OBJ[id].object.purchaseMarkup, но НЕ ререндерит вкладку)
  //   3) закрываем модалку
  //   4) форсируем ререндер: уходим на «Расчёт» и возвращаемся в «Закупка»
  await page.evaluate(function () {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    var b = btns.find(function (x) { return /Добавить/.test(x.textContent) && /Добавить закупку/.test(x.getAttribute('aria-label') || ''); });
    if (b) b.click();
  });
  await page.waitForSelector('.modal .checkbox', { timeout: 5000 });
  var unchecked = await page.evaluate(function () {
    var lbl = document.querySelector('.modal .checkbox');
    if (lbl && lbl.textContent.indexOf('Наценка') >= 0) {
      var cb = lbl.querySelector('input[type="checkbox"]');
      if (cb && cb.checked) { cb.click(); return true; }
    }
    return false;
  });
  rec('Сняли галочку «Наценка на материал…» в модалке', unchecked);
  await new Promise(function (r) { setTimeout(r, 300); });
  // Закрываем модалку (кнопка «Отмена»)
  await page.evaluate(function () {
    var btns = Array.prototype.slice.call(document.querySelectorAll('.modal button'));
    var cancel = btns.find(function (x) { return x.textContent.trim() === 'Отмена'; });
    if (cancel) cancel.click();
  });
  // Форсируем ререндер вкладки «Закупка» (читает обновлённый OBJ[id])
  await page.evaluate(function () {
    var btns = Array.prototype.slice.call(document.querySelectorAll('.tabs__btn'));
    var calc = btns.find(function (x) { return /Расчёт/.test(x.textContent); });
    if (calc) calc.click();
  });
  await new Promise(function (r) { setTimeout(r, 200); });
  await page.evaluate(function () {
    var btns = Array.prototype.slice.call(document.querySelectorAll('.tabs__btn'));
    var pur = btns.find(function (x) { return /Закупка/.test(x.textContent); });
    if (pur) pur.click();
  });
  // Ждём пересчёт: Наценка должна стать 0 ₽
  await page.waitForFunction(function () {
    var cells = document.querySelectorAll('.totals__cell');
    if (cells.length < 2) return false;
    var markupCell = cells[1];
    return markupCell && /Наценка/.test(markupCell.textContent) && /0\s*₽/.test(markupCell.textContent);
  }, { timeout: 5000 });
  await new Promise(function (r) { setTimeout(r, 200); });
  var totalsOff = await page.evaluate(function () {
    var cells = Array.prototype.slice.call(document.querySelectorAll('.totals__cell'));
    return cells.map(function (c) { return c.textContent.replace(/\\s+/g, ' ').trim(); });
  });
  rec('Состояние «наценка ВЫКЛ»', true, { cells: totalsOff });
  await snap(page, 'shot_purchase_markup_off.png');

  await browser.close();
  server.close();
  console.log('\\n==== Готово ====');
})().catch(function (e) { console.error('FATAL:', e); process.exit(1); });
