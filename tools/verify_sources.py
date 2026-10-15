#!/usr/bin/env python3
"""Сверка JSON ПОП / ФГОС / программы воспитания с исходным документом: всё, что должно быть дословным, есть в исходнике.

Использование:
  python3 tools/verify_sources.py data/pop/КОД_ПМ0N.json ПОП.txt [ещё_исходник ...] [--plan data/plans/ГРУППА.tsv] [--fgos data/fgos/КОД.json]
                                  [--cover t057r05 t057r129]
  python3 tools/verify_sources.py data/fgos/КОД.json ФГОС.pdf [ПОП.docx]
  python3 tools/verify_sources.py data/vospitanie/ФАЙЛ.json программа_воспитания.docx

Что проверяется:
  1. Каждая строка JSON (темы, содержание, работы, виды работ, результаты, критерии, помещения, литература, ОК, ПК, ЛР)
     встречается в исходнике. Сравнение терпимо только к оформлению: пробелы, кавычки, тире, «ё/е», мягкие переносы,
     регистр первой буквы, знак конца строки (; . ,). Пересказ, сокращение, «улучшение» формулировки — ошибка.
  2. Структура ПОП: номера тем в разделе идут по порядку, номера работ без пропусков и повторов,
     у каждого раздела есть код МДК, ПК из критериев и результатов есть в ФГОС (если передан --fgos),
     коды МДК есть в учебном плане (если передан --plan).
  3. Полнота (--cover ОТ ДО, можно повторить для каждого фрагмента ПОП): каждая ячейка тематического плана ПОП между строками ОТ и ДО (номера строк из
     tools/doc2text.py, например "t057 r05" "t057 r129" или p00412 p00470) есть в JSON. Так ловятся потерянные
     темы, строки содержания и работы. Служебные ячейки (часы, «Содержание», «В том числе…») пропускаются.
Выход: код 0 — расхождений нет; 1 — есть (печатается путь в JSON и текст).
Исходники — .docx/.doc/.pdf/.odt/.rtf или .txt из tools/doc2text.py.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from doc2text import read_lines  # noqa: E402

# поля, которые не обязаны дословно встречаться в исходнике (служебные или собранные программой)
SKIP_KEYS = {'_source', '_comment', '_notes', '_ack', '_corrections', '_cover', '_source_doc', '_excluded', 'format', 'qualification', 'pm', 'specialty', 'vd', 'mdk', 'num', 'n', 'mdk_title_pop',
             'vd_name', 'results_intro', 'source_url', 'ok_source', 'ok_results_source', 'order', 'order_by', 'order_date', 'minjust', 'code',
             'professional_area', 'professional_standards', 'title', 'source_table', 'ok_lr', 'ok_lr_module', 'hours',
             'course_hours', 'name_short', 'qualification_short'}
# ключи, внутри которых title — дословный (название лабораторной работы)
VERBATIM_TITLE_PARENTS = {'labs'}


def norm(s):
    s = str(s).replace('­', '').replace(' ', ' ').replace('ё', 'е').replace('Ё', 'Е')
    s = re.sub(r'[«»“”„"\'‘’`]', '"', s)
    s = re.sub(r'[‐‑‒–—―−-]', '-', s)
    s = re.sub(r'\s*-\s*', '-', s)
    s = re.sub(r'\s*"\s*', '"', s)
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'\s*([.,;:!?()])\s*', r'\1', s)
    return s.strip().lower()


def strip_tail(s):
    return re.sub(r'[\s.;,:]+$', '', s)


def source_text(paths):
    parts = []
    for p in paths:
        for line in read_lines(p):
            line = re.sub(r'^\[[pt]\d+(?: r\d+)?\]\s*', '', line)
            parts.append(line.replace(' | ', ' '))
    return norm(' '.join(parts))


def walk(x, path, out, parent_key=None):
    if isinstance(x, dict):
        for k, v in x.items():
            if k in SKIP_KEYS and not (k == 'title' and parent_key in VERBATIM_TITLE_PARENTS):
                continue
            walk(v, f'{path}.{k}', out, parent_key=k if isinstance(v, list) else parent_key)
    elif isinstance(x, list):
        # пары [код, текст] (ОК, ПК) — проверяется текст
        if len(x) == 2 and all(isinstance(i, str) for i in x) and re.match(r'^(ОК|ПК|ЛР)\s*\d', x[0]):
            out.append((f'{path}[1]', x[1]))
            return
        for i, v in enumerate(x):
            walk(v, f'{path}[{i}]', out, parent_key=parent_key)
    elif isinstance(x, str):
        out.append((path, x))


def found(s, src, fixes=()):
    n = strip_tail(norm(s))
    if len(n) < 4 or n in src:
        return True
    for was, now in fixes:  # задокументированная правка опечатки ПОП: в исходнике было was, в JSON стало now
        a, b = strip_tail(norm(now)), strip_tail(norm(was))
        if a in n and n.replace(a, b) in src:
            return True
    # длинные абзацы: допускается, что программа разбила их по «;» — проверяем каждую часть
    pieces = [p for p in re.split(r'[;]', n) if len(p.strip()) > 3]
    return len(pieces) > 1 and all(strip_tail(p.strip()) in src for p in pieces)


def structure_checks(d, fgos, plan_codes):
    errs = []
    ack = set(d.get('_ack', []))

    def W(key, msg):  # особенность, которая бывает в самой ПОП: подтверждается ключом в _ack после сверки с исходником
        if key not in ack:
            errs.append(f'{msg}. Сверь с исходником; если так в ПОП — добавь в "_ack" строку "{key}" и поясни в "_notes"')
    for si, s in enumerate(d.get('sections', [])):
        where = f'sections[{si}] «{s.get("section", "")[:60]}»'
        if not s.get('mdk'):
            errs.append(f'{where}: нет кода МДК (mdk)')
        elif plan_codes and s['mdk'] not in plan_codes:
            errs.append(f'{where}: {s["mdk"]} нет в учебном плане (есть: {", ".join(sorted(plan_codes))})')
        prev = None
        for ti, t in enumerate(s.get('themes', [])):
            if not t.get('name') or not t.get('content'):
                errs.append(f'{where}.themes[{ti}] {t.get("num")}: пустое название или содержание')
            m = re.search(r'(\d+)\.(\d+)(?:\.(\d+))?', t.get('num', ''))
            if m:
                key = tuple(int(g) for g in m.groups() if g)
                if prev and key <= prev:
                    W(f'themes:{t["num"]}', f'{where}: номер {t["num"]} не больше предыдущего (повтор или пропуск темы?)')
                prev = key
    labs = [l.get('n') for s in d.get('sections', []) for t in s.get('themes', []) for l in t.get('labs', [])]
    by_mdk = {}
    for s in d.get('sections', []):
        by_mdk.setdefault(s.get('mdk'), []).extend(l.get('n') for t in s.get('themes', []) for l in t.get('labs', []))
    for mdk, ns in by_mdk.items():
        ns = [x for x in ns if isinstance(x, int)]
        if ns and sorted(ns) != list(range(min(ns), min(ns) + len(ns))):
            W(f'labs:{mdk}', f'{mdk}: номера лабораторных/практических работ с пропусками или повторами: {ns}')
    if fgos:
        pk = {k for k, _ in fgos.get('pk', [])} | {k for m in fgos.get('modules', []) for k, _ in m.get('pk', [])}
        okc = {k for k, _ in fgos.get('ok', [])}
        known = pk | okc
        for k in dict.fromkeys(list(d.get('criteria', {}).keys()) + list((d.get('results') or {}).get('pk', {}).keys())):
            kk = re.sub(r'^(ОК|ПК)\.?\s*', lambda m: m.group(1) + ' ', k)
            if known and kk not in known and not kk.startswith('ОК'):
                errs.append(f'код {k} из ПОП нет во ФГОС')
    if not labs and d.get('sections'):
        W('labs:none', 'ни одной лабораторной/практической работы (пропущены строки «Лабораторная/Практическая работа»?)')
    return errs


def fgos_checks(d):
    errs = []
    for k in ('code', 'name', 'qualification', 'order_by', 'order_date', 'minjust'):
        if not d.get(k):
            errs.append(f'нет поля {k}')
    ok = [k for k, _ in d.get('ok', [])]
    if ok != [f'ОК {i:02d}' for i in range(1, len(ok) + 1)]:
        errs.append(f'ОК должны идти ОК 01, ОК 02, … без пропусков: {ok}')
    if d.get('minjust') and not re.search(r'№\s*\d+', d['minjust']):
        errs.append('minjust: нужен регистрационный номер (… регистрационный № 12345)')
    for m in d.get('modules', []):
        n = re.sub(r'\D', '', m.get('pm', '')).lstrip('0')
        if not m.get('name') or not m.get('pk'):
            errs.append(f'{m.get("pm")}: нет названия вида деятельности или ПК')
        for k, _ in m.get('pk', []):
            if not re.match(rf'^ПК {n}\.\d+$', k):
                errs.append(f'{m.get("pm")}: код {k} не в формате «ПК {n}.N»')
    return errs


COVER_IGNORE = re.compile(r'^(дополнительно для квалификаци.*|\d+([.,]\d+)?|\*|содержание.*|в том числе.*|тематика.*|самостоятельная.*|всего.*|'
                          r'промежуточная.*|учебная практика.*|производственная практика.*|виды работ.*|курсов.*|наименование.*|'
                          r'уровень.*|объем.*|коды.*|раздел модуля \d+.*|(ок|пк)\.?\s*\d+(\.\d+)?(\s*[-–]\s*(ок|пк)?\.?\s*\d+(\.\d+)?)?\.?|раздел \d+\.?|тема \d+(\.\d+)*\.?|мдк\.?\s*\d+\.\d+\.?)$')


def all_strings(x, out):
    if isinstance(x, dict):
        for v in x.values():
            all_strings(v, out)
    elif isinstance(x, list):
        for v in x:
            all_strings(v, out)
    elif isinstance(x, str):
        out.append(x)
    return out


CODE_NAME = re.compile(r'^(ок|пк)\.?\s*\d+(\.\d+)?\.?\s*\S')  # «ОК 08. Использовать…» — код с названием (из ФГОС)
QBLOCK = re.compile(r'(?:дополнительно\s+)?для\s+квалификаци[ийя]\s*[«"]?[^»":]*[»"]?\s*(?:и\s*[«"][^»"]*[»"]\s*)?:?', re.I)


def pieces(cell):
    """Части многострочной ячейки: пункты списка, оценки, блоки квалификаций (заголовок блока отбрасывается)."""
    t = re.sub(r'(?=Оценка\s*«)', '\n', cell)
    t = QBLOCK.sub('\n', t)
    t = re.sub(r'(?:^|\s)[-–•]\s+', '\n', t)
    return [x.strip(' ;') for x in t.split('\n') if x.strip(' ;')]


def coverage(src_paths, data, start, end):
    """Обратная проверка полноты: каждая ячейка/абзац тематического плана ПОП (от start до end включительно)
    должна оказаться в JSON. Служебные ячейки (часы, «Содержание», «В том числе…») пропускаются."""
    J = norm(' '.join(all_strings(data, [])))
    EX = [strip_tail(norm(x)) for x in data.get('_excluded', [])]  # не переносится намеренно (другая квалификация)
    miss = []
    for p in src_paths:
        lines = read_lines(p)
        ids = [(re.match(r'^\[([pt]\d+(?: r\d+)?)\]', l) or [None, None])[1] for l in lines]
        if start not in ids or end not in ids:
            continue
        where = start
        for l in lines[ids.index(start):ids.index(end) + 1]:
            m = re.match(r'^\[([^\]]*)\]\s*', l)
            if m:
                where = m.group(1)
            t = l[m.end():] if m else l  # строка без номера — продолжение многострочной ячейки
            for cell in dict.fromkeys(re.split(r'\s*\|\s*', t)):
                n = strip_tail(norm(re.sub(r'\(\s*\d+\s*час\w*\s*\)', '', cell)))
                for c in data.get('_corrections', []):  # задокументированные исправления склеек и опечаток
                    n = n.replace(strip_tail(norm(c['was'])), strip_tail(norm(c['now'])))
                if 'виды работ' in n:  # «Учебная практика … Виды работ: 1. …; 2. …» — каждый вид работ отдельно
                    key = 'pp_works' if n.startswith('производств') else 'up_works' if n.startswith('учебн') else None
                    L = [strip_tail(norm(x)) for x in data.get(key, [])] if key else None
                    inL = (lambda x: any(x == y or x in y for y in L)) if L is not None else (lambda x: x in J)
                    for it in re.split(r';|(?<=[.:])\s*\d+\.(?=\D)', n.split('виды работ', 1)[1]):
                        it = strip_tail(re.sub(r'^[\s:\-]*\d+\.', '', it).strip(' :-'))
                        if len(it) < 4 or inL(it):
                            continue
                        # без нумерации виды работ бывают разделены точкой: «… доступа.оформление …»
                        for sub in re.split(r'\.(?=[а-яa-z])', it):
                            sub = strip_tail(sub)
                            if len(sub) > 3 and not inL(sub):
                                miss.append((f'[{where}]', f'вид работ ({key or "?"}): ' + sub))
                    continue
                if len(n) < 4 or COVER_IGNORE.match(n) or n in J:
                    continue
                n2 = re.sub(r'^(тема|раздел|мдк)\.?\s*[\d.]+\s*', '', n)
                n2 = strip_tail(re.sub(r'^(лабораторн\w*|практическ\w*)\s+(работ\w*|заняти\w*)\s*(№\s*\d+)?[.:]?\s*', '', n2).strip('"'))
                if len(n2) < 4 or n2 in J or found(n2, J) or CODE_NAME.match(n2):
                    continue
                # многострочная ячейка (критерии, методы): проверяем по частям — пункты «- …», «Оценка …»,
                # блоки другой квалификации («Для квалификации «X»: …» / «Дополнительно для квалификации "X": …»)
                for piece in pieces(cell):
                    pn = strip_tail(norm(piece))
                    for e in EX:
                        pn = pn.replace(e, '|')
                    for part in pn.split('|'):
                        part = strip_tail(part.strip())
                        if len(part) < 4 or COVER_IGNORE.match(part) or part in J or found(part, J) or any(part in e for e in EX):
                            continue
                        miss.append((f'[{where}]', piece))
                        break
        return miss
    sys.exit(f'--cover: не найдены строки {start} / {end} в исходнике (номера — из tools/doc2text.py)')


def plan_mdk_codes(path):
    codes = set()
    for line in open(path, encoding='utf-8'):
        c = line.split('\t')[0].strip()
        if c.startswith('МДК'):
            codes.add(c)
    return codes


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        sys.exit(__doc__)
    opt = {}
    covers = []
    while '--cover' in a:  # можно несколько: тематический план, виды работ практик, таблица результатов …
        i = a.index('--cover'); covers.append((a[i + 1], a[i + 2])); del a[i:i + 3]
    for k in ('--plan', '--fgos'):
        if k in a:
            i = a.index(k); opt[k] = a[i + 1]; del a[i:i + 2]
    data = json.load(open(a[0], encoding='utf-8'))
    if not covers and data.get('_cover'):  # диапазоны полноты, записанные в JSON при извлечении
        covers = [tuple(x) for x in data['_cover']]
    src = source_text(a[1:])
    items = []
    walk(data, '$', items)
    fixes = [(c['was'], c['now']) for c in data.get('_corrections', [])]
    for c in data.get('_corrections', []):
        if strip_tail(norm(c['was'])) not in src:
            print(f'НЕТ В ИСХОДНИКЕ _corrections.was: {c["was"][:160]}')
            items.append(('_corrections', c['was']))
    items += [('_excluded', x) for x in data.get('_excluded', [])]  # исключённое тоже должно быть в исходнике
    miss = [(p, s) for p, s in items if not found(s, src, fixes)]
    for p, s in miss:
        print(f'НЕТ В ИСХОДНИКЕ {p}: {s[:160]}')
    errs = []
    if 'sections' in data:
        fgos = json.load(open(opt['--fgos'], encoding='utf-8')) if '--fgos' in opt else None
        errs = structure_checks(data, fgos, plan_mdk_codes(opt['--plan']) if '--plan' in opt else None)
        for e in errs:
            print('СТРУКТУРА: ' + e)
    for cover in covers:
        cm = coverage(a[1:], data, *cover)
        for where, cell in cm:
            print(f'НЕ ПЕРЕНЕСЕНО {where}: {cell[:160]}')
        errs += [f'не перенесено {w}' for w, _ in cm]
    if 'modules' in data:
        e2 = fgos_checks(data)
        for e in e2:
            print('СТРУКТУРА ФГОС: ' + e)
        errs += e2
    print(f'Проверено строк: {len(items)}; не найдено в исходнике: {len(miss)}; замечаний к структуре: {len(errs)}')
    sys.exit(1 if miss or errs else 0)


if __name__ == '__main__':
    main()
