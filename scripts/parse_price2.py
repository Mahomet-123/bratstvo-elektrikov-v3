# -*- coding: utf-8 -*-
"""
Координатный парсер прайс-листа «Братство Электриков ЧР» (PDF).
Таблица с фиксированными колонками:
  x0≈40   — номер позиции
  x0≈55…420 — наименование
  x0≈435  — единица измерения
  x0≈462  — цена
Цены извлекаются по колонке и сопоставляются с позициями по индексу
внутри страницы; дубли на границах страниц (последняя строка страницы
повторяется первой на следующей) убираются.
"""
import re
import json
from pdfplumber import open as pdf_open

PDF = r"C:\Users\HP\Downloads\Telegram Desktop\Прайс_Лист_Братство_Электриков_ЧР_Погонаж.pdf"
OUT = r"C:\Projects\Personal\bratstvo-elektrikov-v3\backend\seed\price.json"

HEADER_RE = re.compile(
    r"Прайс|Братство|Электриков|Июнь|стр\.|Ед\.|Изм|Кол-ство|Цена|"
    r"Монтажные работы|Черновые работы|Установка щитов|Чистовая установка|"
    r"Дополнительные работы|Пусконаладка|Коэффициенты|Примечания|"
    r"электромонтажных|без учета опусков", re.IGNORECASE)

UNIT_TOKENS = {"шт.", "м/п", "см.", "кв.м", "кВА", "%", "раз"}


def is_unit(t):
    t = t.strip()
    return t in UNIT_TOKENS or bool(re.fullmatch(r"(шт|м/п|см|кв\.м|кВА|%)\.?", t))


def section_of(n):
    if n <= 32: return "Монтажные работы"
    if n <= 51: return "Черновые работы"
    if n <= 104: return "Установка щитов"
    if n <= 151: return "Чистовая установка"
    if n <= 171: return "Дополнительные работы"
    if n <= 196: return "Пусконаладка, зарядные станции, умный дом"
    if n <= 204: return "Коэффициенты и особые условия"
    return "Примечания"


def type_of(n):
    if 197 <= n <= 202: return "coefficient"
    if n in (203, 204): return "percent"
    if n >= 205: return "note"
    return "work"


def infer_unit(num, name):
    n = name.lower()
    if num in (203, 204): return "%"
    if 197 <= num <= 202: return "коэф"
    if "снабжение материалом" in n: return "%"
    if any(k in n for k in ["ква", "бгу", "дгу", "генератор"]) and "кв.м" not in n:
        return "кВА"
    if any(k in n for k in ["площад", "фундамент", "основание", "зачист", "кв.м", "очистк"]):
        return "кв.м"
    if "сверление" in n or "в бетоне" in n or "в кирпиче" in n or "в блоке" in n or "в гипс" in n:
        return "см."
    if any(k in n for k in ["кабел", "гофр", "лоток", "канал", "штроб", "транше", "труб",
                            "протяжк", "настил", "плинтус", "профил", "трос", "лини", "периметр",
                            "погонаж", "желоб", "закладн", "трап", "провод"]):
        return "м/п"
    return "шт."


def parse_page(page):
    words = page.extract_words()
    # колонки
    pos_toks, name_toks, unit_toks, price_toks = [], [], [], []
    for w in words:
        x = w['x0']; t = w['text'].strip()
        if not t:
            continue
        if 450 <= x <= 485 and re.fullmatch(r"[\d\s]+", t) and re.search(r"\d", t):
            price_toks.append((round(w['top']), int(t.replace(" ", ""))))
        elif 28 <= x <= 56 and re.fullmatch(r"\d{1,3}", t):
            pos_toks.append((round(w['top']), int(t)))
        elif 418 <= x <= 452 and is_unit(t):
            unit_toks.append((round(w['top']), t))
        elif 55 <= x <= 415:
            name_toks.append((round(w['top']), t))
    # сортируем по top
    pos_toks.sort(); price_toks.sort(); unit_toks.sort(); name_toks.sort()

    # формируем записи по строкам (кластеризация по top)
    items = []
    current = None
    # соберём «линии»: токены с близким top
    lines = {}
    for kind, lst in (("p", pos_toks), ("n", name_toks)):
        for top, val in lst:
            lines.setdefault(top, {})[kind] = val
    for top in sorted(lines.keys()):
        ln = lines[top]
        if "p" in ln:
            # пропускаем заголовочные строки
            joined = " ".join(str(v) for v in ln.values())
            if HEADER_RE.search(joined):
                continue
            current = {"n": ln["p"], "name": ln.get("n", "")}
            items.append(current)
        elif "n" in ln and current is not None:
            current["name"] = (current["name"] + " " + ln["n"]).strip()
    # цены и единицы по индексу (последовательно вниз страницы)
    prices = [v for _, v in price_toks]
    units = [v for _, v in unit_toks]
    return items, prices, units


def main():
    all_items, all_prices, all_units = [], [], []
    with pdf_open(PDF) as pdf:
        for pi, page in enumerate(pdf.pages):
            items, prices, units = parse_page(page)
            # убираем дубль на границе страниц: если последняя позиция
            # предыдущей страницы равна первой текущей — пропускаем первую
            if all_items and items and all_items[-1]["n"] == items[0]["n"]:
                items = items[1:]
                if prices: prices = prices[1:]
                if units: units = units[1:]
            all_items += items
            all_prices += prices
            all_units += units
            print(f"стр.{pi+1}: позиций={len(items)} цен={len(prices)} ед={len(units)}")

    # сопоставляем цену и единицу по индексу
    out = []
    for i, it in enumerate(all_items):
        n = it["n"]
        price = all_prices[i] if i < len(all_prices) else 0
        unit = all_units[i] if i < len(all_units) else ""
        if not unit or not is_unit(unit):
            unit = infer_unit(n, it["name"])
        out.append({
            "section": section_of(n),
            "n": n,
            "name": it["name"].strip() or "(позиция %d — нет описания)" % n,
            "unit": unit,
            "price": price,
            "from": (" от " in it["name"]) or it["name"].rstrip().endswith(" от"),
            "type": type_of(n),
        })

    # если позиция 1 отсутствует — добавляем заглушку (в PDF нет описания)
    nums = [o["n"] for o in out]
    if 1 not in nums:
        out.insert(0, {
            "section": section_of(1), "n": 1,
            "name": "(позиция 1 — нет описания в PDF)",
            "unit": "шт.", "price": 0, "from": False, "type": "work",
        })
    out.sort(key=lambda x: x["n"])

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print("\nВСЕГО позиций:", len(out))
    secs = {}
    for o in out:
        secs[o["section"]] = secs.get(o["section"], 0) + 1
    for s, c in secs.items():
        print(f"  {s}: {c}")
    print("Номера:", [o["n"] for o in out][:5], "...", [o["n"] for o in out][-5:])
    print("Проверка выборочно:")
    for n in (1, 2, 7, 33, 52, 105, 152, 174, 197, 203, 205):
        hit = next((o for o in out if o["n"] == n), None)
        print(f"  {n}: {hit}" if hit else f"  {n}: НЕТ")


if __name__ == "__main__":
    main()
