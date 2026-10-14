# -*- coding: utf-8 -*-
import re
from pdfplumber import open as pdf_open

PDF = r"C:\Users\HP\Downloads\Telegram Desktop\Прайс_Лист_Братство_Электриков_ЧР_Погонаж.pdf"

with pdf_open(PDF) as pdf:
    p = pdf.pages[0]
    ws = p.extract_words()
    # position numbers
    pos = sorted([(round(w['top'], 1), int(w['text']))
                  for w in ws
                  if 28 <= w['x0'] <= 56 and re.fullmatch(r'\d{1,3}', w['text'])],
                 key=lambda x: x[0])
    # name lines: group words x0 in [50,415] by rounded top
    lines = {}
    for w in ws:
        if 50 <= w['x0'] <= 415:
            t = round(w['top'])
            lines.setdefault(t, []).append((w['x0'], w['text']))
    name_lines = [(t, ' '.join(x[1] for x in sorted(lines[t]))) for t in sorted(lines)]

    print('=== POSITIONS (top, n) ===')
    for t, n in pos[:25]:
        print(f"  {t:6.1f}  n={n}")
    print('=== NAME LINES (top, text) ===')
    for t, txt in name_lines[:25]:
        print(f"  {t:6.1f}  | {txt[:90]}")
