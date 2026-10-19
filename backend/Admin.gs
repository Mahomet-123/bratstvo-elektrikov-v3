// Admin.gs — сводки и аналитика для руководителя.

// Единая формула наценки на материал: max(сумма_покупок * 0.10, 1500) при
// включённом флаге purchaseMarkup. Используется и в Admin_report, и в
// Admin_analytics, и в Cabinet_view — единая точка истины.
function Admin_markupForObject_(purchaseSum, purchaseMarkupFlag) {
  if (!purchaseMarkupFlag) return 0;
  var mu = purchaseSum * 0.10;
  if (mu < 1500) mu = 1500;
  return Math.round(mu);
}

function Admin_report() {
  var objs = readRows(CONFIG.SHEET_OBJECTS, 1);
  var byStatus = {};
  objs.forEach(function (o) {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  });
  var totalCalc = 0, totalPur = 0;
  var calcs = readRows(CONFIG.SHEET_CALC, 1);
  calcs.forEach(function (r) { totalCalc += Number(r.sum) || 0; });
  var purs = readRows(CONFIG.SHEET_PURCHASE, 1);
  purs.forEach(function (r) { totalPur += Number(r.sum) || 0; });

  // Наценка по объектам (та же формула, что в Admin_analytics).
  var purchaseByObj = {};
  purs.forEach(function (r) {
    purchaseByObj[r.objectId] = (purchaseByObj[r.objectId] || 0) + (Number(r.sum) || 0);
  });
  var totalMarkup = 0;
  Object.keys(purchaseByObj).forEach(function (oid) {
    var o = findRow(CONFIG.SHEET_OBJECTS, 'id', oid);
    if (!o) return;
    totalMarkup += Admin_markupForObject_(purchaseByObj[oid], o.purchaseMarkup);
  });

  var visits = readRows(CONFIG.SHEET_VISITS, 1)
    .slice(-10)
    .reverse()
    .map(stripRow_);

  return {
    counts: {
      objects: objs.length,
      byStatus: byStatus,
      masters: Users_list().filter(function (u) { return u.role === 'мастер'; }).length
    },
    money: {
      totalCalc: totalCalc,
      totalPurchase: totalPur,
      totalMarkup: totalMarkup,
      // Прибыль = сумма за работу (calc) + наценка на материал.
      profit: totalCalc + totalMarkup
    },
    lastVisits: visits
  };
}

function Admin_analytics() {
  var objs = readRows(CONFIG.SHEET_OBJECTS, 1);
  var calcs = readRows(CONFIG.SHEET_CALC, 1);
  var purs = readRows(CONFIG.SHEET_PURCHASE, 1);

  // по мастерам
  var byMaster = {};
  objs.forEach(function (o) {
    var m = o.master || '—';
    byMaster[m] = byMaster[m] || { objects: 0, calc: 0, purchase: 0, markup: 0 };
    byMaster[m].objects += 1;
  });
  calcs.forEach(function (r) {
    var o = findRow(CONFIG.SHEET_OBJECTS, 'id', r.objectId);
    if (o) { var m = o.master || '—'; byMaster[m] = byMaster[m] || { objects: 0, calc: 0, purchase: 0, markup: 0 }; byMaster[m].calc += Number(r.sum) || 0; }
  });
  purs.forEach(function (r) {
    var o = findRow(CONFIG.SHEET_OBJECTS, 'id', r.objectId);
    if (o) { var m = o.master || '—'; byMaster[m] = byMaster[m] || { objects: 0, calc: 0, purchase: 0, markup: 0 }; byMaster[m].purchase += Number(r.sum) || 0; }
  });

  // Наценка по объектам: для каждого объекта с включённым purchaseMarkup
  // markup = max(сумма_его_покупок * 0.10, 1500). Логика идентична purchaseTotal
  // на клиенте (objectCard.js). purchase (raw) не трогаем — «Прибыль = calc − purchase»
  // остаётся корректной. Наценка — отдельная колонка в аналитике.
  var purchaseByObj = {};
  purs.forEach(function (r) {
    purchaseByObj[r.objectId] = (purchaseByObj[r.objectId] || 0) + (Number(r.sum) || 0);
  });
  var totalMarkup = 0;
  Object.keys(purchaseByObj).forEach(function (oid) {
    var o = findRow(CONFIG.SHEET_OBJECTS, 'id', oid);
    if (!o) return;
    var s = purchaseByObj[oid];
    var mu = 0;
    if (o.purchaseMarkup) {
      mu = s * 0.10;
      if (mu < 1500) mu = 1500;
      mu = Math.round(mu);
    }
    var m = o.master || '—';
    byMaster[m] = byMaster[m] || { objects: 0, calc: 0, purchase: 0, markup: 0 };
    byMaster[m].markup += mu;
    totalMarkup += mu;
  });

  // по разделам прайса
  var bySection = {};
  calcs.forEach(function (r) {
    bySection[r.section] = bySection[r.section] || 0;
    bySection[r.section] += Number(r.sum) || 0;
  });

  return {
    byMaster: byMaster,
    bySection: bySection,
    totals: {
      calc: calcs.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0),
      purchase: purs.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0),
      markup: totalMarkup
    }
  };
}
