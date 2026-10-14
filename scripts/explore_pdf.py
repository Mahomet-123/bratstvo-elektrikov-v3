# -*- coding: utf-8 -*-
"""Разведка раскладки PDF через pdfplumber: слова с координатами, сгруппированные по строкам."""
import json, sys
from pdfplumber import open as pdf_open

PDF = r"C:\Users\HP\Downloads\Telegram Desktop\Прайс_Лист_Братство_Электриков_ЧР_Погонаж.pdf"

with pdf_open(PDF) as pdf:
    print("Страниц:", len(pdf.pages))
    page = pdf.pages[0]
    words = page.extract_words()
    # сгруппировать по top (округление до 3px)
    rows = {}
    for w in words:
        key = round(w['top'] / 3) * 3
        rows.setdefault(key, []).append(w)
    print("\n--- Страница 1, первые 40 строк (top | x0 | text) ---")
    for k in sorted(rows.keys())[:40]:
        toks = sorted(rows[k], key=lambda w: w['x0'])
        line = "  ".join("%d:%.0f:%s" % (round(w['top']), w['x0'], w['text']) for w in toks)
        print(line)
