#!/usr/bin/env python3
"""Учебный план из Excel (.xlsx) → TSV для rpgen.
Использование: python3 tools/plan_from_xlsx.py план.xlsx data/plans/ГРУППА.tsv [--sheet "Лист"]
Столбцы листа должны идти так: Индекс | Наименование | Формы ПА | Максимальная | Самостоятельная | Обязательная |
Теория | Практика | Курсовых | семестр 1 | семестр 2 | … Строки шапки и итогов программа пропускает сама."""
import argparse
import openpyxl

ap = argparse.ArgumentParser()
ap.add_argument('xlsx'); ap.add_argument('out'); ap.add_argument('--sheet')
a = ap.parse_args()
wb = openpyxl.load_workbook(a.xlsx, data_only=True)
ws = wb[a.sheet] if a.sheet else wb.active
rows = ['\t'.join('' if v is None else str(v).replace('\n', ' ') for v in r) for r in ws.iter_rows(values_only=True)]
open(a.out, 'w', encoding='utf-8').write('\n'.join(rows) + '\n')
print(f'Записано: {a.out} ({len(rows)} строк, лист «{ws.title}»)')
