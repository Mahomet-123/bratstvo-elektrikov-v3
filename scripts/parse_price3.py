# -*- coding: utf-8 -*-
"""
Координатный парсер прайс-листа «Братство Электриков ЧР» (PDF), v3.

Структура колонок (по x0):
  x0≈40      — номер позиции (число 1..206, глобально уникально)
  x0≈55..415 — наименование (может переноситься на 2 строки; вторая
               строка — «хвост» описания: «мм2 мм2», «Ø 32мм» и т.п.)
  x0≈434     — единица измерения (шт./м/п/см./кв.м/кВА/%)
  x0≈462     — цена (первая колонка «Цена.р»)

Ключевая особенность вёрстки: номер позиции N стоит НАД своим описанием,
а описание начинается на ~14px ниже и при переносе вторая строка попадает
в зону СЛЕДУЮЩЕЙ позиции. Поэтому имена привязываем к ближайшему номеру,
а «хвостовые» фрагменты (только единицы измерения) возвращаем предыдущей
позиции.
"""
import re
import json
import unicodedata
from pdfplumber import open as pdf_open


def norm(s):
    # NFC-нормализация: убирает комбинирующие диакритики (й = и + ̆)
    return unicodedata.normalize("NFC", s)

PDF = r"C:\Users\HP\Downloads\Telegram Desktop\Прайс_Лист_Братство_Электриков_ЧР_Погонаж.pdf"
OUT = r"C:\Projects\Personal\bratstvo-elektrikov-v3\backend\seed\price.json"

# Заголовочные строки, которые не являются позициями
HEADER_RE = re.compile(
    norm(r"^(Монтажные|Черновые|Установка\s+щитов|Чистовая|Дополнительные|"
         r"Пусконаладка|Коэффициент|Примечания|Прайс|Братство|Электриков|"
         r"Июнь|стр\.|Ед\.|Изм|Цена|Кол-ство|без\s+учета|опусков)"),
    re.IGNORECASE)

UNIT_TOKENS = {"шт.", "м/п", "см.", "кв.м", "кВА", "%", "раз", "коэф", "мм2", "мм²"}

FRAG_RE = re.compile(r"^(мм\s?2|мм²|кв\.?\s?м|см\.?|м/п|шт\.?|раз|Ø|м|кВА|%|коэф)$", re.IGNORECASE)


def is_unit(t):
    t = t.strip()
    return t in UNIT_TOKENS or bool(re.fullmatch(r"(шт|м/п|см|кв\.м|кВА|%)\.?", t))


def is_fragment(txt):
    t = txt.strip()
    if not t:
        return False
    parts = re.split(r"[\s/]+", t)
    if all(FRAG_RE.fullmatch(p) for p in parts if p):
        return True
    return False


def is_header(txt):
    return bool(HEADER_RE.search(txt.strip()))


def section_of(n):
    if n <= 32:  return "Монтажные работы"
    if n <= 51:  return "Черновые работы"
    if n <= 104: return "Установка щитов"
    if n <= 151: return "Чистовая установка"
    if n <= 171: return "Дополнительные работы"
    if n <= 196: return "Пусконаладка, зарядные станции, умный дом"
    if n <= 204: return "Коэффициенты и особые условия"
    return "Примечания"


def type_of(n):
    if 197 <= n <= 202: return "coefficient"
    if n in (203, 204): return "percent"
    if n >= 205:        return "note"
    return "work"


def infer_unit(num, name):
    n = name.lower()
    if num in (203, 204): return "%"
    if 197 <= num <= 202:  return "коэф"
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
    # собираем токены по колонкам
    pos_tok, name_words, unit_tok, price_tok = [], [], [], []
    for w in words:
        x = w["x0"]; t = norm(w["text"].strip())
        if not t:
            continue
        if 28 <= x <= 56 and re.fullmatch(r"\d{1,3}", t):
            pos_tok.append((round(w["top"], 1), int(t)))
        elif 50 <= x <= 420:
            name_words.append((round(w["top"], 1), round(w["x0"], 1), t))
        elif 415 <= x <= 455 and is_unit(t):
            unit_tok.append((round(w["top"], 1), t))
        elif 450 <= x <= 490 and re.fullmatch(r"[\d\s]+", t) and re.search(r"\d", t):
            price_tok.append((round(w["top"], 1), int(t.replace(" ", ""))))
    pos_tok.sort(); name_words.sort(); unit_tok.sort(); price_tok.sort()

    if not pos_tok:
        return []  # страница без позиций (титул)

    pos_tops = [p[0] for p in pos_tok]
    pos_nums = [p[1] for p in pos_tok]
    first_top = pos_tops[0]

    # группируем слова имени в строки по округлённому top, внутри сортируем по x0
    rows = {}
    for lt, lx, t in name_words:
        rows.setdefault(lt, []).append((lx, t))
    name_rows = []
    for lt in sorted(rows):
        txt = " ".join(x[1] for x in sorted(rows[lt]))
        name_rows.append((lt, txt))

    def greatest_below(top):
        # строго меньше: имя позиции N лежит ниже позиции N, часто на уровне N+1
        best = -1
        for i, pt in enumerate(pos_tops):
            if pt < top:
                best = i
        return best

    items = [{"n": pos_nums[i], "name_lines": [], "unit": None, "price": None}
             for i in range(len(pos_tok))]

    for lt, txt in name_rows:
        if lt < first_top - 6:          # титул / шапка страницы выше первой позиции
            continue
        if is_header(txt):              # секции и служебные надписи
            continue
        if is_fragment(txt):            # «хвост» из единиц измерения — не нужен в имени
            continue
        idx = greatest_below(lt)
        if idx < 0:
            idx = 0
        items[idx]["name_lines"].append((lt, txt))

    # единица и цена
    for lt, t in unit_tok:
        idx = greatest_below(lt)
        if idx >= 0:
            items[idx]["unit"] = t
    for lt, v in price_tok:
        idx = greatest_below(lt)
        if idx >= 0 and items[idx]["price"] is None:
            items[idx]["price"] = v

    # финализируем
    out = []
    for it in items:
        name_lines = sorted(it["name_lines"], key=lambda x: x[0])
        name = " ".join(t for _, t in name_lines).strip()
        n = it["n"]
        unit = it["unit"]
        if (not unit or not is_unit(unit)) and name:
            unit = infer_unit(n, name)
        out.append({
            "section": section_of(n),
            "n": n,
            "name": name or ("(позиция %d — нет описания)" % n),
            "unit": unit or "шт.",
            "price": it["price"] or 0,
            "from": (" от " in name) or name.rstrip().endswith(" от"),
            "type": type_of(n),
        })
    return out


def main():
    all_items = []
    last_n = None
    with pdf_open(PDF) as pdf:
        for pi, page in enumerate(pdf.pages):
            items = parse_page(page)
            # убираем дубль на границе страниц (один и тот же номер)
            if all_items and items:
                if items[0]["n"] == last_n:
                    items = items[1:]
            for it in items:
                all_items.append(it)
                last_n = it["n"]
            print(f"стр.{pi+1}: позиций={len(items)}")

    all_items.sort(key=lambda x: x["n"])
    # уникальность по n
    seen = set(); uniq = []
    for it in all_items:
        if it["n"] in seen:
            continue
        seen.add(it["n"]); uniq.append(it)
    all_items = uniq

    json.dump(all_items, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print("\nВСЕГО позиций:", len(all_items))
    secs = {}
    for o in all_items:
        secs[o["section"]] = secs.get(o["section"], 0) + 1
    for s, c in secs.items():
        print(f"  {s}: {c}")
    print("\nПроверка выборочно:")
    for n in (1, 2, 3, 6, 9, 10, 11, 33, 52, 105, 152, 174, 197, 203, 205):
        hit = next((o for o in all_items if o["n"] == n), None)
        print(f"  {n}: {hit['name'] if hit else 'НЕТ'} | {hit['unit'] if hit else ''} | {hit['price'] if hit else ''}")


if __name__ == "__main__":
    main()
