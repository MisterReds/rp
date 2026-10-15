#!/usr/bin/env python3
"""Извлечение примерной рабочей программы ПМ из ПООП формата 2021 г. (например, 09.02.07) в JSON для rpgen.

Отличия от формата ПОП 2025 (tools/pop_extract.py):
  • результаты освоения — таблица «Иметь практический опыт / уметь / знать» (results_simple);
  • работы без номеров: «Практическая работа «…»», «Лабораторная работа «…»»;
  • строки «Дополнительно для квалификаций "…"» и части строк после «Для квалификации «…»:» включаются,
    только если там названа квалификация группы;
  • перечень ОК (01–11) берётся из раздела 4.1 ПООП.

Использование (файл .doc сначала конвертировать: soffice --headless --convert-to docx ПООП.doc):
  python3 tools/pop_extract_2021.py ПООП.docx 1.5 out.json --qual "Специалист по информационным системам" \
      --mdk МДК.05.01 МДК.05.02 МДК.05.03
"""
import argparse
import json
import re
import sys

import docx
from docx.table import Table
from docx.text.paragraph import Paragraph


def norm(s):
    return ' '.join((s or '').replace(' ', ' ').split())


def items_of(d):
    for el in d.element.body.iterchildren():
        tag = el.tag.split('}')[-1]
        if tag == 'p':
            yield Paragraph(el, d)
        elif tag == 'tbl':
            yield Table(el, d)


def rows_of(t):
    out = []
    for r in t.rows:
        cells, prev = [], None
        for c in r.cells:
            if c._tc is prev:
                continue
            prev = c._tc
            cells.append([norm(p.text) for p in c.paragraphs if norm(p.text)])
        out.append(cells)
    return out


def code_norm(s):
    m = re.match(r'^(ОК|ПК)\s*\.?\s*(\d+)(?:\.(\d+))?', s)
    if not m:
        return None
    if m.group(1) == 'ОК':
        return 'ОК %02d' % int(m.group(2))
    return 'ПК %s.%s' % (m.group(2), m.group(3)) if m.group(3) else None


# внутри строки: «Аппаратное обеспечение. Для квалификации «Администратор баз данных»: Развертывание …»
INLINE_Q = re.compile(r'\s*Для квалификаци[ийя]\s*[«"]([^»"]+)[»"]\s*:?\s*')


def split_inline(lines, qual):
    """Часть строки после «Для квалификации «X»:» остаётся, только если X — квалификация группы."""
    out = []
    for ln in lines:
        m = INLINE_Q.search(ln)
        if not m:
            out.append(ln)
            continue
        pre, post = ln[:m.start()].strip(), ln[m.end():].strip()
        if pre:
            out.append(pre)
        if post and qual in m.group(1).lower():
            out.append(post)
    return out


def qual_filter(lines, qual):
    """Критерии/методы: блок «Дополнительно для квалификации "X":» и следующая за ним строка остаются,
    только если X включает квалификацию группы (в ПООП блок — заголовок + одна строка)."""
    out, skip = [], False
    for ln in lines:
        dm = re.match(r'^Дополнительно для квалификаци[йи](.*?)[:.]?\s*$', ln, re.I)
        if dm:
            skip = qual not in dm.group(1).lower()
            if not skip:
                out.append(ln)
            continue
        if skip and ln.strip():
            skip = False
            continue
        out.append(ln)
    return out


DOP = re.compile(r'^Дополнительно для квалификаци[йи](.*?)[:.]?\s*$', re.I)
WORK = re.compile(r'^(Практическ\w+ (?:работ\w*|заняти\w*)|Лабораторн\w+ работ\w*)\.?\s*(?:№\s*\d+\.?)?\s*[«"](.+?)[»"]?\s*\.?$')


# формат 2022 (ПООП 09.02.01): «Практическое занятие № 1. Название» без кавычек
WORK_PLAIN = re.compile(r'^((?:Практическ|Лабораторн)\w+ (?:работ\w*|заняти\w*))\s*№\s*\d+\.?\s+(\S.*?)\s*$')


def join_quotes(lines):
    """Склеить абзацы, если кавычки «» разорваны переносом."""
    out = []
    for ln in lines:
        if out and out[-1].count('«') > out[-1].count('»'):
            out[-1] = out[-1] + ' ' + ln
        else:
            out.append(ln)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('docx')
    ap.add_argument('app')
    ap.add_argument('out')
    ap.add_argument('--qual', required=True, help='квалификация группы, как в ПООП')
    ap.add_argument('--mdk', nargs='*', default=[])
    a = ap.parse_args()
    d = docx.Document(a.docx)
    seq = list(items_of(d))
    ptext = lambda x: norm(x.text) if isinstance(x, Paragraph) else ''
    # перечень ОК из раздела 4.1
    ok = {}
    for i, x in enumerate(seq):
        if ptext(x) == '4.1. Общие компетенции':
            t = next((y for y in seq[i + 1:i + 4] if isinstance(y, Table)), None)
            if t is None:
                continue
            for r in rows_of(t)[1:]:
                c = code_norm(' '.join(r[0])) if r and r[0] else None
                if c and c not in ok:
                    ok[c] = ' '.join(r[1]).rstrip('.')
            break
    start = next(i for i, x in enumerate(seq) if ptext(x) == f'Приложение {a.app}')
    end = next((i for i, x in enumerate(seq[start + 1:], start + 1) if re.match(r'^Приложение \d', ptext(x))), len(seq))
    part = seq[start:end]
    qual = a.qual.lower()
    out = {'_source': f'ПООП, приложение {a.app}; квалификация «{a.qual}». Разделы, темы, содержание и работы переносятся без изменений; '
                      f'строки «Дополнительно для квалификаций…» включены, если в них есть эта квалификация.',
           'format': '2021', 'qualification': a.qual, 'ok': [[k, v] for k, v in ok.items()],
           'pk': [], 'vd': '', 'results_simple': {}, 'sections': [], 'up_works': [], 'pp_works': [],
           'criteria': {}, 'course_topics': [], 'rooms': [], 'literature_main': [], 'literature_add': []}
    mode = None
    plain_lit = False
    for x in part:
        if isinstance(x, Paragraph):
            t = ptext(x)
            if not t:
                continue
            if re.match(r'^3\.1\.?\s', t):
                mode = 'rooms'; continue
            if re.match(r'^3\.2\.1', t) or re.match(r'^3\.2\.2', t):
                mode = 'lit_main'; continue
            if re.match(r'^3\.2\.3', t) or t.lower().startswith('дополнительные источники'):
                mode = 'lit_add'; plain_lit = t.lower().startswith('дополнительные источники'); continue
            if re.match(r'^основные (печатные|электронные) издания', t.lower()):
                mode = 'lit_main'; plain_lit = True; continue
            if re.match(r'^3\.2\.?\s', t) or re.match(r'^4\.\s', t):
                mode = None; continue
            if mode == 'rooms' and 'оснащ' in t.lower():
                out['rooms'].append(t.rstrip(':') + ('' if t.endswith('.') else '.'))
            elif mode in ('lit_main', 'lit_add') and re.match(r'^\d+\.', t):
                out['literature_main' if mode == 'lit_main' else 'literature_add'].append(re.sub(r'^\d+\.\s*', '', t))
            elif mode in ('lit_main', 'lit_add') and plain_lit:
                # формат 2022: источники без номеров; запись, оборванная на «/», продолжается в следующем абзаце
                lst = out['literature_main' if mode == 'lit_main' else 'literature_add']
                if lst and lst[-1].endswith('/'):
                    lst[-1] = lst[-1] + ' ' + t
                else:
                    lst.append(t)
            continue
        rows = rows_of(x)
        if not rows or not rows[0]:
            continue
        head = ' '.join(rows[0][0])
        if head == 'Код' and len(rows[0]) > 1 and 'профессиональных' in ' '.join(rows[0][1]):
            for r in rows[1:]:
                k = ' '.join(r[0])
                if k.startswith('ВД'):
                    out['vd'] = k
                    out['vd_name'] = ' '.join(r[1])
                elif code_norm(k):
                    out['pk'].append([code_norm(k), ' '.join(r[1]).rstrip('.')])
            continue
        if head.startswith('Иметь практический опыт'):
            for r in rows:
                key = {'иметь практический опыт': 'opyt', 'уметь': 'um', 'знать': 'zn'}.get(' '.join(r[0]).lower())
                if key:
                    out['results_simple'][key] = ' '.join(r[1])
            continue
        if head.startswith('Код и наименование') and len(rows[0]) >= 2 and 'ритери' in ' '.join(rows[0][1]):
            for r in rows[1:]:
                k = code_norm(' '.join(r[0])) if r and r[0] else None
                if not k or k in out['criteria']:
                    continue
                out['criteria'][k] = {'criteria': qual_filter([y.lstrip('- ').strip() for y in (r[1] if len(r) > 1 else [])], qual),
                                      'methods': qual_filter([y.lstrip('- ').strip() for y in (r[2] if len(r) > 2 else [])], qual)}
            continue
        if head.startswith('Наименование разделов и тем'):
            sec = theme = None
            for r in rows:
                first = ' '.join(r[0]) if r else ''
                body = r[1] if len(r) > 1 else []
                if first.startswith('Наименование разделов'):
                    continue
                if first.startswith('Раздел'):
                    sec = {'mdk': '', 'mdk_title_pop': '', 'section': re.sub(r'\s+', ' ', first).strip(), 'themes': []}
                    out['sections'].append(sec)
                    theme = None
                    continue
                if first.startswith('МДК') and sec is not None:
                    m = re.match(r'МДК\s*\.?\s*(\d+)\s*\.\s*(\d+)', first)
                    sec['mdk'] = f'МДК.{m.group(1)}.{m.group(2)}' if m else ''
                    sec['mdk_title_pop'] = first
                    continue
                if first.startswith('Курсов') and 'Тематика курсовых' in r[0]:
                    out['course_topics'] =
                        r[0][[i for i, c in enumerate(r[0]) if c.startswith('Тематика курсовых')][0] + 1:]
                if r and len(r[0]) > 2 and re.match(r'^(Учебная|Производственная) практика', r[0][0]):
                    # формат 2022: виды работ практики — абзацы ячейки после заголовка «Виды работ[:]»
                    ws = [c.rstrip(';.').strip() for c in r[0][1:] if not re.match(r'^Виды работ:?$', c)]
                    out['up_works' if r[0][0].startswith('Учебная') else 'pp_works'].extend(w for w in ws if w)
                if first.startswith('Курсов') or first.startswith('Учебная практика') or first.startswith('Производственная') or first.startswith('Всего'):
                    theme = None
                    continue
                if first.startswith('Тема') and sec is not None:
                    m = re.match(r'^(Тема\s*[\d.]+?\.?)\s+(.*)$', first)
                    num = m.group(1) if m.group(1).endswith('.') else m.group(1) + '.'
                    name = m.group(2).strip()
                    if theme is None or theme['num'] != num:
                        theme = {'num': num, 'name': name, 'content': [], 'labs': []}
                        sec['themes'].append(theme)
                if theme is None or not body:
                    continue
                use = True
                for ln in split_inline(join_quotes(body), qual):
                    dm = DOP.match(ln)
                    if dm:
                        use = qual in dm.group(1).lower()
                        continue
                    if not use:
                        continue
                    if ln.startswith(('Содержание', 'В том числе')) or re.match(r'^[\d\s/*]+$', ln):
                        continue
                    wm = WORK.match(ln) or WORK_PLAIN.match(ln)
                    if wm:
                        theme['labs'].append({'n': 0, 'kind': wm.group(1), 'title': wm.group(2).strip().rstrip('»').strip()})
                    else:
                        theme['content'].append(ln)
            continue
    for i, s in enumerate(out['sections']):
        if i < len(a.mdk):
            s['mdk'] = a.mdk[i]
        n = 0
        for t in s['themes']:
            for l in t['labs']:
                n += 1
                l['n'] = n
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'Записано: {a.out}; ОК {len(out["ok"])}, ПК {len(out["pk"])}')
    for s in out['sections']:
        print(f"  {s['mdk']} {s['section']}")
        for t in s['themes']:
            print(f"     {t['num']} {t['name']}: содержание {len(t['content'])}, работ {len(t['labs'])}")
    print(f"  критериев {len(out['criteria'])}; помещений {len(out['rooms'])}; литература {len(out['literature_main'])}+{len(out['literature_add'])}")


if __name__ == '__main__':
    main()
