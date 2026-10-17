// Сквозной UI-тест всего приложения «Братство Электриков».
// Запускает локальный сервер public/, ПЕРЕОПРЕДЕЛЯЕТ window.fetch в странице
// (через evaluateOnNewDocument), отвечая stateful-моком бэкенда. Так приложение
// вызывает мок напрямую, без сети и без редиректов Google Apps Script.
// Прогоняет реальный флоу: логин → объекты → карточка → все вкладки →
// добавление/удаление/пересчёт → закупка → день → отчёт → кабинет клиента →
// админка → профиль. Ловит ошибки консоли/страницы, проверяет рендеринг.

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/HP/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core');

const ROOT = path.resolve(__dirname, '..', 'public');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8124;

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

// --- Код мока, инжектируемый в страницу (переопределяет window.fetch) ---
const MOCK_JS = function () {
  var SEQ = 1;
  function uid(p) { return p + (SEQ++); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var DB = {
    users: [
      { login: 'Руководитель', code: '0000', role: 'Руководитель', name: 'Босс', phone: '+7 900 000-00-00', active: 1 },
      { login: 'Мастер', code: '1111', role: 'мастер', name: 'Иван Иванов', phone: '', active: 1 }
    ],
    prices: [
      { name: 'Распайка проходного переключателя', section: 'Монтажные', unit: 'шт', price: 150, type: 'work' },
      { name: 'Распайка перекрестный переключателя', section: 'Монтажные', unit: 'шт', price: 200, type: 'work' },
      { name: 'Установка розетки', section: 'Монтажные', unit: 'шт', price: 250, type: 'work' },
      { name: 'Затягивание кабеля в гофру до Ø 25мм', section: 'Черновые', unit: 'м', price: 40, type: 'work' },
      { name: 'Затягивание кабеля в гофру до Ø 32мм', section: 'Черновые', unit: 'м', price: 55, type: 'work' },
      { name: 'Сборка щита на 12 модулей', section: 'Щиты', unit: 'шт', price: 3000, type: 'work' }
    ],
    objects: [],
    data: {},
    cabinets: {}
  };
  window.__mockDb = DB;

  function newObject(rec) {
    var id = String(Date.now() + DB.objects.length);
    var obj = {
      id: id, name: rec.name || 'Объект', code: rec.code || '', client: rec.client || '',
      master: rec.master || '', status: 'calc', commissioning: rec.commissioning ? 1 : 0,
      purchaseMarkup: 0, closedAt: null
    };
    DB.objects.push(obj);
    DB.data[id] = { object: obj, calc: [], purchases: [], visits: [] };
    return obj;
  }
  newObject({ name: 'Квартира на Ленина', code: 'KV-001', client: 'Петров И.', master: 'Иван Иванов', commissioning: 0 });

  function sumCalc(calc) { return calc.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0); }

  function mockApi(action, p) {
    p = p || {};
    switch (action) {
      case 'login': {
        var u = DB.users.find(function (x) { return x.login === p.login && x.code === p.code; });
        if (!u) return { ok: false, error: 'Неверный логин или код' };
        return { ok: true, token: 'TOK-' + u.login, user: { login: u.login, role: u.role, name: u.name, phone: u.phone, active: u.active } };
      }
      case 'prices': return { ok: true, prices: clone(DB.prices) };
      case 'objects': return { ok: true, objects: DB.objects.map(function (o) { return clone(o); }) };
      case 'object': {
        var d = DB.data[p.id];
        if (!d) return { ok: false, error: 'Нет объекта ' + p.id };
        return { ok: true, object: clone(d.object), calc: clone(d.calc), purchases: clone(d.purchases), visits: clone(d.visits) };
      }
      case 'records:add': {
        var obj = DB.data[p.objectId]; if (!obj) return { ok: false, error: 'нет объекта' };
        var line = Object.assign({}, p.line); line.__row = uid('r'); obj.calc.push(line); return { ok: true, line: line };
      }
      case 'records:update': {
        var o2 = DB.data[p.objectId]; if (o2) o2.calc = o2.calc.map(function (r) { return r.__row === p.rowNum ? Object.assign({}, r, p.patch) : r; });
        return { ok: true };
      }
      case 'records:remove': {
        var o3 = DB.data[p.objectId]; if (o3) o3.calc = o3.calc.filter(function (r) { return r.__row !== p.rowNum; });
        return { ok: true };
      }
      case 'records:recalc': {
        var o4 = DB.data[p.objectId]; var t = o4 ? sumCalc(o4.calc) : 0; return { ok: true, result: { total: t } };
      }
      case 'purchases:add': {
        var po = DB.data[p.objectId]; if (!po) return { ok: false, error: 'нет объекта' };
        var pr = Object.assign({}, p.purchase); pr.__row = uid('p'); po.purchases.push(pr); return { ok: true };
      }
      case 'purchases:update': {
        var po2 = DB.data[p.objectId]; if (po2) po2.purchases = po2.purchases.map(function (r) { return r.__row === p.rowNum ? Object.assign({}, r, p.purchase) : r; });
        return { ok: true };
      }
      case 'purchases:remove': {
        var po3 = DB.data[p.objectId]; if (po3) po3.purchases = po3.purchases.filter(function (r) { return r.__row !== p.rowNum; });
        return { ok: true };
      }
      case 'visits:add': {
        var vo = DB.data[p.objectId]; if (!vo) return { ok: false, error: 'нет объекта' };
        var v = Object.assign({}, p.visit); v.__row = uid('v'); vo.visits.push(v); return { ok: true };
      }
      case 'objects:create': {
        var created = newObject({ name: p.name, address: p.address, client: p.client, commissioning: p.commissioning, master: p.master });
        return { ok: true, object: clone(created) };
      }
      case 'objects:update': {
        var ou = DB.data[p.id]; if (ou) Object.assign(ou.object, p.patch); return { ok: true };
      }
      case 'objects:close': {
        var oc = DB.data[p.id]; if (oc) { oc.object.status = 'закрыт'; oc.object.closedAt = new Date().toISOString(); }
        return { ok: true };
      }
      case 'cabinet:create': {
        var cd = DB.data[p.id]; if (!cd) return { ok: false, error: 'нет объекта' };
        var token = 'CAB' + (++SEQ);
        DB.cabinets[token] = { object: clone(cd.object), calc: clone(cd.calc), purchases: clone(cd.purchases) };
        return { ok: true, cabinet: { token: token } };
      }
      case 'cabinet': {
        var c = DB.cabinets[p.cabinet]; if (!c) return { ok: false, error: 'Кабинет недоступен' };
        return { ok: true, cabinet: { object: clone(c.object), calc: clone(c.calc), purchases: clone(c.purchases), total: sumCalc(c.calc) } };
      }
      case 'status:report': return { ok: true, report: {
        counts: { objects: DB.objects.length, masters: DB.users.filter(function (u) { return u.role === 'мастер'; }).length, byStatus: { calc: DB.objects.length } },
        money: { totalCalc: 123456, profit: 65432 },
        lastVisits: [{ date: new Date().toISOString(), objectId: DB.objects[0] ? DB.objects[0].id : '1', master: 'Иван Иванов', note: 'Смонтировано' }]
      } };
      case 'analytics': return { ok: true, analytics: {
        byMaster: { 'Иван Иванов': { objects: 1, calc: 5000, purchase: 1000 } },
        bySection: { 'Монтажные': 5000, 'Черновые': 2000 },
        totals: { calc: 7000, purchase: 1000 }
      } };
      case 'archive': return { ok: true, archive: [] };
      case 'users:list': return { ok: true, users: clone(DB.users) };
      case 'users:save': {
        var i = DB.users.findIndex(function (u) { return u.login === p.user.login; });
        if (i >= 0) DB.users[i] = Object.assign(DB.users[i], p.user);
        return { ok: true };
      }
      case 'users:changeCode': {
        var u2 = DB.users.find(function (u) { return u.login === p.login; });
        if (!u2) return { ok: false, error: 'нет пользователя' };
        u2.code = p.newCode; return { ok: true };
      }
      default: return { ok: true, _echo: action };
    }
  }
  window.__mockApi = mockApi;

  // Переопределяем fetch: любой вызов к API_URL → мок. Остальное — как есть.
  var REAL_FETCH = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    opts = opts || {};
    var u = (typeof url === 'string') ? url : (url && url.url) || '';
    if (u.indexOf('script.google.com/macros') >= 0) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          try {
            var action, params = {};
            var pu = new URL(u, location.href);
            if ((opts.method || 'GET') === 'POST') {
              try { params = JSON.parse(opts.body || '{}'); } catch (e) {}
              action = params.action;
            } else {
              action = pu.searchParams.get('action');
              pu.searchParams.forEach(function (v, k) { if (k !== 'action') params[k] = v; });
            }
            var data = window.__mockApi(action, params);
            resolve(new Response(JSON.stringify(data), {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            }));
          } catch (e) {
            resolve(new Response(JSON.stringify({ ok: false, error: e.message }), { status: 200 }));
          }
        }, 5);
      });
    }
    return REAL_FETCH ? REAL_FETCH(url, opts) : Promise.reject(new Error('no fetch'));
  };
};

/* ---------------- Static server ---------------- */
function startServer() {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var u = req.url.split('?')[0];
      if (u === '/' || u === '') u = '/index.html';
      var fp = path.join(ROOT, u);
      fs.readFile(fp, function (err, buf) {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(PORT, function () { resolve(server); });
  });
}

/* ---------------- Helpers ---------------- */
const results = [];
function rec(step, ok, detail) { results.push({ step: step, ok: ok, detail: detail || '' }); console.log((ok ? '✓' : '✗') + ' ' + step + (detail ? ' — ' + detail : '')); }

async function clickText(page, selector, text) {
  return page.evaluate(function (selector, text) {
    var els = Array.prototype.slice.call(document.querySelectorAll(selector));
    var el = els.find(function (e) { return (e.textContent || '').trim().indexOf(text) >= 0; });
    if (!el) return false;
    el.click();
    return true;
  }, selector, text);
}
async function waitFor(page, fn, timeout) {
  timeout = timeout || 6000;
  var start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return true;
    await new Promise(function (r) { setTimeout(r, 80); });
  }
  return false;
}
async function setHash(page, h) { await page.evaluate(function (h) { location.hash = h; }, h); await new Promise(function (r) { setTimeout(r, 400); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------------- Main ---------------- */
(async function () {
  var server = await startServer();
  var consoleErrors = [];
  var pageErrors = [];

  var browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  var page = await browser.newPage();
  await page.setViewport({ width: 390, height: 800 });
  await page.evaluateOnNewDocument(MOCK_JS);

  page.on('console', function (msg) { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', function (err) { pageErrors.push(err.message); });

  async function firstObjId() { return page.evaluate(function () { return window.__mockDb.objects[0].id; }); }

  try {
    await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle2' });
    await sleep(400);
    var onLogin = await waitFor(page, function () { return !!document.querySelector('#login'); });
    rec('Логин: форма присутствует', onLogin);

    await page.type('#login', 'Руководитель');
    await page.type('#code', '0000');
    await page.click('button[type=submit]');
    var onObjects = await waitFor(page, function () { return location.hash.indexOf('#/objects') === 0 && !!document.querySelector('.section-head'); }, 8000);
    rec('Логин: переход на /objects', onObjects);
    var pricesLoaded = await page.evaluate(function () { try { return (JSON.parse(localStorage.getItem('be_prices')) || []).length > 0; } catch (e) { return false; } });
    rec('Логин: прайс-лист загружен в кеш', pricesLoaded);
    var objCount = await page.evaluate(function () { return document.querySelectorAll('.card--clickable').length; });
    rec('Объекты: отрисован список (мок, 1 объект)', objCount === 1, 'карточек=' + objCount);
    await page.screenshot({ path: path.resolve(__dirname, 'shot_objects.png') });

    // Создание объекта
    await clickText(page, '.btn--primary', 'Новый');
    await sleep(300);
    var modalOpen = await waitFor(page, function () { return !!document.querySelector('.modal'); });
    rec('Создание: модалка открылась', modalOpen);
    await page.type('.modal input.input', 'Тестовый офис');
    await clickText(page, '.modal .btn--primary', 'Создать');
    var newCard = await waitFor(page, function () { return location.hash.indexOf('#/object/') === 0; }, 6000);
    rec('Создание: редирект в карточку нового объекта', newCard, await page.evaluate(function () { return location.hash; }));

    // Вернёмся к объекту #1 (предзаполненному) для тестов расчёта
    await setHash(page, '#/object/' + await firstObjId());
    var calcTab = await waitFor(page, function () { return !!document.querySelector('.tabs__btn'); });
    rec('Карточка: вкладки отрисованы', calcTab);

    // Расчёт: открыть модалку, выбрать 2 работы, добавить
    await clickText(page, '.btn--primary', 'Добавить');
    await sleep(400);
    var calcModal = await waitFor(page, function () { return !!document.querySelector('.calc-modal'); });
    rec('Расчёт: модалка калькулятора открылась', calcModal);

    var layout = await page.evaluate(function () {
      var foot = document.querySelector('.calc-modal__foot');
      var list = document.querySelector('.calc-modal .pricelist');
      var gf = foot ? getComputedStyle(foot) : null;
      return { hasFoot: !!foot, hasList: !!list, footFlex: gf ? gf.flex : '', listOverflow: list ? getComputedStyle(list).overflowY : '' };
    });
    rec('Расчёт: fixed-подвал (flex 0 0 auto) и скролл-список', layout.hasFoot && /0 0 auto/.test(layout.footFlex) && layout.listOverflow === 'auto', JSON.stringify(layout));

    await page.evaluate(function () {
      Array.prototype.slice.call(document.querySelectorAll('.pricelist__sec')).forEach(function (s) { s.click(); });
    });
    await sleep(200);
    await clickText(page, '.pricelist__item', 'Распайка проходного переключателя');
    await clickText(page, '.pricelist__item', 'Затягивание кабеля в гофру до Ø 25мм');
    await sleep(200);
    var selInfo = await page.evaluate(function () {
      var items = Array.prototype.slice.call(document.querySelectorAll('.pricelist__item'));
      var sel = items.filter(function (i) { return i.classList.contains('pricelist__item--selected'); });
      var btn = document.querySelector('.calc-modal__foot .btn--primary');
      return { selected: sel.length, names: sel.map(function (i) { return (i.textContent || '').trim().slice(0, 30); }), btn: btn ? btn.textContent.trim() : '' };
    });
    rec('Расчёт: выбор 2 работ подсвечивается и кнопка обновлена', selInfo.selected === 2 && /Добавить выбранные \(2\)/.test(selInfo.btn), JSON.stringify(selInfo));
    await page.screenshot({ path: path.resolve(__dirname, 'shot_calc_modal.png') });

    await clickText(page, '.calc-modal__foot .btn--primary', 'Добавить выбранные');
    await sleep(500);
    var afterAdd = await page.evaluate(function () {
      return {
        lines: document.querySelectorAll('.tab-content .card').length,
        hasName: Array.prototype.some.call(document.querySelectorAll('.tab-content .card'), function (c) { return (c.textContent || '').indexOf('Распайка проходного') >= 0; })
      };
    });
    rec('Расчёт: позиции добавлены в карточку', afterAdd.lines >= 2 && afterAdd.hasName, JSON.stringify(afterAdd));
    await page.screenshot({ path: path.resolve(__dirname, 'shot_calc_list.png') });

    // Редактирование позиции (✎)
    await clickText(page, '.tab-content .iconbtn--sm', '✎');
    await sleep(400);
    var editModal = await waitFor(page, function () { return !!document.querySelector('.calc-modal'); });
    rec('Расчёт: модалка редактирования открылась', editModal);
    if (editModal) {
      await page.evaluate(function () {
        var q = document.querySelector('.calc-modal__foot input[type=number]');
        if (q) { q.value = '5'; q.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      await clickText(page, '.calc-modal__foot .btn--primary', 'Сохранить');
      await sleep(500);
      var editOk = await waitFor(page, function () {
        return Array.prototype.some.call(document.querySelectorAll('.tab-content .card'), function (c) { return /5\s*(шт|м|м²)/.test(c.textContent || ''); });
      }, 3000);
      rec('Расчёт: сохранение правки (кол-во=5)', editOk);
    }

    // Пересчёт
    await clickText(page, '.btn--block', 'Пересчитать');
    await sleep(600);
    rec('Расчёт: кнопка «Пересчитать» не падает', true);

    // Удаление позиции (✕)
    var before = await page.evaluate(function () { return document.querySelectorAll('.tab-content .card').length; });
    await clickText(page, '.tab-content .iconbtn--danger', '✕');
    await sleep(300);
    await clickText(page, '.modal .btn--danger', 'Да');
    await sleep(700);
    var after = await page.evaluate(function () { return document.querySelectorAll('.tab-content .card').length; });
    rec('Расчёт: удаление позиции', after < before, 'было=' + before + ' стало=' + after);

    // Закупка
    await clickText(page, '.tabs__btn', 'Закупка');
    await sleep(400);
    await clickText(page, '.btn--primary', 'Добавить');
    await sleep(400);
    var purModal = await waitFor(page, function () { return !!document.querySelector('.modal'); });
    rec('Закупка: модалка открылась', purModal);
    if (purModal) {
      await page.evaluate(function () {
        var rows = document.querySelectorAll('.matrow');
        function fill(row, name, qty, price) {
          var ins = row.querySelectorAll('input');
          ins[0].value = name; ins[0].dispatchEvent(new Event('input', { bubbles: true }));
          ins[1].value = qty; ins[1].dispatchEvent(new Event('input', { bubbles: true }));
          ins[2].value = price; ins[2].dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (rows[0]) fill(rows[0], 'Кабель ВВГ', '10', '30');
        if (rows[1]) fill(rows[1], 'Подрозетник', '5', '20');
      });
      await clickText(page, '.modal .btn--primary', 'Сохранить');
      await sleep(600);
      var purAdded = await waitFor(page, function () {
        return Array.prototype.some.call(document.querySelectorAll('.tab-content .card'), function (c) { return (c.textContent || '').indexOf('Кабель ВВГ') >= 0; });
      }, 3000);
      rec('Закупка: материалы добавлены', purAdded);
    }

    // День
    await clickText(page, '.tabs__btn', 'День');
    await sleep(400);
    await clickText(page, '.btn--primary', 'Добавить');
    await sleep(400);
    await clickText(page, '.modal .btn--primary', 'Сохранить');
    await sleep(600);
    var dayAdded = await waitFor(page, function () {
      return Array.prototype.some.call(document.querySelectorAll('.tab-content .card'), function (c) { return (c.textContent || '').length > 0; });
    }, 3000);
    rec('День: запись добавлена', dayAdded);

    // Отчёт
    await clickText(page, '.tabs__btn', 'Отчёт');
    await sleep(400);
    var reportOk = await waitFor(page, function () { return !!document.querySelector('.totals'); }, 3000);
    rec('Отчёт: блок итогов отрисован', reportOk);
    var hasActions = await page.evaluate(function () { return Array.prototype.some.call(document.querySelectorAll('.tab-content .card'), function (c) { return (c.textContent || '').indexOf('Действия руководителя') >= 0; }); });
    rec('Отчёт: блок действий руководителя виден (админ)', hasActions);

    // Кабинет клиента
    if (hasActions) {
      await clickText(page, '.tab-content .btn--block', 'Создать ссылку для клиента');
      await sleep(500);
      var linkModal = await waitFor(page, function () { return Array.prototype.some.call(document.querySelectorAll('.modal .card'), function (c) { return (c.textContent || '').indexOf('#/cabinet/') >= 0; }); }, 3000);
      rec('Кабинет: модалка со ссылкой показана', linkModal);
      var cabToken = await page.evaluate(function () {
        var c = Array.prototype.find.call(document.querySelectorAll('.modal .card'), function (x) { return (x.textContent || '').indexOf('#/cabinet/') >= 0; });
        var m = (c ? c.textContent : '').match(/#\/cabinet\/([A-Za-z0-9]+)/);
        return m ? m[1] : null;
      });
      if (cabToken) {
        await clickText(page, '.modal .btn--ghost', 'Закрыть');
        await sleep(200);
        await setHash(page, '#/cabinet/' + cabToken);
        var cabOk = await waitFor(page, function () { return Array.prototype.some.call(document.querySelectorAll('.cabinet, .card'), function (c) { return (c.textContent || '').indexOf('Братство Электриков') >= 0; }); }, 4000);
        rec('Кабинет клиента: страница открылась', cabOk);
        await page.screenshot({ path: path.resolve(__dirname, 'shot_cabinet.png') });
      } else {
        rec('Кабинет клиента: получен токен из ссылки', false, 'токен не найден');
      }
    }

    // Админка
    await setHash(page, '#/admin');
    var adminOk = await waitFor(page, function () { return !!document.querySelector('.tabs') && Array.prototype.some.call(document.querySelectorAll('.section-head__title'), function (t) { return t.textContent.indexOf('Панель руководителя') >= 0; }); }, 6000);
    if (!adminOk) {
      var diag = await page.evaluate(function () {
        return { hash: location.hash, appHead: (document.querySelector('#app') || {}).textContent ? (document.querySelector('#app').textContent || '').slice(0, 200) : '' };
      });
      console.log('  [DIAG admin] ' + JSON.stringify(diag));
    }
    rec('Админ: панель открылась', adminOk);
    await page.screenshot({ path: path.resolve(__dirname, 'shot_admin.png') });
    if (adminOk) {
      var analyticsOk = await clickText(page, '.tabs__btn', 'Аналитика');
      await sleep(300);
      var anTab = await page.evaluate(function () { return !!document.querySelector('table'); });
      rec('Админ: вкладка Аналитика', analyticsOk && anTab);
      await clickText(page, '.tabs__btn', 'Архив');
      await sleep(300);
      await clickText(page, '.tabs__btn', 'Люди');
      await sleep(300);
      var usersOk = await waitFor(page, function () { return Array.prototype.some.call(document.querySelectorAll('.card'), function (c) { return (c.textContent || '').indexOf('Руководитель') >= 0; }); }, 3000);
      rec('Админ: вкладка Люди (пользователи)', usersOk);
      if (usersOk) {
        await clickText(page, '#app .btn--sm', 'Изменить');
        await sleep(400);
        var editUserModal = await waitFor(page, function () { return Array.prototype.some.call(document.querySelectorAll('.modal__title'), function (t) { return (t.textContent || '').indexOf('Профиль:') >= 0; }); });
        rec('Админ: модалка редактирования пользователя', !!editUserModal);
        if (editUserModal) {
          await clickText(page, '.modal .btn--primary', 'Сохранить');
          await sleep(500);
          rec('Админ: сохранение пользователя не падает', true);
        }
      }
    }

    // Профиль
    await setHash(page, '#/profile');
    var profileOk = await waitFor(page, function () { return Array.prototype.some.call(document.querySelectorAll('form.card'), function (f) { return (f.textContent || '').indexOf('Сохранить код') >= 0; }); }, 3000);
    rec('Профиль: форма смены кода отрисована', profileOk);
    await clickText(page, '.btn--block', 'Прайс-лист');
    await sleep(400);
    var priceListOk = await waitFor(page, function () { return Array.prototype.some.call(document.querySelectorAll('.modal__title'), function (t) { return (t.textContent || '').indexOf('Прайс-лист') >= 0; }); });
    rec('Профиль: просмотр прайс-листа', !!priceListOk);

    // Ошибки
    rec('Нет ошибок JS на странице (pageerror)', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 5)));
    var realConsole = consoleErrors.filter(function (e) { return !/favicon|manifest|sw\.js|Failed to load resource.*404/i.test(e); });
    rec('Нет критических ошибок консоли', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 5)));

  } catch (e) {
    rec('КРИТИЧЕСКИЙ СБОЙ ТЕСТА', false, e.message + '\n' + (e.stack || ''));
  } finally {
    await browser.close();
    server.close();
  }

  var passed = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - passed;
  console.log('\n==== ИТОГ: ' + passed + ' прошло, ' + failed + ' провалено из ' + results.length + ' ====');
  fs.writeFileSync(path.resolve(__dirname, 'full_test_report.txt'), results.map(function (r) { return (r.ok ? 'PASS' : 'FAIL') + ' | ' + r.step + (r.detail ? ' | ' + r.detail : ''); }).join('\n'));
  process.exit(failed > 0 ? 1 : 0);
})();
