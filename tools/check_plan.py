#!/usr/bin/env python3
"""Проверка учебного плана (TSV) для модуля: суммы часов и формы аттестации.
Использование: python3 tools/check_plan.py data/plans/ГРУППА.tsv ПМ.05
Проверяет строки ПМ.0N, МДК.0N.*, УП.0N, ПП.0N:
  Максимальная = Самостоятельная + Обязательная; сумма семестров = Обязательная;
  у МДК Обязательная = Теория + Практика + Курсовых; часы МДК и УП чётные, ПП кратны 6;
  сумма семестров ПМ = сумма семестров МДК + УП + ПП; число форм аттестации не больше числа семестров с часами.
Код выхода 1 — есть ошибки."""
import re
import sys


def num(x):
    x = re.sub(r'\s', '', x or '').replace(',', '.')
    return float(x) if re.fullmatch(r'-?\d+(\.\d+)?', x) else (0.0 if x in ('', '-') else None)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    path, pm = sys.argv[1], sys.argv[2]
    n = pm.replace('ПМ.', '')
    rows = {}
    for line in open(path, encoding='utf-8'):
        c = [x.strip() for x in line.rstrip('\n').split('\t')]
        idx = c[0].rstrip('.')
        if idx == pm or idx.startswith(f'МДК.{n}.') or idx in (f'УП.{n}', f'ПП.{n}') or idx.startswith((f'УП.{n}.', f'ПП.{n}.')):
            vals = [num(x) for x in c[3:]]
            if any(v is None for v in vals):
                print(f'ОШИБКА {idx}: нечисловое значение в часах: {c[3:]}')
                continue
            rows[idx] = (c, vals)
    errs = []
    if pm not in rows:
        errs.append(f'нет строки {pm}')
    for idx, (c, v) in rows.items():
        mx, sf, ob, th, pr, kr, *sem = v + [0] * (6 - len(v[:6]))
        if mx != sf + ob:
            errs.append(f'{idx}: Максимальная {mx:g} ≠ Самостоятельная {sf:g} + Обязательная {ob:g}')
        if sum(sem) != ob:
            errs.append(f'{idx}: сумма по семестрам {sum(sem):g} ≠ Обязательная {ob:g}')
        if idx.startswith('МДК') and ob != th + pr + kr:
            errs.append(f'{idx}: Обязательная {ob:g} ≠ Теория {th:g} + Практика {pr:g} + Курсовых {kr:g}')
        if idx.startswith(('МДК', 'УП')):
            for i, h in enumerate(sem):
                if h % 2:
                    errs.append(f'{idx}: семестр {i + 1} — {h:g} ч, не делится на пары по 2 ч')
            if th % 2 or pr % 2 or kr % 2:
                errs.append(f'{idx}: теория/практика/курсовой не кратны 2 ч')
        if idx.startswith('ПП'):
            for i, h in enumerate(sem):
                if h % 6:
                    errs.append(f'{idx}: семестр {i + 1} — {h:g} ч, не делится на дни по 6 ч')
        if not idx.startswith('ПМ'):
            active = sum(1 for h in sem if h > 0)
            forms = [f for f in (c[2] or '').split(',') if f.strip()]
            if len(forms) > max(active, 1):
                errs.append(f'{idx}: форм аттестации {len(forms)} («{c[2]}»), а семестров с часами {active}')
    if pm in rows:
        pm_sem = rows[pm][1][6:]
        parts = [v[6:] for k, (c, v) in rows.items() if k != pm]
        tot = [sum(p[i] if i < len(p) else 0 for p in parts) for i in range(len(pm_sem))]
        if [round(x) for x in tot] != [round(x) for x in pm_sem]:
            errs.append(f'{pm}: по семестрам {[int(x) for x in pm_sem]}, а сумма МДК+УП+ПП {[int(x) for x in tot]}')
    for e in errs:
        print('ОШИБКА ' + e)
    print(f'Строк модуля: {len(rows)} ({", ".join(rows)}); ошибок: {len(errs)}')
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
