#!/usr/bin/env python3
"""ПОП-УД + учебный план → черновик КТП (data/ktp/….json) для дисциплины, когда КТП преподавателя нет.

Использование:
  python3 -I tools/ktp_from_pop.py data/pop/10.02.05_OP01.json data/plans/OZ-2501_OP01.tsv ОП.01 data/ktp/OZ-2501_OP01.json [--spec spec.json]

Формат результата — как у tools/ktp_from_xlsx.py (sections[].themes[].lessons[]{n,t,h,k,vid}), плюс признак "_generated": true.
Что берётся из ПОП: разделы, темы (номер и название), практические и лабораторные работы (названия дословно).
Что составляется программой/автором, а не берётся из документа преподавателя: число пар по темам и работам, названия теоретических занятий.
  Без --spec: теоретические пары распределяются по темам пропорционально числу пунктов содержания, пары практических — поровну между работами,
  названия теоретических занятий — предложения содержания темы по кругу.
  --spec: {"theory": {"Тема 1.1.": ["название занятия", …], …}, "works": {"1": 2, "2": 2, …}}  — названия занятий и пары на работу (по номеру работы ПОП);
  суммы пар проверяются по плану (теория/практика), числа теорий по темам задают число пар.
  --spec с ключом "lessons" (ПООП СПО: темы и работы — ПООП, названия занятий — по возможности из КТП преподавателя):
    {"teacher_ktp": "data/ktp/ГРУППА_УД_teacher.json", "lessons": {"Тема 1.": [
        {"k": "T", "ktp": 1, "covers": ["пункты содержания ПООП, которые занятие охватывает (дословно)"]},   # название — из КТП преподавателя по номеру занятия
        {"k": "T", "t": "фрагменты содержания ПООП через «; »"},                                             # название — из ПООП
        {"k": "P", "work": 1, "ktp": 11},                                      # пара 2 ч: «Название работы ПООП: название занятия КТП»
        {"k": "P", "work": 4, "pairs": 3}                                       # работа ПООП без аналога в КТП: pairs пар, сборка делит на «(часть k)»
    ]}}
  Занятия, взятые из КТП, получают "src": "ktp", "ktp_n" (номер в КТП) и "covers"; суммы часов теории и практики проверяются по плану,
  каждая работа ПООП должна встретиться в своей теме. Файл помечается "_generated": true (часть названий — из ПООП, порядок и число пар — наши).
Практическая работа на несколько пар записывается одним занятием h = 2·пар: сборка сама делит её на пары «(часть 1)», «(часть 2)».
Последняя пара ДЗ/З — в сборке (src/sequence.js); экзамен (Э) в часы занятий не входит.
Признак "_generated" заставляет init и COMPLETENESS.md отметить: КТП преподавателя отсутствует — занятия составлены нами, заменить при получении КТП.
"""
import json
import re
import sys


def distribute(total, weights):
    n = len(weights)
    res = [1] * n
    rest = total - n
    W = sum(weights) or n
    raw = [w / W * rest for w in weights]
    for i, x in enumerate(raw):
        res[i] += int(x)
    left = total - sum(res)
    for _, i in sorted(((x - int(x), i) for i, x in enumerate(raw)), key=lambda z: -z[0]):
        if left > 0:
            res[i] += 1
            left -= 1
    return res


def plan_row(path, code):
    for line in open(path, encoding='utf-8'):
        c = [x.strip() for x in line.rstrip('\n').split('\t')]
        if c[0].rstrip('.') == code:
            return c
    sys.exit(f'В плане нет {code}')


def build_explicit(pop, row, th_h, pr_h, themes, spec, out_p, plan_p, pop_p):
    teacher = {}
    if spec.get('teacher_ktp'):
        tk = json.load(open(spec['teacher_ktp'], encoding='utf-8'))
        teacher = {l['n']: l for sec in tk['sections'] for t in sec['themes'] for l in t['lessons']}
    out = {'_source': f'КТП составлена по ПООП ({pop_p}) и плану ({plan_p}); названия занятий взяты из КТП преподавателя ({spec.get("teacher_ktp")}) там, где тема совпадает с темой ПООП, иначе из ПООП; порядок и число пар — наши',
           '_generated': True, 'title': row[1], 'sections': []}
    n = 0
    used_works, used_ktp, errs = [], [], []
    for s in pop['sections']:
        m = re.match(r'^(Раздел\s*\d+)', s['section'])
        sec = {'num': (m.group(1) + '.') if m else '', 'name': s['section'], 'hours': 0, 'themes': []}
        for t in s['themes']:
            spec_l = spec['lessons'].get(t['num'])
            if not spec_l:
                errs.append(f'в spec нет занятий темы {t["num"]}')
                continue
            labs = {l['n']: l for l in t['labs']}
            ls = []
            for it in spec_l:
                n += 1
                k = it['k']
                tl = teacher.get(it['ktp']) if it.get('ktp') else None
                if it.get('ktp'):
                    if tl is None:
                        errs.append(f'в КТП преподавателя нет занятия {it["ktp"]}')
                        continue
                    if tl['k'] != k:
                        errs.append(f'занятие КТП {it["ktp"]} — {tl["k"]}, в spec — {k}')
                    used_ktp.append(it['ktp'])
                if k == 'T':
                    rec = {'n': n, 't': tl['t'] if tl else it['t'], 'h': 2, 'k': 'T', 'vid': 'Лекция', 'materials': '-', 'homework': '-'}
                else:
                    w = labs.get(it['work'])
                    if w is None:
                        errs.append(f'работа {it["work"]} не относится к теме {t["num"]}')
                        continue
                    used_works.append(it['work'])
                    title = w['title'].rstrip('.')
                    rec = {'n': n, 't': f'{title}: {tl["t"]}' if tl else title, 'h': 2 * it.get('pairs', 1), 'k': 'P', 'vid': 'Практ. работа', 'materials': '-', 'homework': tl.get('homework', '-') if tl else '-'}
                if tl:
                    rec['src'] = 'ktp'
                    rec['ktp_n'] = it['ktp']
                    rec['materials'] = tl.get('materials', '-')
                    if tl.get('homework') and k == 'T':
                        rec['homework'] = tl['homework']
                if it.get('covers'):
                    rec['covers'] = it['covers']
                ls.append(rec)
            th = {'num': t['num'], 'name': t['name'], 'hours': sum(l['h'] for l in ls), 'lessons': ls}
            sec['themes'].append(th)
            sec['hours'] += th['hours']
        out['sections'].append(sec)
    all_labs = [l['n'] for _, t in themes for l in t['labs']]
    for w in all_labs:
        if w not in used_works:
            errs.append(f'работа ПООП № {w} не вошла в КТП')
    if len(used_ktp) != len(set(used_ktp)):
        errs.append('занятие КТП преподавателя использовано дважды')
    T = sum(l['h'] for sec in out['sections'] for t in sec['themes'] for l in t['lessons'] if l['k'] == 'T')
    P = sum(l['h'] for sec in out['sections'] for t in sec['themes'] for l in t['lessons'] if l['k'] == 'P')
    if T != th_h:
        errs.append(f'Теория: {T} ч, по плану {th_h} ч')
    if P != pr_h:
        errs.append(f'Практика: {P} ч, по плану {pr_h} ч')
    if errs:
        sys.exit('\n'.join(errs))
    out['hours'] = T + P
    out['lessons_count'] = out['hours'] // 2
    out['theory_hours'] = th_h
    out['practice_hours'] = pr_h
    out['ktp_used'] = sorted(used_ktp)
    out['ktp_unused'] = sorted(set(teacher) - set(used_ktp))
    json.dump(out, open(out_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'Записано: {out_p}: тем {len(themes)}, часов {out["hours"]} (теория {T}, практика {P}); занятий КТП преподавателя использовано {len(used_ktp)} из {len(teacher)}')


def main():
    a = sys.argv[1:]
    spec = {}
    if '--spec' in a:
        i = a.index('--spec')
        spec = json.load(open(a[i + 1], encoding='utf-8'))
        del a[i:i + 2]
    if len(a) != 4:
        sys.exit(__doc__)
    pop_p, plan_p, code, out_p = a
    pop = json.load(open(pop_p, encoding='utf-8'))
    row = plan_row(plan_p, code)
    th_h, pr_h = int(float(row[6])), int(float(row[7]))
    themes = [(s, t) for s in pop['sections'] for t in s['themes']]
    if spec.get('lessons'):
        return build_explicit(pop, row, th_h, pr_h, themes, spec, out_p, plan_p, pop_p)
    # теория
    if spec.get('theory'):
        titles = {t['num']: spec['theory'][t['num']] for _, t in themes}
        counts = [len(titles[t['num']]) for _, t in themes]
    else:
        counts = distribute(th_h // 2, [len(t['content']) for _, t in themes])
        titles = {}
        for (s, t), c in zip(themes, counts):
            sent = [x.strip() for it in t['content'] for x in re.split(r'(?<=[.!?])\s+', it) if x.strip()]
            titles[t['num']] = [sent[i % len(sent)].rstrip('.') for i in range(c)]
    if sum(counts) * 2 != th_h:
        sys.exit(f'Теория: {sum(counts) * 2} ч, по плану {th_h} ч')
    # практика
    labs = [l for _, t in themes for l in t['labs']]
    if spec.get('works'):
        pairs = {l['n']: int(spec['works'][str(l['n'])]) for l in labs}
    else:
        pairs = dict(zip([l['n'] for l in labs], distribute(pr_h // 2, [1] * len(labs))))
    if sum(pairs.values()) * 2 != pr_h:
        sys.exit(f'Практика: {sum(pairs.values()) * 2} ч, по плану {pr_h} ч')
    out = {'_source': f'Черновик КТП: составлен по ПОП ({pop_p}) и плану ({plan_p}); КТП преподавателя отсутствует — заменить при получении КТП',
           '_generated': True, 'title': row[1], 'sections': []}
    n = 0
    for s in pop['sections']:
        sec = {'num': (re.match(r'^(Раздел\s*\d+)', s['section']).group(1) + '.'), 'name': s['section'], 'hours': 0, 'themes': []}
        for t in s['themes']:
            T = titles[t['num']]
            W = t['labs']
            pos = [-(-((j + 1) * len(T)) // len(W)) for j in range(len(W))] if T and W else []
            ls = []
            def add(k, title, h, vid):
                nonlocal n
                n += 1
                ls.append({'n': n, 't': title, 'h': h, 'k': k, 'vid': vid, 'materials': '-', 'homework': '-'})
            for i, ttl in enumerate(T):
                add('T', ttl, 2, 'Лекция')
                for j, w in enumerate(W):
                    if pos[j] == i + 1:
                        add('P', w['title'].rstrip('.'), 2 * pairs[w['n']], 'Практ. работа')
            if not T:
                for w in W:
                    add('P', w['title'].rstrip('.'), 2 * pairs[w['n']], 'Практ. работа')
            th = {'num': t['num'], 'name': t['name'], 'hours': sum(l['h'] for l in ls), 'lessons': ls}
            sec['themes'].append(th)
            sec['hours'] += th['hours']
        out['sections'].append(sec)
    out['hours'] = sum(s['hours'] for s in out['sections'])
    out['lessons_count'] = out['hours'] // 2
    out['theory_hours'] = th_h
    out['practice_hours'] = pr_h
    json.dump(out, open(out_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'Записано: {out_p}: разделов {len(out["sections"])}, тем {len(themes)}, часов {out["hours"]} (теория {th_h}, практика {pr_h}); КТП составлен по ПОП (_generated)')


if __name__ == '__main__':
    main()
