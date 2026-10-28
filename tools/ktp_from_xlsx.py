#!/usr/bin/env python3
"""КТП преподавателя (.xlsx) → data/ktp/ГРУППА_УД.json — эталон занятий учебной дисциплины.

Использование:
  python3 -I tools/ktp_from_xlsx.py sources/op04_oaip/ktp.xlsx data/ktp/OA-2501_OP04.json   # записать JSON
  python3 -I tools/ktp_from_xlsx.py sources/op04_oaip/ktp.xlsx data/ktp/OA-2501_OP04.json --check   # сверить JSON с xlsx (0 расхождений)

Формат xlsx (выгрузка КТП): строки «Раздел N . …», «Тема N.M . …» (часы в столбце C — итог темы),
строки занятий: A — номер, B — название, C — часы, D — вид занятия (Лекция / Практ. работа / Практ. занятие),
E — материалы, F — домашнее задание. Названия занятий переносятся дословно (убирается только пробел перед точкой в
«Раздел 1 .», «Тема 1.1 .»). Вид занятия: Лекция → k «T», «Практ. …» → k «P».
Проверяется: номера занятий 1, 2, 3 … подряд; часы темы = сумма её занятий; часы раздела = сумма тем; все виды занятий известны.
"""
import json
import re
import sys

try:
    import openpyxl
except ImportError:
    sys.exit('Нужен пакет openpyxl: pip install openpyxl')

KINDS = {'лекция': 'T', 'практ. работа': 'P', 'практ. занятие': 'P'}


def clean(x):
    return re.sub(r'\s+', ' ', str(x)).strip() if x is not None else ''


def head(text, word):
    """«Тема 1.1 . Название» → («Тема 1.1.», «Название»); «Раздел 1 . ОА - Название» → («Раздел 1.», «ОА - Название»)."""
    m = re.match(rf'^({word}\s*\d+(?:\.\d+)*)\s*\.\s*(.*)$', text)
    return (m.group(1) + '.', m.group(2).strip()) if m else (None, None)


def parse(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    rows = [[c.value for c in r] for r in ws.iter_rows()]
    out = {'_source': f'КТП преподавателя ({path.split("/")[-1]}); столбцы «Материалы» и «Домашнее задание» сохранены в lessons[].materials / homework',
           'title': clean(rows[1][0]), 'hours_total_cell': clean(rows[2][0]), 'sections': []}
    sec = theme = None
    errs = []
    for i, r in enumerate(rows[4:], 5):
        a, b, c, d, e, f = (list(r) + [None] * 6)[:6]
        b = clean(b)
        if not b:
            continue
        if b.startswith('Раздел'):
            num, name = head(b, 'Раздел')
            sec = {'num': num, 'name': f'{num} {name}', 'hours': int(c), 'themes': []}
            out['sections'].append(sec)
            theme = None
        elif b.startswith('Тема'):
            num, name = head(b, 'Тема')
            theme = {'num': num, 'name': name, 'hours': int(c), 'lessons': []}
            sec['themes'].append(theme)
        elif a is not None and theme is not None:
            kind = KINDS.get(clean(d).lower())
            if not kind:
                errs.append(f'строка {i}: неизвестный вид занятия «{d}»')
            theme['lessons'].append({'n': int(a), 't': b, 'h': int(c), 'k': kind, 'vid': clean(d), 'materials': clean(e), 'homework': clean(f)})
        else:
            errs.append(f'строка {i}: не распознана «{b[:60]}»')
    n = 0
    for s in out['sections']:
        for t in s['themes']:
            for l in t['lessons']:
                n += 1
                if l['n'] != n:
                    errs.append(f'номер занятия {l["n"]} вместо {n} («{l["t"][:50]}»)')
            if sum(l['h'] for l in t['lessons']) != t['hours']:
                errs.append(f'{t["num"]}: часы темы {t["hours"]} ≠ сумма занятий {sum(l["h"] for l in t["lessons"])}')
        if sum(t['hours'] for t in s['themes']) != s['hours']:
            errs.append(f'{s["num"]}: часы раздела {s["hours"]} ≠ сумма тем {sum(t["hours"] for t in s["themes"])}')
    out['hours'] = sum(s['hours'] for s in out['sections'])
    out['lessons_count'] = n
    out['theory_hours'] = sum(l['h'] for s in out['sections'] for t in s['themes'] for l in t['lessons'] if l['k'] == 'T')
    out['practice_hours'] = sum(l['h'] for s in out['sections'] for t in s['themes'] for l in t['lessons'] if l['k'] == 'P')
    return out, errs


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        sys.exit(__doc__)
    check = '--check' in a
    a = [x for x in a if x != '--check']
    data, errs = parse(a[0])
    if check:
        old = json.load(open(a[1], encoding='utf-8'))
        if old != data:
            errs.append('JSON не совпадает с xlsx (перезапустите без --check и проверьте diff)')
    else:
        json.dump(data, open(a[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for e in errs:
        print('ОШИБКА: ' + e)
    print(f'Разделов {len(data["sections"])}, тем {sum(len(s["themes"]) for s in data["sections"])}, занятий {data["lessons_count"]}, '
          f'часов {data["hours"]} (теория {data["theory_hours"]}, практика {data["practice_hours"]}); ошибок: {len(errs)}')
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
