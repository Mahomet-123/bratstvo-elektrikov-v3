# -*- coding: utf-8 -*-
import re
from pdfplumber import open as pdf_open
PDF = r"C:\Users\HP\Downloads\Telegram Desktop\Прайс_Лист_Братство_Электриков_ЧР_Погонаж.pdf"
with pdf_open(PDF) as pdf:
    page = pdf.pages[4]  # страница 5
    words = page.extract_words()
    rows = {}
    for w in words:
        key = round(w['top']/4)*4
        rows.setdefault(key, []).append(w)
    for k in sorted(rows.keys()):
        toks = sorted(rows[k], key=lambda w:w['x0'])
        line = " | ".join("%.0f:%.0f:%s" % (w['x0'], w['top'], w['text']) for w in toks)
        print(line)
