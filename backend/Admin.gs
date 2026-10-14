// Admin.gs — сводки и аналитика для руководителя.
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
      profit: totalCalc - totalPur
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
    byMaster[m] = byMaster[m] || { objects: 0, calc: 0, purchase: 0 };
    byMaster[m].objects += 1;
  });
  calcs.forEach(function (r) {
    var o = findRow(CONFIG.SHEET_OBJECTS, 'id', r.objectId);
    if (o) { var m = o.master || '—'; byMaster[m] = byMaster[m] || { objects: 0, calc: 0, purchase: 0 }; byMaster[m].calc += Number(r.sum) || 0; }
  });
  purs.forEach(function (r) {
    var o = findRow(CONFIG.SHEET_OBJECTS, 'id', r.objectId);
    if (o) { var m = o.master || '—'; byMaster[m] = byMaster[m] || { objects: 0, calc: 0, purchase: 0 }; byMaster[m].purchase += Number(r.sum) || 0; }
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
      purchase: purs.reduce(function (s, r) { return s + (Number(r.sum) || 0); }, 0)
    }
  };
}
