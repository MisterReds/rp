// Этапы наполнения учебной дисциплины (project.json: "kind": "ud"). Каждый этап: свой промпт (prompts/ud_*.md),
// своя проверка ответа и место в content.json. Часы, семестры, занятия и их порядок — из плана и КТП; нейросеть их не меняет.
// Этапы: codes (ОК/ПК по темам) → program (оснащение, ПО, методы ЛР) → tests:КОД:1…3 → exam:КОД:1…3 [→ cw:КОД, если форма ДР/КР].
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCodes, FOS_MIN, FOS_PART } = require('./validate.js');
const { examKeysUd } = require('./validate_ud.js');
const { FORM_NAMES } = require('./plan.js');
const Q = require('../tools/lint_content.js');

const PROMPTS = path.join(__dirname, '..', 'prompts');
const tpl = (name, vars) => fs.readFileSync(path.join(PROMPTS, name + '.md'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
const nonEmpty = s => typeof s === 'string' && s.trim().length > 0;

function contextBlockUd(ctx) {
  const { fgos, content: c, project: pj } = ctx;
  const u = c.ud;
  const lines = [
    `Специальность: ${fgos.code} ${fgos.name}. Квалификация: ${fgos.qualification}.`,
    `Учебная дисциплина: ${u.code} «${u.name}», объём ${c.meta.total_hours} ч (теория ${u.T} ч, практика ${u.P} ч), группа ${pj.group}, форма обучения ${pj.form}.`,
    'Семестры: ' + u.sems.map(s => `${s.label} — ${s.hours} ч${s.form ? ` (${FORM_NAMES[s.form] || s.form})` : ''}`).join('; ') + '.',
    'Общие компетенции дисциплины (из ПОП): ' + fgos.ok.filter(x => c.meta.ok.includes(x[0])).map(([k, n]) => `${k} — ${n}`).join('; '),
    'Профессиональные компетенции дисциплины (из ПОП): ' + (c.meta.pk.map(([k, n]) => `${k} — ${n}`).join('; ') || 'нет'),
    'Темы и занятия дисциплины по КТП преподавателя:',
    ...u.themes.map((t, i) => `${i + 1}) ${t.num} ${t.name}: ` + t.lessons.map(l => `${l.k === 'P' ? '[практ.] ' : ''}${l.t}`).join(' / ')),
  ];
  const h = pj.hints || {};
  if (h.general) lines.push(`Пожелания преподавателя: ${h.general}`);
  return lines.join('\n');
}

function listStagesUd(ctx) {
  const c = ctx.content, u = c.ud;
  const okList = c.meta.ok, pkList = c.meta.pk.map(x => x[0]);
  const vars0 = { context: contextBlockUd(ctx), code: u.code, name: u.name };
  const S = [];
  const themeLine = (t, i) => `${i + 1}) ${t.num} ${t.name} (${t.lessons.map(l => l.t).join('; ')})`;

  S.push({
    id: 'codes', title: `Коды ОК и ПК по темам ${u.code}`,
    prompt: () => tpl('ud_codes', { ...vars0, ok_codes: okList.join(', '), pk_codes: pkList.join(', ') || 'нет', themes: u.themes.map(themeLine).join('\n') }),
    check: d => {
      const e = [];
      if (!Array.isArray(d.themes) || d.themes.length !== u.themes.length) return [`нужно ровно ${u.themes.length} тем в порядке КТП`];
      d.themes.forEach((th, i) => {
        const w = `${u.themes[i].num} ${u.themes[i].name}`;
        const x = parseCodes(th.codes);
        if (!x.ok.length) e.push(`${w}: в codes нет ОК (допустимы ${okList.join(', ')})`);
        x.ok.forEach(k => { if (!okList.includes(k)) e.push(`${w}: ${k} не входит в ОК дисциплины (допустимы ${okList.join(', ')})`); });
        x.pk.forEach(k => { if (!pkList.includes(k)) e.push(`${w}: ${k} не относится к дисциплине (допустимы ${pkList.join(', ') || 'никакие'})`); });
      });
      pkList.forEach(k => { if (!d.themes.some(th => parseCodes(th.codes).pk.includes(k))) e.push(`${k} должна встретиться хотя бы в одной теме`); });
      okList.forEach(k => { if (!d.themes.some(th => parseCodes(th.codes).ok.includes(k))) e.push(`${k} должна встретиться хотя бы в одной теме`); });
      return e;
    },
    apply: d => { d.themes.forEach((th, i) => { u.themes[i].codes = th.codes; }); },
  });

  S.push({
    id: 'program', title: 'Оснащение, ПО, формы контроля и методы формирования ЛР',
    prompt: () => tpl('ud_program', { ...vars0, ok_codes: okList.join(', '), ok_last: okList[okList.length - 1], works: u.themes.flatMap(t => t.lessons.filter(l => l.k === 'P').map(l => l.t)).join('; ') }),
    check: d => {
      const e = [];
      const eq = d.equipment || {};
      if (!(eq.cabinet || []).length) e.push('equipment.cabinet: пусто');
      if (!(eq.lab || []).length) e.push('equipment.lab: нужно оснащение лаборатории под практические занятия');
      if (!(d.software || []).length) e.push('software: пусто');
      okList.forEach(k => { if (!nonEmpty((d.lr_methods || {})[k])) e.push(`lr_methods["${k}"]: пусто`); });
      if (!nonEmpty((d.control || {}).current)) e.push('control.current: нужна фраза о формах текущего контроля');
      return e;
    },
    apply: d => { c.program.conditions = { equipment: d.equipment, software: d.software }; c.program.lr_methods = d.lr_methods; c.program.control = d.control; },
  });

  const NP = Math.ceil(FOS_MIN / FOS_PART);
  const parts = c.fos._parts = c.fos._parts || {};
  const prev = (base, k, field) => Array.from({ length: k - 1 }, (_, i) => ((parts[`${base}:${i + 1}`] || {})[field] || [])).flat();
  const themes = u.themes.map((t, i) => `${i + 1}) ${t.num} ${t.name}`).join('; ');
  for (let k = 1; k <= NP; k++) {
    const id = `tests:${u.code}:${k}`;
    S.push({
      id, title: `Тест по ${u.code}, часть ${k} из ${NP} (${FOS_PART} вопросов)`,
      prompt: () => tpl('ud_tests', { ...vars0, themes, n: FOS_PART,
        part_note: `Это часть ${k} из ${NP} (всего в тесте ${FOS_MIN} вопросов — по 2 на каждого обучающегося). Вопросы охватывают все темы, пропорционально их объёму.` +
          (k > 1 ? ` Уже написаны вопросы (не повторяй их и не перефразируй):\n- ${prev(`tests:${u.code}`, k, 'tests').map(q => q.q).join('\n- ')}` : '') }),
      check: d => {
        const e = []; const T = d.tests || [];
        if (T.length !== FOS_PART) e.push(`вопросов ${T.length}, нужно ровно ${FOS_PART}`);
        T.forEach((q, i) => {
          if (!nonEmpty(q.q)) e.push(`вопрос ${i + 1}: нет текста`);
          if (!Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options).size !== 4) e.push(`вопрос ${i + 1}: нужно 4 разных варианта`);
          if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) e.push(`вопрос ${i + 1}: answer 0–3`);
          if (!Number.isInteger(q.t) || q.t < 1 || q.t > u.themes.length) e.push(`вопрос ${i + 1}: t — порядковый номер темы 1–${u.themes.length}`);
          (q.options || []).forEach(o => { if (Q.VAGUE_OPTION.test(String(o))) e.push(`вопрос ${i + 1}: вариант «${o}» недопустим — только конкретные варианты`); });
        });
        const before = prev(`tests:${u.code}`, k, 'tests').map(q => q.q);
        Q.near([...before, ...T.map(q => q.q)], 0.85).filter(([, b]) => T.some(q => String(q.q).slice(0, 90) === b)).forEach(([a, b]) => e.push(`вопросы почти одинаковые: «${a}» / «${b}» — замени новый`));
        const longest = T.filter(q => { const L = (q.options || []).map(o => String(o).length); return L.length === 4 && L[q.answer] === Math.max(...L) && L.filter(x => x === L[q.answer]).length === 1; }).length;
        if (T.length >= 10 && longest / T.length > 0.6) e.push(`в ${longest} из ${T.length} вопросов правильный вариант самый длинный — выровняй длину вариантов`);
        const cnt = [0, 0, 0, 0]; T.forEach(q => { if (q.answer >= 0 && q.answer <= 3) cnt[q.answer]++; });
        if (T.length && Math.max(...cnt) > Math.ceil(T.length * 0.45)) e.push(`правильные ответы распределены неравномерно (${cnt.join('/')}) — перемешай варианты`);
        return e;
      },
      apply: d => {
        parts[id] = { tests: d.tests.map(q => ({ q: q.q, options: q.options, answer: q.answer, t: q.t })) };
        c.fos.tests = Array.from({ length: NP }, (_, i) => (parts[`tests:${u.code}:${i + 1}`] || {}).tests || []).flat();
      },
    });
  }
  examKeysUd(u).forEach(ek => {
    const base = `exam:${u.code}${ek.last ? '' : '@' + ek.sem}`;
    for (let k = 1; k <= NP; k++) {
      const id = `${base}:${k}`;
      S.push({
        id, title: `Вопросы и задания к ${FORM_NAMES[ek.form] || ek.form} ${u.code} (${ek.label}), часть ${k} из ${NP}`,
        prompt: () => tpl('ud_exam', { ...vars0, themes, forms: `${FORM_NAMES[ek.form] || ek.form}, ${ek.label}`, nq: FOS_PART, nt: FOS_PART,
          part_note: `Это часть ${k} из ${NP}: всего нужно ${FOS_MIN} вопросов и ${FOS_MIN} заданий — по 2 на каждого обучающегося.` +
            (k > 1 ? ` Уже написаны (не повторяй и не перефразируй):\nВопросы:\n- ${prev(base, k, 'questions').join('\n- ')}\nЗадания:\n- ${prev(base, k, 'tasks').join('\n- ')}` : '') }),
        check: d => {
          const e = [];
          if ((d.questions || []).length !== FOS_PART) e.push(`questions: нужно ровно ${FOS_PART}`);
          if ((d.tasks || []).length !== FOS_PART) e.push(`tasks: нужно ровно ${FOS_PART}`);
          [...(d.questions || []), ...(d.tasks || [])].forEach((x, i) => { if (!nonEmpty(x)) e.push(`элемент ${i + 1}: пустая строка`); });
          (d.tasks || []).forEach((t, i) => { if (!/дано/i.test(t) || !/результат/i.test(t)) e.push(`tasks[${i + 1}]: формулировка «Дано: … Результат: …» — нужны слова «Дано» и «Результат»`); });
          const own = (arr, b) => arr.some(x => String(x).slice(0, 90) === b);
          Q.near([...prev(base, k, 'questions'), ...(d.questions || [])], 0.8).filter(([, b]) => own(d.questions || [], b)).forEach(([a, b]) => e.push(`вопросы почти одинаковые: «${a}» / «${b}»`));
          Q.near([...prev(base, k, 'tasks'), ...(d.tasks || [])], 2).filter(([, b]) => own(d.tasks || [], b)).forEach(([a]) => e.push(`задание повторяется дословно: «${a}»`));
          return e;
        },
        apply: d => {
          parts[id] = { questions: d.questions, tasks: d.tasks };
          const all = Array.from({ length: NP }, (_, i) => parts[`${base}:${i + 1}`] || {});
          c.fos.exams[ek.key] = { questions: all.flatMap(x => x.questions || []), tasks: all.flatMap(x => x.tasks || []) };
        },
      });
    }
  });
  if (u.sems.some(s => ['ДР', 'КР'].includes(s.form))) {
    S.push({
      id: `cw:${u.code}`, title: `Контрольная работа ${u.code} (4 варианта)`,
      prompt: () => tpl('ud_cw', { ...vars0, themes }),
      check: d => { const e = []; if ((d.variants || []).length < 3) e.push('нужно 4 варианта (не меньше 3)'); (d.variants || []).forEach((v, i) => { if ((v.tasks || []).length < 2) e.push(`вариант ${i + 1}: не меньше 2 заданий`); if (!nonEmpty(v.answer)) e.push(`вариант ${i + 1}: нет answer`); }); return e; },
      apply: d => { c.fos.control_works = c.fos.control_works || {}; c.fos.control_works[u.code] = { minutes: d.minutes || 90, variants: d.variants }; },
    });
  }
  S.forEach(st => { const own = st.check; st.check = d => [...own(d), ...Q.bannedIn(d)]; });
  return S;
}

module.exports = { listStagesUd, contextBlockUd };
