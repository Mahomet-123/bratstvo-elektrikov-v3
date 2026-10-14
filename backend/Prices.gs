// Prices.gs — работа с прайс-листом (список, карта, сид)
function Prices_list() {
  return readRows(CONFIG.SHEET_PRICE, 1).map(stripRow_);
}

function Prices_map() {
  var m = {};
  readRows(CONFIG.SHEET_PRICE, 1).forEach(function (r) { m[r.n] = stripRow_(r); });
  return m;
}

function Prices_get(n) {
  return Prices_map()[n] || null;
}

// items: массив {n, section, name, unit, price, from, type}
function Prices_seed(items) {
  var sh = getSheet_(CONFIG.SHEET_PRICE, true);
  var header = ['n', 'section', 'name', 'unit', 'price', 'from', 'type'];
  var rows = [header].concat(items.map(function (it) {
    return [it.n, it.section, it.name, it.unit, it.price, it.from ? 1 : 0, it.type];
  }));
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  return { ok: true, count: items.length };
}
