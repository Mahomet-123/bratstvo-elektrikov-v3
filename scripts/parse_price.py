# -*- coding: utf-8 -*-
"""
Парсер прайс-листа «Братство Электриков ЧР» (scripts/price_raw.txt).
PDF — трёхколоночный: на каждой странице сначала наименования (левая
колонка), затем единицы (средняя), затем цены (правая). На разделе ⑥
единица и цена иногда слиты («кВА 22000»). Выравниваем строго по
порядку внутри страницы, привязывая блоки единиц/цен к области ПОСЛЕ
последнего наименования (чтобы исключить случайные числа в шапке).
"""
import re
import json

RAW = "scripts/price_raw.txt"
OUT = "backend/seed/price.json"

UNIT_TOKENS = {"шт.", "м/п", "см.", "кв.м", "кВА", "%", "1раз", "шт"}


def is_unit_token(s):
    s = s.strip()
    if s in UNIT_TOKENS:
        return True
    if re.fullmatch(r"(шт|м/п|см|кв\.м|кВА|%)\.?", s):
        return True
    return False


def normalize_unit(u):
    return {
        "шт.": "шт.", "шт": "шт.", "м/п": "м/п", "см.": "см.",
        "кв.м": "кв.м", "кВА": "кВА", "%": "%", "1раз": "раз",
    }.get(u.strip(), u.strip())


def section_of(n):
    if n <= 32:
        return "Монтажные работы"
    if n <= 51:
        return "Черновые работы"
    if n <= 104:
        return "Установка щитов"
    if n <= 151:
        return "Чистовая установка"
    if n <= 171:
        return "Дополнительные работы"
    if n <= 196:
        return "Пусконаладка, зарядные станции, умный дом"
    if n <= 204:
        return "Коэффициенты и особые условия"
    return "Примечания"


def type_of(n):
    if 197 <= n <= 202:
        return "coefficient"
    if n in (203, 204):
        return "percent"
    if n >= 205:
        return "note"
    return "work"


def is_name_line(s):
    m = re.fullmatch(r"(\d{1,3})\s+(.+)", s)
    if not m:
        return None
    num = int(m.group(1))
    rest = m.group(2).strip()
    if rest.lower().startswith("раз"):
        return None
    if is_unit_token(rest):
        return None
    if "IoT" in rest:
        return None
    if not re.search(r"[а-яА-Я]", rest):
        return None
    return num, rest


def parse_page(text):
    """Возвращает только наименования (с номерами) и цены в порядке колонки.
    Единицы измерения не парсим из «едущего» столбца, а выводим по смыслу
    наименования (см. infer_unit) — это надёжнее при переносах в PDF."""
    lines = text.split("\n")
    names = []
    last_idx = -1
    for i, ln in enumerate(lines):
        r = is_name_line(ln.strip())
        if r:
            names.append(r)
            last_idx = i
    cells = lines[last_idx + 1:]
    prices = []
    for ln in cells:
        s = ln.strip()
        if not s:
            continue
        if re.search(r"Братство|Июнь|стр\.|Прайс|Ед\.|Кол-ство|Цена|электромонтажных", s):
            continue
        if s[0] in "①②③④⑤⑥⑦⑧":
            continue
        # слитая «единица цена» — берём только число
        m = re.fullmatch(r"[а-яА-Я\./]+\s+(\d[\d\s]*)$", s)
        if m:
            v = int(m.group(1).replace(" ", ""))
            if v > 0:
                prices.append(v)
            continue
        if re.fullmatch(r"[\d\s]+", s) and re.search(r"\d", s):
            v = int(s.replace(" ", ""))
            if v > 0:
                prices.append(v)
            continue
    return names, prices


def infer_unit(num, name):
    """Единица измерения по смыслу наименования (fallback при парсинге PDF)."""
    n = name.lower()
    if num in (203, 204):
        return "%"
    if 197 <= num <= 202:
        return "коэф"
    if "снабжение материалом" in n:
        return "%"
    if any(k in n for k in ["ква", "бгу", "дгу", "генератор", "ква"]) and "кв.м" not in n:
        return "кВА"
    if any(k in n for k in ["площад", "фундамент", "основание", "зачист", "м²", "кв.м", "очистк"]):
        return "кв.м"
    if "сверление" in n or "один сантиметр" in n or "в бетоне" in n or "в кирпиче" in n or "в блоке" in n or "в гипс" in n:
        return "см."
    if any(k in n for k in ["кабел", "гофр", "лоток", "канал", "штроб", "транше", "труб",
                            "протяжк", "настил", "плинтус", "профил", "трос", "лини", "периметр",
                            "погонаж", "желоб", "закладн", "трап"]):
        return "м/п"
    return "шт."


def main():
    raw = open(RAW, encoding="utf-8").read()
    pages = re.split(r"Июнь 25/2026г\s+\d+\s*стр", raw)
    items = []
    prev_last = None
    for pi, page in enumerate(pages):
        names, prices = parse_page(page)
        # убираем «перенос» последней цены предыдущей страницы (дубль в начале)
        if prev_last is not None and len(prices) > len(names) and prices and prices[0] == prev_last:
            prices = prices[1:]
        # прочие лишние элементы в начале страницы (если counts всё ещё расходятся)
        while len(prices) > len(names):
            prices = prices[1:]
        while len(prices) < len(names):
            prices = prices + [0]
        prev_last = prices[-1] if prices else None
        if len(names) != len(prices):
            print(f"  ! стр.{pi}: names={len(names)} prices={len(prices)}")
        for k in range(len(names)):
            num, name = names[k]
            items.append({
                "section": section_of(num),
                "n": num,
                "name": name,
                "unit": infer_unit(num, name),
                "price": prices[k],
                "from": (" от " in name) or name.rstrip().endswith(" от"),
                "type": type_of(num),
            })
    items.sort(key=lambda x: x["n"])
    json.dump(items, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print("ВСЕГО позиций:", len(items))
    secs = {}
    for it in items:
        secs[it["section"]] = secs.get(it["section"], 0) + 1
    for s, c in secs.items():
        print(f"  {s}: {c}")
    print("Проверка (n -> имя | ед | цена | тип):")
    for n in (2, 7, 33, 52, 105, 152, 174, 177, 197, 203, 205):
        hit = next((i for i in items if i["n"] == n), None)
        print(f"  {n}: {hit}" if hit else f"  {n}: НЕТ")


if __name__ == "__main__":
    main()
