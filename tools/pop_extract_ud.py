#!/usr/bin/env python3
"""Извлечение данных ПОП-П (примерной рабочей программы УЧЕБНОЙ ДИСЦИПЛИНЫ) из .docx в JSON для rpgen (режим kind=ud).

Использование:
    python3 -I tools/pop_extract_ud.py приложение2.docx 2.4 ОП.04 data/pop/09.02.06_OP04.json

  приложение2.docx — файл «Приложение 2. Примерные рабочие программы дисциплин» к ПОП-П;
  2.4              — номер приложения нужной дисциплины («Приложение 2.4» — ОП.04);
  ОП.04            — код дисциплины (запись в JSON и проверка заголовка);
  выходной JSON    — файл для поля "pop" в project.json (project.json: "kind": "ud").

ПООП СПО (не «Профессионалитет»): приложение «II.N» к программе СПО, например
    python3 -I tools/pop_extract_ud.py poop_spo.docx II.7 ОП.04 data/pop/09.02.06_OP04.json --labs "2=1-6,3=7-10"
  Формат ПООП СПО другой: нет разделов (только «Тема N.»), нет цели дисциплины, одна строка таблицы результатов на несколько кодов
  (диапазоны «ОК 01-ОК 02», «ПК 2.3-ПК 2.4» раскрываются), практические работы — общим списком в конце таблицы тематического плана:
  --labs «номер темы=диапазон работ списка» относит их к темам (обязателен); --ok-map «ОК 09=ОК 02,ОК 10=ОК 09» — если коды ОК ПООП (ФГОС 2016, ОК 01–11)
  не совпадают с ФГОС группы (ФГОС 2023, ОК 01–09): коды заменяются, исходная запись кодов сохраняется в "codes_poop", замена — в "_ok_map". Другие источники обрабатываются прежним способом.

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


def rows_of(t, per_row=False):
    """Строки таблицы: список ячеек (индекс, абзацы). per_row — объединённые по вертикали ячейки повторяются в каждой строке (ПООП СПО)."""
    out, seen = [], set()
    for r in t.rows:
        if per_row:
            seen = set()
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


PER_PARA = False  # --item-per-paragraph: каждый абзац ячейки — отдельный пункт (ПООП «Профессионалитет»)


def items(paras):
    """Пункты ячейки. Пункты в ПОП заканчиваются «;» — абзац без «;» в конце (кроме последнего) продолжается следующим."""
    if PER_PARA:
        return [x.strip().rstrip(';').strip() for x in paras if x.strip()]
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


RANGE = re.compile(r'(ОК|ПК)\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(?:ОК|ПК)\s*(\d+(?:\.\d+)?)')


def expand_codes(s):
    """«ОК 01-ОК 02, ОК 04-ОК 05, ОК 09 –ОК 10; ПК 1.2, ПК 2.3-ПК 2.4» → ['ОК 01', 'ОК 02', 'ОК 04', …, 'ПК 1.2', 'ПК 2.3', 'ПК 2.4']"""
    out = []

    def add(kind, a, b=None):
        if kind == 'ОК':
            lo, hi = int(a), int(b if b is not None else a)
            out.extend(f'ОК {i:02d}' for i in range(lo, hi + 1))
        else:
            m1, n1 = a.split('.')
            m2, n2 = (b or a).split('.')
            if m1 != m2:
                sys.exit(f'Диапазон ПК {a}-{b} между модулями не раскрывается')
            out.extend(f'ПК {m1}.{i}' for i in range(int(n1), int(n2) + 1))
    rest = RANGE.sub(lambda m: (add(m.group(1), m.group(2), m.group(3)) or ''), s)
    for m in re.finditer(r'(ОК|ПК)\s*(\d+(?:\.\d+)?)', rest):
        add(m.group(1), m.group(2))
    seen, res = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            res.append(c)
    return sorted(res, key=lambda c: (c[:2], [int(x) for x in c[3:].split('.')]))


def extract_spo(src, app, code, out_path, labs_arg, ok_map=None, notes=()):
    """Приложение «II.N» ПООП СПО → JSON ПОП-УД (формат тот же, что у ПОП-П; разделов нет — один безымянный раздел)."""
    d = docx.Document(src)
    seq = list(body_items(d))
    tno, n_t = {}, 0
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
            elif start is not None and re.fullmatch(r'Приложение (?:\d+|II)(\.\d+)?', t):
                end = i
                break
    if start is None:
        sys.exit(f'Не найден абзац «Приложение {app}»')
    part = seq[start:end]
    head = ' '.join(norm(x.text) for x in part if isinstance(x, Paragraph))
    if code.replace('.', '') not in head.upper().replace('.', '').replace(' ', ''):
        sys.exit(f'В приложении {app} нет дисциплины {code}')
    sp = re.search(r'\b(\d{2}\.\d{2}\.\d{2})\b', head)
    out = {
        '_source': f'ПООП СПО {sp.group(1) if sp else ""}, приложение {app}, «Примерная рабочая программа учебной дисциплины». Текст переносится в рабочую программу без изменений.',
        'discipline': code, 'format': 'ud', '_source_kind': 'poop_spo', 'name_pop': '', 'goal': '', 'place': '', 'results_intro': '',
        'results': {'ok': {}, 'pk': {}}, 'results_shared': False, 'hours': {}, 'sections': [], 'assessment': [], 'rooms': [], 'literature_main': [], 'literature_add': [],
        '_cover': [], '_ack': [], '_notes': [], '_source_doc': f'ПООП СПО {sp.group(1) if sp else ""} (приложение {app}, дисциплина {code}), .doc → .docx',
    }
    if sp:
        out['specialty'] = sp.group(1)
    mode = None
    for x in part:
        if isinstance(x, Paragraph):
            t = norm(x.text)
            if not t:
                continue
            low = t.lower()
            if not out['name_pop'] and re.match(r'^«?ОП\.?\s*\d+\s', t):
                out['name_pop'] = t.strip('«»')
            m = re.match(r'^1\.1\.?\s*(Место дисциплины.*)$', t)
            if m:
                out['place'] = m.group(1); continue
            if re.match(r'^3\.1\.?\s', t):
                mode = 'rooms'; continue
            if re.match(r'^3\.2\.\d', t):
                mode = 'lit_add' if 'дополнит' in low else 'lit_main'; continue
            if re.match(r'^3\.2\.?\s', t) or low.startswith('4. контроль'):
                mode = None; continue
            if mode == 'rooms' and 'оснащ' in low:
                out['rooms'].append(t)
            elif mode in ('lit_main', 'lit_add') and re.match(r'^\d+\.\s', t):
                out['literature_main' if mode == 'lit_main' else 'literature_add'].append(strip_num(t))
            continue
        rows = rows_of(x, per_row=True)
        if not rows or not rows[0]:
            continue
        head0 = ' '.join(rows[0][0][1])
        tn, tr = tno[id(x._tbl)]
        col = lambda r, j: next((c[1] for c in r if c[0] == j), None)
        if head0.startswith('Код') and 'Умения' in ' '.join(' '.join(c[1]) for c in rows[0]):
            out['_cover'].append([f't{tn:03d} r02', f't{tn:03d} r{tr:02d}'])
            for r in rows[1:]:
                raw_codes = ' '.join(col(r, 0) or [])
                cds = expand_codes(raw_codes)
                if not cds:
                    continue
                if ok_map:  # коды ОК ПООП (ФГОС 2016) → коды ФГОС группы
                    cds = sorted(dict.fromkeys(ok_map.get(c, c) for c in cds), key=lambda c: (c[:2], [int(z) for z in c[3:].split('.')]))
                    out['_ok_map'] = ok_map
                    out['codes_poop'] = raw_codes
                vals = [[z.strip().rstrip(';').strip() for z in (col(r, j) or []) if z.strip()] for j in (1, 2)]
                if len(cds) > 1:
                    out['results_shared'] = True
                for cd in cds:
                    out['results']['ok' if cd.startswith('ОК') else 'pk'][cd] = {'um': vals[0], 'zn': vals[1], 'nav': []}
            continue
        if head0.startswith('Вид учебной работы'):
            for r in rows[1:]:
                if len(r) >= 2 and r[0][1] and r[1][1] and re.fullmatch(r'\d+', r[1][1][0]):
                    out['hours'][r[0][1][0]] = int(r[1][1][0])
            continue
        if head0.startswith('Результаты обучения'):
            out['_cover'].append([f't{tn:03d} r02', f't{tn:03d} r{tr:02d}'])
            cur = None
            for r in rows[1:]:
                c0, c1, c2 = col(r, 0) or [], col(r, 1) or [], [z.strip() for z in (col(r, 2) or []) if z.strip()]
                if len(c0) == 1 and c0[0].startswith('Перечень'):
                    cur = {'kind': c0[0], 'results': [], 'criteria': c1, 'methods_title': '', 'methods': c2}
                    out['assessment'].append(cur)
                elif cur is not None and not cur['results']:
                    cur['results'] = [z.strip().rstrip(';').strip() for z in c0 if z.strip()]
                    cur['criteria'] = c1 or cur['criteria']
                    cur['methods'] = list(dict.fromkeys(cur['methods'] + c2))
            continue
        if head0.startswith('Наименование разделов и тем'):
            out['_cover'].append([f't{tn:03d} r03', f't{tn:03d} r{tr:02d}'])
            sec = {'section': '', 'hours': 0, 'themes': []}
            out['sections'].append(sec)
            theme, pool, mark = None, [], None
            for r in rows[2:]:
                c0 = col(r, 0) or []
                c1 = col(r, 1) or []
                first = norm(c0[0]) if c0 else ''
                if first.startswith('Тема'):
                    num = first if first.endswith('.') else first + '.'
                    name = ' '.join(norm(z) for z in c0[1:] if norm(z))
                    if theme is None or theme['num'] != num:
                        theme = {'num': num, 'name': name, 'content': [], 'labs': []}
                        sec['themes'].append(theme)
                        mark = None
                    txt = norm(c1[0]) if c1 else ''
                    if txt.startswith('Содержание'):
                        mark = 'content'
                    elif txt.startswith('Тематика практических'):
                        mark = 'labs'
                    elif txt.startswith('Самостоятельная'):
                        mark = 'sr'
                    elif txt and mark == 'content':
                        theme['content'].append(txt)
                    continue
                if first.startswith('В том числе') and 'практическ' in first.lower():
                    pool = [norm(z) for z in c0[1:] if norm(z)]
            if not pool:
                sys.exit('Не найден общий перечень практических работ («В том числе, практических/лабораторных работ …»)')
            if not labs_arg:
                sys.exit('Практические работы в ПООП СПО — общий список (%d). Укажите --labs "номер темы=диапазон", например --labs "2=1-6,3=7-10"' % len(pool))
            used = set()
            for item in labs_arg.split(','):
                tnum, rng = item.split('=')
                a, _, b = rng.partition('-')
                lo, hi = int(a), int(b or a)
                th = next((t for t in sec['themes'] if re.fullmatch(rf'Тема\s*{re.escape(tnum.strip())}\.?', t['num'])), None)
                if th is None:
                    sys.exit(f'--labs: нет темы {tnum}')
                for n in range(lo, hi + 1):
                    th['labs'].append({'n': n, 'title': pool[n - 1]})
                    used.add(n)
            if used != set(range(1, len(pool) + 1)):
                sys.exit(f'--labs: работы {sorted(set(range(1, len(pool) + 1)) - used)} не отнесены ни к одной теме')
            out['_labs_pool'] = len(pool)
            continue
    out.pop('_labs_pool', None)
    sec = out['sections'][0] if out['sections'] else None
    if sec:
        sec['hours'] = out['hours'].get('Объем образовательной программы', 0)
    contents = [c for t in (sec['themes'] if sec else []) for c in t['content']]
    dups = sorted({c for c in contents if contents.count(c) > 1})
    out['_notes'].append('ПООП СПО: в тематическом плане нет разделов (только «Тема N.»), нет цели дисциплины и вводного абзаца к таблице результатов; 1.1 — абзац «Место дисциплины…» без номера пункта; одна строка таблицы результатов относится ко всем кодам (диапазоны ОК/ПК раскрыты).')
    out['_notes'].append('Практические работы ПООП СПО — общий перечень в конце таблицы («В том числе, практических/лабораторных работ (примерная тематика)»); к темам отнесены по порядку изложения: ' + labs_arg + '. Номера работ присвоены по порядку списка.')
    if dups:
        out['_notes'].append('В содержании тем ПООП есть повторяющиеся строки (' + '; '.join(dups) + ') — оставлены как в источнике.')
    if ok_map:
        out['_notes'].append('Коды ОК ПООП (ФГОС 2016, ОК 01–11) приведены к ФГОС группы (приказ № 519 от 10.07.2023, ОК 01–09) по смыслу: ' + '; '.join(f'{a} → {b}' for a, b in ok_map.items()) + '. Исходная запись кодов — в "codes_poop". Коды ПК взяты как в ПООП; их наименования в РП — по ФГОС группы.')
    out['_notes'].extend(notes)
    out['_notes'].append('Часы ПООП (36 ч: 20 теория + 14 практика + 2 аттестация) в РП не используются — часы по учебному плану группы и поручению.')
    out['_notes'].append('Раздел 4 ПООП: критерии «Отлично…Неудовлетворительно» и формы оценки — по строкам таблицы «Перечень знаний/умений»; в ПООП они повторены для строки-заголовка и строки перечня — перенесены один раз.')
    out['_notes'].append('Литература ПООП: один печатный источник; электронных и дополнительных источников в ПООП нет.')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'Записано: {out_path} (ПООП СПО, приложение {app})')
    for s_ in out['sections']:
        print(f"  тем {len(s_['themes'])}, практических {sum(len(t['labs']) for t in s_['themes'])}")
    print(f"  результатов: ОК {len(out['results']['ok'])}, ПК {len(out['results']['pk'])}; строк оценки {len(out['assessment'])}; помещений {len(out['rooms'])}; литература {len(out['literature_main'])}+{len(out['literature_add'])}")


def main():
    global PER_PARA
    if '--item-per-paragraph' in sys.argv:
        PER_PARA = True
        sys.argv.remove('--item-per-paragraph')
    labs_arg = None
    ok_map = None
    notes = []
    while '--note' in sys.argv:  # дополнительная запись в _notes (например, причина замены прежнего файла)
        i = sys.argv.index('--note')
        notes.append(sys.argv[i + 1])
        del sys.argv[i:i + 2]
    if '--ok-map' in sys.argv:  # «ОК 09=ОК 02,ОК 10=ОК 09»: коды ОК ПООП, которых нет во ФГОС группы
        i = sys.argv.index('--ok-map')
        ok_map = dict(x.split('=') for x in sys.argv[i + 1].split(','))
        del sys.argv[i:i + 2]
    if '--labs' in sys.argv:
        i = sys.argv.index('--labs')
        labs_arg = sys.argv[i + 1]
        del sys.argv[i:i + 2]
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    src, app, code, out_path = sys.argv[1:5]
    if app.startswith('II'):
        return extract_spo(src, app, code, out_path, labs_arg, ok_map, notes)
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
            elif start is not None and re.fullmatch(r'Приложение (?:\d+|II)(\.\d+)?', t):
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
            elif mode in ('lit_main', 'lit_add') and (re.match(r'^\d+\.\s', t) or len(t) > 60):
                # список может быть без нумерации (ПООП «Профессионалитет») — тогда пункт — абзац целиком
                out['literature_main' if mode == 'lit_main' else 'literature_add'].append(strip_num(t) if re.match(r'^\d+\.\s', t) else t)
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
                cds = [code_norm(z) for z in re.split(r'[,;]', ' '.join(c0 or []))]
                cds = [z for z in cds if z]
                if not cds:
                    continue
                vals = [items(col(r, j) or []) for j in (1, 2, 3)]
                if len(cds) > 1:  # одна строка таблицы на несколько кодов: результаты общие для всех кодов строки
                    out['results_shared'] = True
                for cd in cds:
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
            in_labs = False
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
                    in_labs = False
                elif c0:
                    continue
                if theme is None:
                    continue
                if rest and rest[0].startswith('В том числе самостоятельная'):
                    in_labs = False
                    continue
                if rest and rest[0].startswith('В том числе практических'):
                    in_labs = True
                    continue
                if rest and rest[0].startswith('Содержание'):
                    in_labs = False
                if in_labs and rest and not re.match(r'^(Лабораторн\w*|Практическ\w*)\s+(работ\w*|заняти\w*)\s*№', rest[0]):
                    # практическое занятие без номера в ПОП: номер — по порядку следования
                    n_lab = 1 + sum(len(t['labs']) for sct in out['sections'] for t in sct['themes'])
                    theme['labs'].append({'n': n_lab, 'title': rest[0].strip()})
                    out['_numbered_by_order'] = True
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
    if out.pop('_numbered_by_order', False):
        out['_notes'].append('В ПОП практические и лабораторные занятия не пронумерованы — номера в JSON присвоены по порядку следования в тематическом плане (1, 2, 3 …); в рабочей программе номера практических работ сквозные по занятиям.')
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
