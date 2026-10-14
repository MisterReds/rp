#!/usr/bin/env python3
"""Проверка готового .docx — независимо от content.json (для роли reviewer).
Использование: python3 tools/check_docx.py out/РП_….docx [--lr 52]
Проверяет по тексту документа:
  - нет запрещённого: портфолио, WorldSkills, «Цифровые инструменты», «установлены учебным планом», заглушки;
  - в КТП каждого МДК (2.2.N) практические работы пронумерованы 1, 2, 3 … без пропусков и повторов,
    строки занятий пронумерованы 1, 2, 3 …;
  - «Всего по МДК» в КТП равно часам МДК в п. 1.2;
  - в производственной практике нет зачёта/аттестации, если в 4.1 сказано, что она не проводится;
  - в 1.1.4 перечислены все ЛР (по умолчанию 52, --lr N);
  - есть разделы 1–5 и ФОС.
Выводит ОШИБКИ и ПРОВЕРЬ (места для человека: [Ф. И. О.], [проверить], ______). Код 1 — есть ошибки."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from doc2text import read_lines  # noqa: E402

BANNED = [(r'портфолио', 'портфолио'), (r'world\s*skills|ворлдскилл|молодые профессионалы', 'WorldSkills'),
          (r'цифровые инструменты', 'таблица «Цифровые инструменты»'), (r'установлен\w* учебным планом', 'форма аттестации не конкретна'),
          (r'трудо[её]мкость освоения', 'таблица «Трудоёмкость освоения модуля» не нужна'),
          (r'в том числе практических заняти', 'строка «В том числе практических занятий» не пишется'),
          (r'как языковая модель|к сожалению, я', 'служебная фраза нейросети'),
          (r'lorem|todo|\?\?\?', 'заглушка')]


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    n_lr = 52
    if '--lr' in a:
        i = a.index('--lr'); n_lr = int(a[i + 1]); del a[i:i + 2]
    lines = read_lines(a[0])
    text = [re.sub(r'^\[[^\]]*\]\s*', '', l) for l in lines]
    errs, checks = [], []
    full = '\n'.join(text)
    low = full.lower()
    for rx, why in BANNED:
        for m in re.finditer(rx, low):
            ctx = full[max(0, m.start() - 60):m.end() + 60].replace('\n', ' ')
            errs.append(f'{why}: «…{ctx}…»')

    # КТП МДК
    starts = [i for i, t in enumerate(text) if re.match(r'^2\.2\.\d+\. Календарно-тематический план.*(МДК\.\d+\.\d+)', t)]
    hours12 = {m.group(1): int(m.group(2)) for m in re.finditer(r'(МДК\.\d+\.\d+) «[^»]*» — (\d+)', full)}
    for k, s in enumerate(starts):
        code = re.search(r'МДК\.\d+\.\d+', text[s]).group(0)
        end = next((i for i in range(s + 1, len(text)) if re.match(r'^2\.2\.\d+\. ', text[i])), len(text))
        block = text[s:end]
        pw = [int(x) for t in block for x in re.findall(r'Практическая работа № (\d+)', t)]
        if pw and pw != list(range(1, len(pw) + 1)):  # каждая практическая пара — свой номер, без повторов
            errs.append(f'{code}: номера практических работ {pw[:40]} — нужно 1, 2, 3 … без пропусков и повторов (часть 1, часть 2 — разные номера)')
        nums = []  # номер занятия — ячейка «N. название» в строке КТП
        for t in block:
            for c in re.split(r'\s*\|\s*', t)[:2]:
                m = re.match(r'^(\d+)\. \S', c)
                if m:
                    nums.append(int(m.group(1)))
                    break
        if nums and nums != list(range(1, len(nums) + 1)):
            bad = next(i for i, x in enumerate(nums) if x != i + 1)
            errs.append(f'{code}: нумерация занятий сбита около № {nums[bad]}')
        tot = next((int(m.group(1)) for t in block for m in [re.match(r'^Всего по МДК\.\d+\.\d+ \| (\d+)', t)] if m), None)
        if tot is None:
            errs.append(f'{code}: нет строки «Всего по МДК»')
        elif code in hours12 and hours12[code] != tot:
            errs.append(f'{code}: «Всего по МДК» {tot} ч, а в п. 1.2 — {hours12[code]} ч')

    # ПП без зачёта
    pp = next((i for i, t in enumerate(text) if re.match(r'^2\.2\.\d+\. Содержание производственной практики', t)), None)
    if pp is not None and re.search(r'производственн\w+ практик\w+[^.\n]*(не проводится|отч[её]т по практике)', low):
        end = next((i for i in range(pp + 1, len(text)) if re.match(r'^(2\.2\.\d+\.|3\. )', text[i])), len(text))
        for t in text[pp:end]:
            if re.search(r'зач[её]т|аттестаци', t.lower()):
                errs.append(f'производственная практика: «{t[:120]}» — зачёт/аттестация не проводится')

    # ЛР
    i114 = next((i for i, t in enumerate(text) if t.startswith('1.1.4.')), None)
    if i114 is None:
        errs.append('нет п. 1.1.4 (личностные результаты)')
    else:
        end = next((i for i in range(i114 + 1, len(text)) if re.match(r'^1\.2\.', text[i])), len(text))
        lr = sorted({int(x) for t in text[i114:end] for x in re.findall(r'^ЛР\s*(\d+)', t)})
        if lr != list(range(1, n_lr + 1)):
            need = set(range(1, n_lr + 1))
            errs.append(f'1.1.4: нет ЛР {sorted(need - set(lr))[:20]}, лишние ЛР {sorted(set(lr) - need)[:20]} (нужно ЛР 1…{n_lr})')

    for sec in ('1. ', '2. ', '3. ', '4. ', '5. '):
        if not any(t.upper().startswith(sec) and len(t) < 160 for t in text):
            errs.append(f'нет раздела «{sec.strip()}»')

    for rx, why in [(r'\[Ф\. ?И\. ?О\.[^\]]*\]', 'не заполнены Ф. И. О.'), (r'\[проверить[^\]]*\]', 'пометки [проверить]'), (r'_{4,}', 'пустые поля ____')]:
        n = len(re.findall(rx, full))
        if n:
            checks.append(f'{why}: {n}')
    for e in errs:
        print('ОШИБКА: ' + e)
    for c in checks:
        print('ПРОВЕРЬ: ' + c)
    print(f'МДК в КТП: {len(starts)}; ошибок: {len(errs)}; мест для человека: {len(checks)}')
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
