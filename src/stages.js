// Этапы наполнения. Каждый этап: свой промпт (папка prompts/), своя проверка ответа и место в content.json.
// Структура (часы, семестры, формы аттестации) задаётся каркасом и нейросетью не меняется.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCodes, examForms, OK_CODES } = require('./validate.js');
const { LESSON } = require('./skeleton.js');
const { FORM_NAMES } = require('./plan.js');

const PROMPTS = path.join(__dirname, '..', 'prompts');
const tpl = (name, vars) => fs.readFileSync(path.join(PROMPTS, name + '.md'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
const nonEmpty = s => typeof s === 'string' && s.trim().length > 0;
const sumH = a => (a || []).reduce((x, y) => x + (Number(y[1]) || 0), 0);

function contextBlock(ctx) {
  const { fgos, content: c, project: pj } = ctx;
  const lines = [
    `Специальность: ${fgos.code} ${fgos.name}. Квалификация: ${fgos.qualification}.`,
    `Модуль: ${c.meta.pm} «${c.meta.pm_name}» (${c.meta.vd}), объём ${c.meta.total_hours} ч, группа ${pj.group}, форма обучения ${pj.form}.`,
    'Профессиональные компетенции модуля (ФГОС):',
    ...c.meta.pk.map(([k, n]) => `${k}. ${n}`),
    'Общие компетенции: ' + fgos.ok.map(([k, n]) => `${k} — ${n}`).join('; '),
    'Состав модуля по учебному плану:',
    ...c.mdk.map(m => `${m.code} «${m.name}»: теория ${m.T} ч, практика ${m.P} ч${m.K ? `, курсовой проект ${m.K} ч` : ''}; ` + m.blocks.map(b => `${b.label} — ${b.hours} ч${b.form ? ` (${FORM_NAMES[b.form] || b.form})` : ''}`).join(', ')),
    ...c.up.map(u => `${u.code} учебная практика: ${u.label} — ${u.hours} ч`),
    ...c.pp.map(u => `${u.code} производственная практика: ${u.label} — ${u.hours} ч`),
    `Экзамен по модулю: ${c.meta.exam_label}.`,
  ];
  const h = pj.hints || {};
  if (h.general) lines.push(`Пожелания преподавателя: ${h.general}`);
  return lines.join('\n');
}

function checkCodes(codes, pkList, where, E, needPk = true) {
  const x = parseCodes(codes);
  if (needPk && !x.pk.length) E(`${where}: в codes нет ПК`);
  x.pk.forEach(k => { if (!pkList.includes(k)) E(`${where}: ${k} не относится к модулю (допустимы ${pkList.join(', ')})`); });
  x.ok.forEach(k => { if (!OK_CODES.includes(k)) E(`${where}: неизвестный код ${k}`); });
}

function themeNames(m, uptoBlock = Infinity) {
  return m.blocks.slice(0, uptoBlock).flatMap(b => (b.themes || []).map(t => t.name));
}

// Список всех этапов для текущего content
function listStages(ctx) {
  const c = ctx.content;
  const pk = c.meta.pk.map(x => x[0]);
  const vars0 = { context: contextBlock(ctx), pm: c.meta.pm, pm_name: c.meta.pm_name, pk_codes: pk.join(', ') };
  const hints = ctx.project.hints || {};
  const S = [];

  S.push({
    id: 'program', title: 'Общая часть программы (навыки, умения, знания, критерии)',
    prompt: () => tpl('program', { ...vars0,
      op_list: ctx.plan.items.filter(i => /^ОП\.\d/.test(i.index)).map(i => `${i.index} «${i.name}»`).join('; '),
      pm_list: ctx.plan.items.filter(i => /^ПМ\.\d/.test(i.index)).map(i => `${i.index} «${i.name}»`).join('; ') }),
    check: d => {
      const e = []; const E = x => e.push(x);
      if (!nonEmpty(d.place_text)) E('нет place_text');
      ['nav', 'um', 'zn'].forEach(k => { if (!d.skills || (d.skills[k] || []).length < 5) E(`skills.${k}: нужно не меньше 5 пунктов`); });
      pk.forEach(k => { const v = (d.pk_criteria || {})[k]; if (!Array.isArray(v) || v.length !== 2 || !nonEmpty(v[0]) || !nonEmpty(v[1])) E(`pk_criteria["${k}"] должен быть ["критерий", "методы"]`); });
      OK_CODES.forEach(k => { const v = (d.ok_criteria || {})[k]; if (!Array.isArray(v) || v.length !== 2 || !nonEmpty(v[0]) || !nonEmpty(v[1])) E(`ok_criteria["${k}"] должен быть ["показатель", "методы"]`); });
      return e;
    },
    apply: d => { Object.assign(c.program, { place_text: d.place_text, prerequisites: d.prerequisites || [], next_modules: d.next_modules || [], skills: d.skills, pk_ps: d.pk_ps || {}, pk_criteria: d.pk_criteria, ok_criteria: d.ok_criteria }); },
  });

  c.mdk.forEach((m, mi) => m.blocks.forEach((b, bi) => {
    const n = b.T / LESSON, P = b.P;
    S.push({
      id: `themes:${m.code}:${bi + 1}`, title: `Темы и занятия ${m.code}, ${b.label} (${b.hours} ч)`,
      prompt: () => tpl('themes', { ...vars0, mdk_code: m.code, mdk_name: m.name, sem_label: b.label, n_theory: n, t_hours: b.T, p_hours: P, total: b.T + P,
        exam_note: b.form ? `В конце семестра — ${FORM_NAMES[b.form] || b.form}.` : '',
        previous: themeNames(m, bi).join('; ') || 'нет (это первый семестр МДК)',
        mdk_hint: (hints.mdk || {})[m.code] ? `Пожелания преподавателя по МДК: ${hints.mdk[m.code]}` : '',
        themes_hint: Math.max(2, Math.round((b.T + P) / 18)) }),
      check: d => {
        const e = []; const E = x => e.push(x);
        if (!Array.isArray(d.themes) || !d.themes.length) return ['нет списка themes'];
        let t = 0, p = 0;
        d.themes.forEach((th, i) => {
          const w = `тема ${i + 1} «${th.name || ''}»`;
          if (!nonEmpty(th.name)) E(`${w}: нет name`);
          if (!nonEmpty(th.summary) || th.summary.length < 40) E(`${w}: summary — 2–3 предложения краткого содержания`);
          if (!Array.isArray(th.theory)) E(`${w}: theory должен быть массивом строк`); else t += th.theory.length;
          if (!Array.isArray(th.practice) || !th.practice.length) E(`${w}: нужно хотя бы одно практическое занятие`);
          (th.practice || []).forEach(x => { if (!Array.isArray(x) || !nonEmpty(x[0]) || !(x[1] > 0) || x[1] % LESSON) E(`${w}: практическое занятие ${JSON.stringify(x)} — нужен формат ["название", часы кратные 2]`); else p += x[1]; });
          checkCodes(th.codes, pk, w, E);
          if (!parseCodes(th.codes).ok.length) E(`${w}: в codes нет ОК`);
        });
        if (t !== n) E(`теоретических занятий ${t}, нужно ровно ${n}`);
        if (p !== P) E(`практика суммарно ${p} ч, нужно ровно ${P} ч`);
        return e;
      },
      apply: d => { b.themes = d.themes.map(th => ({ name: th.name, summary: th.summary, theory: th.theory, practice: th.practice.map(x => [x[0], Number(x[1])]), codes: th.codes })); },
    });
  }));

  c.mdk.filter(m => m.course_project).forEach(m => S.push({
    id: `course:${m.code}`, title: `Курсовой проект ${m.code} (${m.K} ч)`,
    prompt: () => tpl('course', { ...vars0, mdk_code: m.code, mdk_name: m.name, hours: m.K }),
    check: d => { const e = []; if ((d.topics || []).length < 10) e.push('topics: нужно не меньше 10 тем'); if (sumH(d.stages) !== m.K) e.push(`stages: сумма ${sumH(d.stages)} ч, нужно ${m.K}`); (d.stages || []).forEach(s => { if (s[1] % LESSON) e.push(`этап «${s[0]}» не кратен 2 ч`); }); return e; },
    apply: d => { m.course_project = { hours: m.K, topics: d.topics, stages: d.stages }; },
  }));

  c.up.forEach((u, ui) => S.push({
    id: `up:${ui + 1}`, title: `Учебная практика ${u.code}, ${u.label} (${u.hours} ч)`,
    prompt: () => tpl('up', { ...vars0, code: u.code, sem_label: u.label, hours: u.hours,
      studied: c.mdk.flatMap(m => m.blocks.filter(b => b.sem <= u.sem).flatMap(b => b.themes.map(t => t.name))).join('; ') || 'см. состав модуля',
      up_hint: hints.up ? `Пожелания преподавателя: ${hints.up}` : '',
      first_note: ui === 0 ? 'Первый вид работ — инструктаж по охране труда и организация рабочего места (codes — пустая строка).' : '',
      last_note: u.form ? 'Последний вид работ — оформление отчёта и дифференцированный зачёт.' : 'Последний вид работ — оформление отчёта по практике.' }),
    check: d => {
      const e = []; const E = x => e.push(x);
      if (!Array.isArray(d.works) || !d.works.length) return ['нет works'];
      let s = 0;
      d.works.forEach((w, i) => {
        if (!nonEmpty(w.name)) E(`вид работ ${i + 1}: нет name`);
        (w.tasks || []).forEach(t => { if (!Array.isArray(t) || !nonEmpty(t[0]) || !(t[1] > 0) || t[1] % LESSON) E(`«${w.name}»: задание ${JSON.stringify(t)} — нужно ["название", часы кратные 2]`); else s += t[1]; });
        checkCodes(w.codes, pk, `«${w.name}»`, E, false);
      });
      if (s !== u.hours) E(`сумма часов ${s}, нужно ровно ${u.hours}`);
      return e;
    },
    apply: d => { u.works = d.works.map(w => ({ name: w.name, codes: w.codes || '', tasks: w.tasks.map(t => [t[0], Number(t[1])]) })); },
  }));

  c.pp.forEach((u, ui) => S.push({
    id: `pp:${ui + 1}`, title: `Производственная практика ${u.code}, ${u.label} (${u.hours} ч)`,
    prompt: () => tpl('pp', { ...vars0, code: u.code, sem_label: u.label, hours: u.hours, days: u.days }),
    check: d => {
      const e = []; const E = x => e.push(x);
      if (!Array.isArray(d.works) || !d.works.length) return ['нет works'];
      const days = d.works.reduce((a, w) => a + (w.days || []).length, 0);
      if (days !== u.days) E(`всего дней ${days}, нужно ровно ${u.days}`);
      d.works.forEach(w => { if (!nonEmpty(w.name)) E('вид работ без name'); (w.days || []).forEach(x => { if (!nonEmpty(x)) E(`пустой день в «${w.name}»`); }); checkCodes(w.codes, pk, `«${w.name}»`, E, false); });
      const seen = new Set(d.works.flatMap(w => parseCodes(w.codes).pk));
      pk.forEach(k => { if (!seen.has(k)) E(`${k} не встречается ни в одном виде работ`); });
      return e;
    },
    apply: d => { u.works = d.works.map(w => ({ name: w.name, codes: w.codes || '', days: w.days })); },
  }));

  S.push({
    id: 'conditions', title: 'Условия реализации (помещения, ПО, литература)',
    prompt: () => tpl('conditions', vars0),
    check: d => { const e = []; if (!(d.rooms || []).length) e.push('нет rooms'); (d.rooms || []).forEach(r => { if (!nonEmpty(r.name) || !nonEmpty(r.purpose) || !(r.equipment || []).length) e.push(`помещение ${JSON.stringify(r.name)}: нужны name, purpose, equipment`); }); if ((d.literature_main || []).length < 2) e.push('literature_main: не меньше 2'); return e; },
    apply: d => { c.program.conditions = { rooms: d.rooms, software: d.software || [], literature_main: d.literature_main, literature_add: d.literature_add || [] }; },
  });

  c.mdk.forEach(m => {
    const themes = () => m.blocks.flatMap(b => b.themes.map(t => t.name)).join('; ');
    const N = Math.max(15, Math.min(25, Math.round((m.T + m.P) / 8)));
    S.push({
      id: `tests:${m.code}`, title: `Тест по ${m.code} (${N} вопросов)`,
      prompt: () => tpl('tests', { ...vars0, mdk_code: m.code, mdk_name: m.name, themes: themes(), n: N }),
      check: d => {
        const e = []; const T = d.tests || [];
        if (T.length !== N) e.push(`вопросов ${T.length}, нужно ровно ${N}`);
        T.forEach((q, i) => { if (!nonEmpty(q.q)) e.push(`вопрос ${i + 1}: нет текста`); if (!Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options).size !== 4) e.push(`вопрос ${i + 1}: нужно 4 разных варианта`); if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) e.push(`вопрос ${i + 1}: answer 0–3`); });
        const cnt = [0, 0, 0, 0]; T.forEach(q => { if (q.answer >= 0 && q.answer <= 3) cnt[q.answer]++; });
        if (T.length && Math.max(...cnt) > Math.ceil(T.length * 0.45)) e.push(`правильные ответы распределены неравномерно (${cnt.join('/')}) — перемешай варианты`);
        return e;
      },
      apply: d => { c.fos.tests[m.code] = d.tests.map(q => ({ q: q.q, options: q.options, answer: q.answer })); },
    });
    const f = examForms(m);
    if (f['Э'] || f['ДЗ'] || f['З']) {
      const nq = f['Э'] ? 25 : 20, nt = f['Э'] ? 12 : 10;
      S.push({
        id: `exam:${m.code}`, title: `Вопросы и задания к промежуточной аттестации ${m.code}`,
        prompt: () => tpl('exam', { ...vars0, mdk_code: m.code, mdk_name: m.name, themes: themes(), forms: Object.keys(f).map(x => FORM_NAMES[x] || x).join(', '), nq, nt }),
        check: d => { const e = []; if ((d.questions || []).length < nq) e.push(`questions: нужно не меньше ${nq}`); if ((d.tasks || []).length < nt) e.push(`tasks: нужно не меньше ${nt}`); return e; },
        apply: d => { c.fos.exams[m.code] = { questions: d.questions, tasks: d.tasks }; },
      });
    }
    if (f['ДР'] || f['КР']) {
      const lbl = (f['ДР'] || f['КР'])[0];
      S.push({
        id: `cw:${m.code}`, title: `Контрольная работа ${m.code}`,
        prompt: () => { const semIdx = m.blocks.find(b => b.label === lbl).sem; return tpl('cw', { ...vars0, mdk_code: m.code, mdk_name: m.name, sem_label: lbl, themes: m.blocks.filter(b => b.sem <= semIdx).flatMap(b => b.themes.map(t => t.name)).join('; ') }); },
        check: d => { const e = []; if ((d.variants || []).length !== 2) e.push('нужно ровно 2 варианта'); (d.variants || []).forEach((v, i) => { if ((v.tasks || []).length < 2) e.push(`вариант ${i + 1}: не меньше 2 заданий`); if (!nonEmpty(v.answer)) e.push(`вариант ${i + 1}: нет answer`); }); return e; },
        apply: d => { c.fos.control_works[m.code] = { minutes: d.minutes || 90, variants: d.variants }; },
      });
    }
  });

  S.push({
    id: 'module_exam', title: `Экзамен по модулю ${c.meta.pm}`,
    prompt: () => tpl('module_exam', vars0),
    check: d => {
      const e = []; const E = x => e.push(x);
      const covered = (d.parts || []).flatMap(p => p.pk || []);
      pk.forEach(k => { const n = covered.filter(x => x === k).length; if (n !== 1) E(`${k} должна входить ровно в одну часть экзамена (сейчас ${n})`); });
      if ((d.variants || []).length < 4) E('нужно 4 варианта');
      (d.variants || []).forEach((v, i) => { if (!(v.tasks || []).length) E(`вариант ${i + 1}: нет tasks`); });
      const pts = (d.checklist || []).reduce((a, r) => a + (Number(r[2]) || 0), 0);
      if (pts !== 100) E(`checklist: сумма баллов ${pts}, нужно ровно 100`);
      pk.forEach(k => { if (!(d.checklist || []).some(r => r[0] === k)) E(`checklist: нет критериев по ${k}`); });
      if ((d.protocol_checks || []).length < 5) E('protocol_checks: нужно 5–8 строк');
      if (!nonEmpty(d.conditions)) E('нет conditions');
      return e;
    },
    apply: d => { c.fos.module_exam = { parts: d.parts, conditions: d.conditions, portfolio: d.portfolio || '', variants: d.variants, checklist: d.checklist.map(r => [r[0], r[1], Number(r[2])]), protocol_title: d.protocol_title || '', protocol_checks: d.protocol_checks }; },
  });
  return S;
}

module.exports = { listStages, contextBlock };
