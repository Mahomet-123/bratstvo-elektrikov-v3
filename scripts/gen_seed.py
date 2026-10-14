# -*- coding: utf-8 -*-
# Генерирует backend/Seed.gs с вшитым массивом PRICE_DATA из price.json
import json

SRC = r"C:\Projects\Personal\bratstvo-elektrikov-v3\backend\seed\price.json"
OUT = r"C:\Projects\Personal\bratstvo-elektrikov-v3\backend\Seed.gs"

data = json.load(open(SRC, encoding="utf-8"))
# оставляем только нужные поля, сортируем по n
data = sorted(data, key=lambda x: x["n"])
arr = [
    {
        "n": d["n"],
        "section": d["section"],
        "name": d["name"],
        "unit": d["unit"],
        "price": d["price"],
        "from": bool(d.get("from")),
        "type": d["type"],
    }
    for d in data
]

lines = []
lines.append("// Seed.gs — наполнение прайс-листа и профилей.")
lines.append("// Данные прайс-листа вшиты сюда, т.к. Apps Script не имеет доступа")
lines.append("// к локальным файлам проекта. Сгенерировано из PDF автоматически.")
lines.append("var PRICE_DATA = [")
for d in arr:
    lines.append("  " + json.dumps(d, ensure_ascii=False) + ",")
lines.append("];")
lines.append("")
lines.append("function Seed_run() {")
lines.append("  ensureBaseSheets();")
lines.append("  var r1 = Prices_seed(PRICE_DATA);")
lines.append("  var r2 = Users_seed();")
lines.append("  logMsg('seed', 'Прайс: ' + r1.count + ' позиций, профили: ' + (r2.created + r2.updated));")
lines.append("  return { ok: true, prices: r1.count, usersCreated: r2.created, usersUpdated: r2.updated };")
lines.append("}")
lines.append("")

open(OUT, "w", encoding="utf-8").write("\n".join(lines))
print("Seed.gs записан:", OUT, "позиций:", len(arr))
