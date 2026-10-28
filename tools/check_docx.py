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
Учебная дисциплина (в документе «Рабочая программа УЧЕБНОЙ ДИСЦИПЛИНЫ») проверяется отдельным набором: то же запрещённое, нумерация
занятий и практических работ в п. 2.2 сквозная, «Всего по <код>» = «Объем образовательной программы» (п. 2.1) = итог п. 1.3,
в п. 1.2 перечислены все ЛР, форма аттестации конкретна, есть разделы 1–5, в ФОС — тест с ключом, вопросы и задания «Дано … Результат …».
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


def finish(errs, checks, label):
    for e in errs:
        print('ОШИБКА: ' + e)
    for c in checks:
        print('ПРОВЕРЬ: ' + c)
    print(f'{label}; ошибок: {len(errs)}; мест для человека: {len(checks)}')
    sys.exit(1 if errs else 0)


def check_ud(text, full, low, errs, checks, n_lr):
    i22 = next((i for i, t in enumerate(text) if t.startswith('2.2. Тематический план')), None)
    i3 = next((i for i, t in enumerate(text) if t.upper().startswith('3. УСЛОВИЯ')), None)
    if i22 is None or i3 is None:
        errs.append('нет п. 2.2 или раздела 3')
        return finish(errs, checks, 'Учебная дисциплина')
    block = text[i22:i3]
    pw, les = [], []
    for t in block:
        pw += [int(x) for x in re.findall(r'Практическая работа № (\d+)', t)]
        cells = re.split(r'\s*\|\s*', t)
        # строка занятия: «Тема … | N. название | 2 | …»; строки содержания темы («1. …» внутри ячейки) часов «2» рядом не имеют
        if len(cells) >= 3 and re.match(r'^\d+\. \S', cells[1]) and cells[2].strip() == '2':
            les.append(int(cells[1].split('.')[0]))
    if les != list(range(1, len(les) + 1)):
        errs.append(f'нумерация занятий в п. 2.2 сбита: {les[:50]}')
    if pw != list(range(1, len(pw) + 1)):
        errs.append(f'номера практических работ {pw[:50]} — нужно 1, 2, 3 … без пропусков и повторов')
    m = re.search(r'^Всего по (\S+) \| (\d+)', '\n'.join(block), re.M)
    tot = int(m.group(2)) if m else None
    if tot is None:
        errs.append('нет строки «Всего по …» в п. 2.2')
    else:
        if tot != 2 * len(les):
            errs.append(f'«Всего» {tot} ч, а занятий {len(les)} × 2 ч = {2 * len(les)} ч')
        m21 = re.search(r'Объем образовательной программы \| (\d+)', full)
        if not m21 or int(m21.group(1)) != tot:
            errs.append(f'п. 2.1: объём {m21.group(1) if m21 else "не найден"} ч ≠ {tot} ч')
        m13 = re.search(r'^УД [^|]*\|[^\n]*?\| (\d+)\s*$', full, re.M)
        if m13 and int(m13.group(1)) != tot:
            errs.append(f'п. 1.3: всего {m13.group(1)} ч ≠ {tot} ч')
    i12 = next((i for i, t in enumerate(text) if t.startswith('1.2.')), None)
    i13 = next((i for i, t in enumerate(text) if t.startswith('1.3.')), None)
    if i12 is None or i13 is None:
        errs.append('нет п. 1.2 или 1.3')
    else:
        lr = sorted({int(x) for t in text[i12:i13] for x in re.findall(r'^ЛР\s*(\d+)', t)})
        if lr != list(range(1, n_lr + 1)):
            errs.append(f'п. 1.2: нет ЛР {sorted(set(range(1, n_lr + 1)) - set(lr))[:20]} (нужно ЛР 1…{n_lr})')
    if not re.search(r'в форме (экзамена|дифференцированного зач[её]та|зач[её]та|контрольной работы) \(\d курс, \d семестр\)', low):
        errs.append('форма промежуточной аттестации не конкретна (нужно «в форме экзамена (2 курс, 1 семестр)»)')
    for sec in ('1. ', '2. ', '3. ', '4. ', '5. '):
        if not any(t.upper().startswith(sec) and len(t) < 160 for t in text):
            errs.append(f'нет раздела «{sec.strip()}»')
    for h in ('5.1.1.', '5.1.4.', '5.2.3.', '5.2.4.'):
        if not any(t.startswith(h) for t in text):
            errs.append(f'ФОС: нет п. {h}')
    i514 = next((i for i, t in enumerate(text) if t.startswith('5.1.4.')), None)
    i52 = next((i for i, t in enumerate(text) if t.startswith('5.2.')), None)
    if i514 is not None and i52 is not None:
        nq = len([t for t in text[i514:i52] if re.match(r'^\d+\. ', t)])
        if nq < 60:
            errs.append(f'ФОС: в тесте {nq} вопросов, нужно не меньше 60')
        if not any(t.startswith('Ключ') for t in text[i514:i52]):
            errs.append('ФОС: нет ключа к тесту')
    ndano = len(re.findall(r'(?m)^Дано: ', full))
    if ndano < 60:
        errs.append(f'ФОС: заданий «Дано … Результат …» {ndano}, нужно не меньше 60 (без образца билета)')
    for bad in ('undefined', 'null', 'NaN', '[object Object]'):
        if re.search(r'(?<![\w-])' + re.escape(bad) + r'(?![\w-])', full):
            errs.append(f'в тексте «{bad}» — не подставились данные')
    for rx, why in [(r'\[Ф\. ?И\. ?О\.[^\]]*\]', 'не заполнены Ф. И. О.'), (r'\[проверить[^\]]*\]', 'пометки [проверить]'), (r'_{4,}', 'пустые поля ____')]:
        n = len(re.findall(rx, full))
        if n:
            checks.append(f'{why}: {n}')
    finish(errs, checks, f'Учебная дисциплина: занятий {len(les)}, практических работ {len(pw)}')


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

    if re.search(r'Рабочая программа УЧЕБНОЙ ДИСЦИПЛИНЫ', full):
        return check_ud(text, full, low, errs, checks, n_lr)

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

    for bad in ('undefined', 'null', 'NaN', '[object Object]'):
        n = len(re.findall(r'(?<![\w-])' + re.escape(bad) + r'(?![\w-])', full))
        if n:
            errs.append(f'в тексте «{bad}» ({n}) — не подставились данные')

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
