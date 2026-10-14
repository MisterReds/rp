#!/usr/bin/env python3
"""Извлечение данных ПОП (примерной рабочей программы ПМ) из .docx в JSON для rpgen.

Использование:
    python3 tools/pop_extract.py ПОП.docx 1.1 data/pop/09.02.06_PM01.json

  ПОП.docx — файл приложения 1 к ПОП (примерные рабочие программы модулей);
  1.1      — номер приложения с нужным модулем («Приложение 1.1» — ПМ.01, «1.2» — ПМ.02 …);
  выходной JSON — файл для поля "pop" в project.json.

Переносится дословно: разделы, темы (номер и название), содержание тем, лабораторные работы,
виды работ практик, таблица «Код ОК, ПК | Уметь | Знать | Владеть навыками», критерии и методы
оценки, помещения, литература. После извлечения проверьте файл глазами: структура таблиц ПОП
бывает неоднородной.
"""
import json
import re
import sys

try:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
except ImportError:
    sys.exit('Нужен пакет python-docx: pip install python-docx')

NB = ' '


def norm(s):
    return re.sub(r'[ \t]+', ' ', (s or '').replace(NB, ' ')).strip()


def body_items(d):
    """Абзацы и таблицы документа по порядку."""
    for el in d.element.body.iterchildren():
        tag = el.tag.split('}')[-1]
        if tag == 'p':
            yield Paragraph(el, d)
        elif tag == 'tbl':
            yield Table(el, d)


def rows_of(t):
    """Строки таблицы: каждая ячейка выводится один раз на всю таблицу (объединённые по горизонтали
    и по вертикали ячейки не повторяются). Ячейка — (номер столбца, список абзацев)."""
    out, seen = [], set()
    for r in t.rows:
        cells = []
        for j, c in enumerate(r.cells):
            if c._tc in seen:
                continue
            seen.add(c._tc)
            cells.append((j, [norm(p.text) for p in c.paragraphs if norm(p.text)]))
        out.append(cells)
    return out


def code_norm(s):
    s = norm(s).rstrip('.')
    m = re.match(r'ОК\s*\.?\s*0?(\d)\b', s)
    if m:
        return 'ОК 0' + m.group(1)
    m = re.match(r'ПК\s*\.?\s*(\d+)\.(\d+)', s)
    if m:
        return f'ПК {m.group(1)}.{m.group(2)}'
    return None


def items(paras):
    return [p.strip().rstrip(';').strip() for p in paras if p.strip().rstrip(';').strip()]


def strip_num(s):
    return re.sub(r'^\d+\.\s*', '', s).strip()


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    src, app, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    d = docx.Document(src)
    seq = list(body_items(d))
    start = end = None
    for i, x in enumerate(seq):
        if isinstance(x, Paragraph):
            t = norm(x.text)
            if start is None and t == f'Приложение {app}':
                start = i
            elif start is not None and re.fullmatch(r'Приложение \d+(\.\d+)?', t):
                end = i
                break
    if start is None:
        sys.exit(f'Не найден абзац «Приложение {app}»')
    part = seq[start:end]

    out = {
        '_source': f'ПОП, приложение {app}. Названия разделов, тем и содержание переносятся в рабочую программу без изменений.',
        'results_intro': '', 'results': {'ok': {}, 'pk': {}}, 'sections': [],
        'up_works': [], 'pp_works': [], 'criteria': {}, 'course_topics': [],
        'rooms': [], 'literature_main': [], 'literature_add': [],
    }
    mode = None
    for x in part:
        if isinstance(x, Paragraph):
            t = norm(x.text)
            if not t:
                continue
            if 'соотносятся с планируемыми результатами' in t and not out['results_intro']:
                out['results_intro'] = t
            low = t.lower()
            if 'тематика курсов' in low:
                mode = 'course'; continue
            if re.match(r'^3\.\s*Услови', t):
                mode = None; continue
            if mode == 'course':
                out['course_topics'].append(re.sub(r'^\d+\.\s*', '', t)); continue
            if re.match(r'^3\.1\.?\s', t):
                mode = 'rooms'; continue
            if re.match(r'^3\.2\.?\s', t):
                mode = None; continue
            if re.match(r'^3\.2\.\d', t) or 'основные печатные' in low or 'основные источники' in low or 'дополнительные источники' in low:
                mode = 'lit_add' if 'дополнит' in low else 'lit_main'; continue
            if low.startswith('контроль и оценка') or re.match(r'^4\.?\s*контроль', low):
                mode = None; continue
            if mode == 'rooms' and 'оснащ' in low:
                out['rooms'].append(re.sub(r'(в соответствии с )+', 'в соответствии с ', t))
            elif mode == 'lit_main' and re.match(r'^\d+\.', t):
                out['literature_main'].append(strip_num(t))
            elif mode == 'lit_add' and re.match(r'^\d+\.', t):
                out['literature_add'].append(strip_num(t))
            continue

        rows = rows_of(x)
        if not rows or not rows[0]:
            continue
        head = ' '.join(rows[0][0][1])
        head_all = ' '.join(' '.join(c[1]) for c in rows[0])
        col = lambda r, j: next((c[1] for c in r if c[0] == j), None)
        # таблица результатов «Код ОК, ПК | Уметь | Знать | Владеть навыками»
        if head.startswith('Код ОК, ПК') and 'Уметь' in head_all:
            for r in rows[1:]:
                c0 = col(r, 0)
                code = code_norm(c0[0]) if c0 else None
                if not code:
                    continue
                vals = [items(col(r, j) or []) for j in (1, 2, 3)]
                key = 'ok' if code.startswith('ОК') else 'pk'
                out['results'][key][code] = {'um': vals[0], 'zn': vals[1], 'nav': vals[2]}
            continue
        # критерии и методы оценки (объединённая ячейка методов относится к первой строке)
        if head.startswith('Код ПК, ОК') or head.startswith('Код и наименование'):
            for r in rows[1:]:
                c0 = col(r, 0)
                code = code_norm(c0[0]) if c0 else None
                if not code:
                    continue
                out['criteria'][code] = {'criteria': items(col(r, 1) or []), 'methods': items(col(r, 2) or [])}
            continue
        # примерное содержание модуля
        if head.startswith('Наименование разделов и тем'):
            sec = theme = None
            for r in rows[1:]:
                if not r:
                    continue
                c0 = col(r, 0)
                first = ' '.join(c0) if c0 else ''
                rest = [p for (j, ps) in r if j > 0 for p in ps]
                if first.startswith('Раздел'):
                    sec = {'mdk': '', 'mdk_title_pop': '', 'section': re.sub(r'\s*\(\d+\s*час\w*\)\s*$', '', first).strip(), 'themes': []}
                    out['sections'].append(sec)
                    theme = None
                    continue
                if first.startswith('МДК') and sec is not None and not sec['mdk']:
                    m = re.match(r'МДК\s*\.?\s*(\d+)\s*\.\s*(\d+)', first)
                    sec['mdk'] = f'МДК.{m.group(1)}.{m.group(2)}' if m else ''
                    sec['mdk_title_pop'] = first
                    continue
                if first.startswith('Учебная практика') or first.startswith('Производственная практика'):
                    key = 'up_works' if first.startswith('Учебная') else 'pp_works'
                    allp = c0 + rest
                    k = next((i for i, p in enumerate(allp) if 'Виды работ' in p), None)
                    if k is not None:
                        out[key] = [re.sub(r'^\d+\.\s*', '', p).rstrip(';.').strip() for p in allp[k + 1:] if not re.match(r'^[\d\s]+$', p)]
                    theme = None
                    continue
                if first.startswith('Курсов') or any(p.startswith('Тематика курсов') for p in rest):
                    hm = re.search(r'(\d+)\s*час', first)
                    if sec is not None and hm:
                        sec['course_hours'] = int(hm.group(1))
                    theme = None
                    continue
                if first.startswith('Тема') and sec is not None:
                    m = re.match(r'^(Тема\s*\d+(?:\.\d+)*\.?)\s*(.*)$', c0[0])
                    num = re.sub(r'\s+', ' ', m.group(1))
                    if not num.endswith('.'):
                        num += '.'
                    name = ' '.join([m.group(2)] + c0[1:]).strip()
                    theme = {'num': num, 'name': name, 'content': [], 'labs': []}
                    sec['themes'].append(theme)
                elif c0:
                    continue
                if theme is None:
                    continue
                for ptxt in rest:
                    if re.match(r'^[\d\s/*-]+$', ptxt) or re.match(r'^(ОК|ПК)[\s.]*\d', ptxt):
                        continue
                    if ptxt.startswith(('Содержание', 'В том числе', 'Необходимость и тематика', 'Тематика самостоятельной')):
                        continue
                    lm = re.match(r'^(Лабораторн\w*|Практическ\w*)\s+(работ\w*|заняти\w*)\s*№\s*(\d+)\.?\s*(.*)$', ptxt)
                    if lm:
                        theme['labs'].append({'n': int(lm.group(3)), 'title': lm.group(4).strip()})
                    else:
                        theme['content'].append(ptxt)
            continue

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'Записано: {out_path}')
    for s in out['sections']:
        print(f"  {s['mdk'] or '?МДК'} {s['section']}: тем {len(s['themes'])}, лабораторных {sum(len(t['labs']) for t in s['themes'])}")
    print(f"  результатов: ОК {len(out['results']['ok'])}, ПК {len(out['results']['pk'])}; критериев {len(out['criteria'])}; "
          f"видов работ УП {len(out['up_works'])}, ПП {len(out['pp_works'])}; помещений {len(out['rooms'])}; литература {len(out['literature_main'])}+{len(out['literature_add'])}")


if __name__ == '__main__':
    main()
