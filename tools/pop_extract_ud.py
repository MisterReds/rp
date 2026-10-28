#!/usr/bin/env python3
"""Извлечение данных ПОП-П (примерной рабочей программы УЧЕБНОЙ ДИСЦИПЛИНЫ) из .docx в JSON для rpgen (режим kind=ud).

Использование:
    python3 -I tools/pop_extract_ud.py приложение2.docx 2.4 ОП.04 data/pop/09.02.06_OP04.json

  приложение2.docx — файл «Приложение 2. Примерные рабочие программы дисциплин» к ПОП-П;
  2.4              — номер приложения нужной дисциплины («Приложение 2.4» — ОП.04);
  ОП.04            — код дисциплины (запись в JSON и проверка заголовка);
  выходной JSON    — файл для поля "pop" в project.json (project.json: "kind": "ud").

Переносится дословно: цель и место дисциплины, таблица «Код ОК, ПК | Уметь | Знать | Владеть навыками»,
разделы, темы (номер и название), содержание тем, практические занятия, помещения, литература,
таблица «Результаты обучения | Показатели освоенности | Методы оценки» (раздел 4).
Проверка: python3 tools/verify_sources.py <json> <приложение2.docx> --plan <план.tsv> --fgos <фгос.json>
(диапазоны полноты записываются в "_cover"; нумерацию практических занятий, повторяющуюся в ПОП, подтверждает "_ack").
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

NB = ' '


def norm(s):
    return re.sub(r'[ \t]+', ' ', (s or '').replace(NB, ' ')).strip()


def body_items(d):
    for el in d.element.body.iterchildren():
        tag = el.tag.split('}')[-1]
        if tag == 'p':
            yield Paragraph(el, d)
        elif tag == 'tbl':
            yield Table(el, d)


def rows_of(t):
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
    """Пункты ячейки. Пункты в ПОП заканчиваются «;» — абзац без «;» в конце (кроме последнего) продолжается следующим."""
    out, cur = [], ''
    for p in paras:
        p = p.strip()
        if not p:
            continue
        cur = (cur + ' ' + p).strip() if cur else p
        if cur.endswith(';') or cur.endswith('.'):
            out.append(cur.rstrip(';').strip()); cur = ''
    if cur:
        out.append(cur.rstrip(';').strip())
    return out


def strip_num(s):
    return re.sub(r'^\d+\.\s*', '', s).strip()


def main():
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    src, app, code, out_path = sys.argv[1:5]
    d = docx.Document(src)
    seq = list(body_items(d))
    tno = {}  # номер таблицы в нумерации tools/doc2text.py (t001, t002 …) и число строк
    n_t = 0
    for x in seq:
        if isinstance(x, Table):
            n_t += 1
            tno[id(x._tbl)] = (n_t, len(x.rows))
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
    head = ' '.join(norm(x.text) for x in part if isinstance(x, Paragraph))
    if code.replace('.', '') not in head.upper().replace('.', '').replace(' ', ''):
        sys.exit(f'В приложении {app} нет дисциплины {code}')

    out = {
        '_source': f'ПОП-П, приложение {app}, «Примерная рабочая программа дисциплины». Текст переносится в рабочую программу без изменений.',
        'discipline': code, 'format': 'ud', 'name_pop': '', 'goal': '', 'place': '', 'results_intro': '',
        'results': {'ok': {}, 'pk': {}}, 'hours': {}, 'sections': [], 'assessment': [], 'rooms': [], 'literature_main': [], 'literature_add': [],
        '_cover': [], '_ack': [], '_notes': [], '_source_doc': f'ПОП-П, приложение {app} (дисциплина {code}), .docx',
    }
    sp = re.search(r'\b(\d{2}\.\d{2}\.\d{2})\b', head)
    if sp:
        out['specialty'] = sp.group(1)
    mode = None
    for x in part:
        if isinstance(x, Paragraph):
            t = norm(x.text)
            if not t:
                continue
            low = t.lower()
            if not out['name_pop'] and re.match(rf'^«?{re.escape(code)}\s', t):
                out['name_pop'] = t.strip('«»')
            if low.startswith('цель дисциплины'):
                out['goal'] = t; continue
            if low.startswith('дисциплина «') and 'включена' in low:
                out['place'] = t; continue
            if 'соотносятся с планируемыми результатами' in t and not out['results_intro']:
                out['results_intro'] = t; continue
            if re.match(r'^3\.1\.?\s', t):
                mode = 'rooms'; continue
            if re.match(r'^3\.2\.\d', t):
                mode = 'lit_add' if 'дополнит' in low else 'lit_main'; continue
            if re.match(r'^3\.2\.?\s', t) or re.match(r'^4\.?\s*контроль', low) or low.startswith('4. контроль'):
                mode = None; continue
            if mode == 'rooms' and 'оснащ' in low:
                out['rooms'].append(t)
            elif mode == 'lit_main' and re.match(r'^\d+\.', t):
                out['literature_main'].append(strip_num(t))
            elif mode == 'lit_add' and re.match(r'^\d+\.', t):
                out['literature_add'].append(strip_num(t))
            continue

        rows = rows_of(x)
        if not rows or not rows[0]:
            continue
        head0 = ' '.join(rows[0][0][1])
        head_all = ' '.join(' '.join(c[1]) for c in rows[0])
        col = lambda r, j: next((c[1] for c in r if c[0] == j), None)
        tn, tr = tno[id(x._tbl)]
        if head0.startswith(('Код ОК, ПК', 'Результаты обучения', 'Наименование разделов и тем')):
            out['_cover'].append([f't{tn:03d} r02', f't{tn:03d} r{tr:02d}'])
        if head0.startswith('Код ОК, ПК') and 'Уметь' in head_all:
            for r in rows[1:]:
                c0 = col(r, 0)
                cd = code_norm(c0[0]) if c0 else None
                if not cd:
                    continue
                vals = [items(col(r, j) or []) for j in (1, 2, 3)]
                out['results']['ok' if cd.startswith('ОК') else 'pk'][cd] = {'um': vals[0], 'zn': vals[1], 'nav': vals[2]}
            continue
        if head0.startswith('Наименование составных частей'):
            for r in rows[1:]:
                if len(r) >= 2 and r[0][1] and r[1][1] and re.fullmatch(r'\d+', r[1][1][0]):
                    out['hours'][r[0][1][0]] = int(r[1][1][0])
            continue
        if head0.startswith('Результаты обучения') and 'Методы оценки' in head_all:
            for r in rows[1:]:
                c0 = col(r, 0) or []
                if not c0:
                    continue
                kind = c0[0].strip()
                m = col(r, 2) or []
                mt = m[0] if m and m[0].startswith('Примеры') else ''
                out['assessment'].append({'kind': kind, 'results': items(c0[1:]), 'criteria': col(r, 1) or [],
                                          'methods_title': mt, 'methods': [x.strip() for x in (m[1:] if mt else m) if x.strip()]})
            continue
        if head0.startswith('Наименование разделов и тем'):
            sec = theme = None
            for r in rows[1:]:
                if not r:
                    continue
                c0 = col(r, 0)
                first = ' '.join(c0) if c0 else ''
                rest = [p for (j, ps) in r if j > 0 for p in ps]
                if first.startswith('Раздел'):
                    hm = re.search(r'\((\d+)\s*час\w*\)\s*$', first)
                    sec = {'section': re.sub(r'\s*\(\d+\s*час\w*\)\s*$', '', first).strip(), 'hours': int(hm.group(1)) if hm else 0, 'themes': []}
                    out['sections'].append(sec)
                    theme = None
                    continue
                if first.startswith('Тема') and sec is not None:
                    m = re.match(r'^(Тема\s*\d+(?:\.\d+)*\.?)\s*(.*)$', c0[0])
                    num = re.sub(r'\s+', ' ', m.group(1))
                    if not num.endswith('.'):
                        num += '.'
                    theme = {'num': num, 'name': ' '.join([m.group(2)] + c0[1:]).strip(), 'content': [], 'labs': []}
                    sec['themes'].append(theme)
                elif c0:
                    continue
                if theme is None:
                    continue
                for ptxt in rest:
                    if re.match(r'^[\d\s/*-]+$', ptxt) or re.match(r'^(ОК|ПК)[\s.]*\d', ptxt):
                        continue
                    if ptxt.startswith(('Содержание', 'В том числе')):
                        continue
                    lm = re.match(r'^(Лабораторн\w*|Практическ\w*)\s+(работ\w*|заняти\w*)\s*№\s*(\d+)\.?\s*(.*)$', ptxt)
                    if lm:
                        theme['labs'].append({'n': int(lm.group(3)), 'title': lm.group(4).strip()})
                    else:
                        theme['content'].append(re.sub(r'^\d+\.?\s+', '', ptxt))
            continue

    labs = [l['n'] for sct in out['sections'] for t in sct['themes'] for l in t['labs']]
    if len(set(labs)) != len(labs):
        out['_ack'].append(f'labs:{code}')
        out['_notes'].append(f'В ПОП номера практических занятий повторяются или идут с пропусками ({labs}) — оставлены как в ПОП.')
    nums = [re.findall(r'\d+', t['num']) for sct in out['sections'] for t in sct['themes']]
    out['_notes'].append('Раздел 4 ПОП: «Примеры форм и методов контроля и оценки» — примеры, не обязательный перечень; рабочая программа использует подходящие из них.')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'Записано: {out_path}')
    for s in out['sections']:
        print(f"  {s['section']}: тем {len(s['themes'])}, практических {sum(len(t['labs']) for t in s['themes'])}")
    print(f"  результатов: ОК {len(out['results']['ok'])}, ПК {len(out['results']['pk'])}; строк оценки {len(out['assessment'])}; "
          f"помещений {len(out['rooms'])}; литература {len(out['literature_main'])}+{len(out['literature_add'])}; часы ПОП {out['hours']}")


if __name__ == '__main__':
    main()
