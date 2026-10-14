// Этапы наполнения. Каждый этап: свой промпт (папка prompts/), своя проверка ответа и место в content.json.
// Структура (часы, семестры, формы аттестации) задаётся учебным планом, темы и практические работы — ПОП; нейросеть их не меняет.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCodes, examForms, examKeys, OK_CODES, FOS_MIN, FOS_PART } = require('./validate.js');
const { LESSON, mdkBlocks } = require('./sequence.js');
const { FORM_NAMES } = require('./plan.js');

const Q = require('../tools/lint_content.js'); // общие проверки качества текстов (повторы, «части», варианты тестов)
const PROMPTS = path.join(__dirname, '..', 'prompts');
const tpl = (name, vars) => fs.readFileSync(path.join(PROMPTS, name + '.md'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
const nonEmpty = s => typeof s === 'string' && s.trim().length > 0;

function contextBlock(ctx) {
  const { fgos, content: c, project: pj } = ctx;
  const lines = [
    `Специальность: ${fgos.code} ${fgos.name}. Квалификация: ${fgos.qualification}.`,
    `Модуль: ${c.meta.pm} «${c.meta.pm_name}» (${c.meta.vd}), объём ${c.meta.total_hours} ч, группа ${pj.group}, форма обучения ${pj.form}.`,
    'Профессиональные компетенции модуля (ФГОС):',
    ...c.meta.pk.map(([k, n]) => `${k}. ${n}`),
    'Общие компетенции: ' + fgos.ok.map(([k, n]) => `${k} — ${n}`).join('; '),
    'Состав модуля по учебному плану:',
    ...c.mdk.map(m => `${m.code} «${m.name}» (${m.section}): теория ${m.T} ч, практика ${m.P} ч; ` + m.sems.map(b => `${b.label} — ${b.hours} ч${b.form ? ` (${FORM_NAMES[b.form] || b.form})` : ''}`).join(', ')),
    ...c.up.map(u => `${u.code} учебная практика: ${u.label} — ${u.hours} ч${u.form ? ` (${FORM_NAMES[u.form] || u.form})` : ''}`),
    ...c.pp.map(u => `${u.code} производственная практика: ${u.label} — ${u.hours} ч${u.form ? ` (${FORM_NAMES[u.form] || u.form})` : ' (аттестация не проводится, по окончании — отчёт по практике)'}`),
    `Экзамен по модулю: ${c.meta.exam_label}.`,
  ];
  const h = pj.hints || {};
  if (h.general) lines.push(`Пожелания преподавателя: ${h.general}`);
  return lines.join('\n');
}

function checkCodes(codes, pkList, where, E, needPk = true, okList = OK_CODES) {
  const x = parseCodes(codes);
  if (needPk && !x.pk.length) E(`${where}: в codes нет ПК`);
  x.pk.forEach(k => { if (!pkList.includes(k)) E(`${where}: ${k} не относится к модулю (допустимы ${pkList.join(', ')})`); });
  x.ok.forEach(k => { if (!okList.includes(k)) E(`${where}: неизвестный код ${k}`); });
}

// Темы ПОП, изученные к концу семестра semIdx
function studiedThemes(m, semIdx) {
  const { blocks } = mdkBlocks(m);
  return [...new Set(blocks.filter(b => b.sem <= semIdx).flatMap(b => b.groups.map(g => `${g.theme.num} ${g.theme.name}`)))];
}

function listStages(ctx) {
  const c = ctx.content;
  const pop = ctx.pop || {};
  const pk = c.meta.pk.map(x => x[0]);
  const okList = c.meta.ok || OK_CODES;
  const vars0 = { context: contextBlock(ctx), pm: c.meta.pm, pm_name: c.meta.pm_name, pk_codes: pk.join(', ') };
  const hints = ctx.project.hints || {};
  const S = [];

  c.mdk.filter(m => !m.custom).forEach(m => S.push({
    id: `themes:${m.code}`, title: `Теоретические занятия и коды компетенций по темам ПОП ${m.code}`,
    prompt: () => tpl('themes', { ...vars0, mdk_code: m.code, mdk_name: m.name,
      themes: m.themes.map(t => `${t.num} ${t.name}\n  Содержание: ${t.content.join(' ')}\n  Теоретических занятий: ${t.theory_count}\n  Практические работы: ${(t.works || []).map(w => `№ ${w.n}. ${w.title}`).join('; ') || 'нет'}`).join('\n') + ((hints.mdk || {})[m.code] ? `\nПожелания преподавателя: ${hints.mdk[m.code]}` : '') }),
    check: d => {
      const e = []; const E = x => e.push(x);
      if (!Array.isArray(d.themes) || d.themes.length !== m.themes.length) return [`нужно ровно ${m.themes.length} тем в порядке ПОП`];
      d.themes.forEach((th, i) => {
        const t = m.themes[i]; const w = `${t.num} ${t.name}`;
        if (!Array.isArray(th.theory) || th.theory.length !== t.theory_count) E(`${w}: нужно ровно ${t.theory_count} теоретических занятий`);
        (th.theory || []).forEach(x => {
          if (!nonEmpty(x)) return E(`${w}: пустое название занятия`);
          if (Q.LESSON_BAD.test(x.trim())) E(`${w}: «${x}» — не пиши «Часть/Продолжение/Повторение/Лекция N», назови дидактическую единицу`);
          if (Q.norm(x) === Q.norm(t.name)) E(`${w}: «${x}» повторяет название темы — назови конкретную дидактическую единицу`);
        });
        checkCodes(th.codes, pk, w, E, true, okList);
        if (!parseCodes(th.codes).ok.length) E(`${w}: в codes нет ОК`);
      });
      Q.dup(d.themes.flatMap(th => th.theory || [])).forEach(x => E(`занятие «${x}» повторяется — названия внутри МДК не повторяются`));
      return e;
    },
    apply: d => { d.themes.forEach((th, i) => { m.themes[i].theory = th.theory; m.themes[i].codes = th.codes; }); },
  }));

  c.mdk.filter(m => m.course_project).forEach(m => S.push({
    id: `course:${m.code}`, title: `Курсовой проект ${m.code} (${m.K} ч)`,
    prompt: () => tpl('course', { ...vars0, mdk_code: m.code, mdk_name: m.name, hours: m.K }),
    check: d => { const e = []; const sum = (d.stages || []).reduce((a, x) => a + (Number(x[1]) || 0), 0); if ((d.topics || []).length < 10) e.push('topics: нужно не меньше 10 тем'); if (sum !== m.K) e.push(`stages: сумма ${sum} ч, нужно ${m.K}`); (d.stages || []).forEach(x => { if (x[1] % LESSON) e.push(`этап «${x[0]}» не кратен 2 ч`); }); return e; },
    apply: d => { m.course_project = { hours: m.K, topics: d.topics, stages: d.stages }; },
  }));

  // виды работ УП из ПОП распределяются по семестрам практики подряд
  const upWorks = pop.up_works || [];
  const upSplit = (() => {
    if (!c.up.length) return [];
    const tot = c.up.reduce((a, u) => a + u.hours, 0); let k = 0;
    return c.up.map((u, i) => { const n = i === c.up.length - 1 ? upWorks.length - k : Math.max(1, Math.round(upWorks.length * u.hours / tot)); const r = upWorks.slice(k, k + n); k += n; return r; });
  })();
  c.up.forEach((u, ui) => S.push({
    id: `up:${ui + 1}`, title: `Учебная практика ${u.code}, ${u.label} (${u.hours} ч)`,
    prompt: () => tpl('up', { ...vars0, code: u.code, sem_label: u.label, hours: u.hours,
      works: upWorks.length ? `${upSplit[ui].map(x => `«${x}»`).join('; ')} (рекомендуемое распределение; допустимы любые виды работ из перечня ПОП: ${upWorks.map(x => `«${x}»`).join('; ')}; за все семестры должны быть охвачены все)` : 'составь сам (в ПОП нет перечня видов работ)',
      studied: c.mdk.flatMap(m => studiedThemes(m, u.sem)).join('; ') || 'см. состав модуля',
      up_hint: hints.up ? `Пожелания преподавателя: ${hints.up}` : '',
      first_note: ui === 0 ? 'Первое задание первого вида работ — инструктаж по охране труда и организация рабочего места (2 ч).' : '',
      last_note: u.form ? `Последнее задание — оформление отчёта по учебной практике и ${FORM_NAMES[u.form] || u.form}.` : 'Последнее задание — оформление отчёта по практике.' }),
    check: d => {
      const e = []; const E = x => e.push(x);
      if (!Array.isArray(d.works) || !d.works.length) return ['нет works'];
      let s = 0;
      d.works.forEach((w, i) => {
        if (upWorks.length && !upWorks.includes(w.name)) E(`вид работ ${i + 1} «${w.name}»: название должно дословно совпадать с одним из видов работ ПОП: ${upWorks.join(' | ')}`);
        (w.tasks || []).forEach(t => { if (!Array.isArray(t) || !nonEmpty(t[0]) || !(t[1] > 0) || t[1] % LESSON) E(`«${w.name}»: задание ${JSON.stringify(t)} — нужно ["название", часы кратные 2]`); else s += t[1]; });
        checkCodes(w.codes, pk, `«${w.name}»`, E, false, okList);
      });
      // все виды работ ПОП должны встретиться на учебной практике (по всем семестрам вместе)
      if (ui === c.up.length - 1 && upWorks.length) {
        const used = new Set([...c.up.slice(0, ui).flatMap(x => (x.works || []).map(w => w.name)), ...d.works.map(w => w.name)]);
        upWorks.forEach(n => { if (!used.has(n)) E(`не включён вид работ ПОП «${n}»`); });
      }
      Q.dup(d.works.flatMap(w => (w.tasks || []).map(t => Array.isArray(t) ? t[0] : ''))).forEach(x => E(`задание «${x}» повторяется — каждое задание своё`));
      if (s !== u.hours) E(`сумма часов ${s}, нужно ровно ${u.hours}`);
      return e;
    },
    apply: d => { u.works = d.works.map(w => ({ name: w.name, codes: w.codes || '', tasks: w.tasks.map(t => [t[0], Number(t[1])]) })); },
  }));

  c.pp.forEach((u, ui) => S.push({
    id: `pp:${ui + 1}`, title: `Производственная практика ${u.code}, ${u.label} (${u.hours} ч)`,
    prompt: () => tpl('pp', { ...vars0, code: u.code, sem_label: u.label, hours: u.hours, days: u.days,
      works: (pop.pp_works || []).length ? pop.pp_works.map(x => `«${x}»`).join('; ') : 'в ПОП перечня нет — составь 3–6 видов работ сам по практическому опыту и ПК модуля',
      final_note: u.form ? `последний день — оформление отчёта и ${FORM_NAMES[u.form] || u.form}.` : 'последний день — оформление отчёта по практике (зачёт/аттестацию НЕ указывать — она не проводится).' }),
    check: d => {
      const e = []; const E = x => e.push(x);
      if (!Array.isArray(d.works) || !d.works.length) return ['нет works'];
      const days = d.works.reduce((a, w) => a + (w.days || []).length, 0);
      if (days !== u.days) E(`всего дней ${days}, нужно ровно ${u.days}`);
      d.works.forEach(w => {
        if ((pop.pp_works || []).length && !pop.pp_works.includes(w.name)) E(`вид работ «${w.name}» не совпадает дословно с ПОП`);
        (w.days || []).forEach(x => { if (!nonEmpty(x)) E(`пустой день в «${w.name}»`); if (!u.form && /зач[её]т/i.test(x)) E(`«${x}»: зачёт по производственной практике не проводится`); });
        checkCodes(w.codes, pk, `«${w.name}»`, E, false, okList);
      });
      (pop.pp_works || []).forEach(n => { if (!d.works.some(w => w.name === n)) E(`не включён вид работ ПОП «${n}»`); });
      Q.dup(d.works.flatMap(w => w.days || [])).forEach(x => E(`день «${x}» повторяется — каждый день своё содержание`));
      const seen = new Set(d.works.flatMap(w => parseCodes(w.codes).pk));
      pk.forEach(k => { if (!seen.has(k)) E(`${k} не встречается ни в одном виде работ`); });
      return e;
    },
    apply: d => { u.works = d.works.map(w => ({ name: w.name, codes: w.codes || '', days: w.days })); },
  }));

  S.push({
    id: 'program', title: 'Оснащение, ПО и методы формирования ЛР',
    prompt: () => tpl('program', { ...vars0, ok_codes: okList.join(', '), ok_last: okList[okList.length - 1], works: c.mdk.map(m => `${m.code}: ` + m.themes.flatMap(t => (t.works || []).map(w => `№ ${w.n} ${w.title}`)).join('; ')).join('\n') }),
    check: d => {
      const e = [];
      const eq = d.equipment || {};
      if (!(eq.cabinet || []).length) e.push('equipment.cabinet: пусто');
      if (!(eq.lab || []).length && !(eq.workshop || []).length) e.push('equipment.lab / equipment.workshop: нужно оснащение лаборатории или мастерской');
      [...okList, 'none'].forEach(k => { if (!nonEmpty((d.lr_methods || {})[k])) e.push(`lr_methods["${k}"]: пусто`); });
      return e;
    },
    apply: d => { c.program.conditions = { equipment: d.equipment, software: d.software || [] }; c.program.lr_methods = d.lr_methods; },
  });

  c.mdk.forEach(m => {
    const themes = () => m.themes.map((t, i) => `${i + 1}) ${t.num} ${t.name}`).join('; ');
    const NP = Math.ceil(FOS_MIN / FOS_PART); // число частей
    const parts = c.fos._parts = c.fos._parts || {};
    const prev = (base, k, field) => Array.from({ length: k - 1 }, (_, i) => ((parts[`${base}:${i + 1}`] || {})[field] || [])).flat();
    // тест: части по FOS_PART вопросов, в сумме FOS_MIN; каждая часть видит вопросы предыдущих
    for (let k = 1; k <= NP; k++) {
      const id = `tests:${m.code}:${k}`;
      S.push({
        id, title: `Тест по ${m.code}, часть ${k} из ${NP} (${FOS_PART} вопросов)`,
        prompt: () => tpl('tests', { ...vars0, mdk_code: m.code, mdk_name: m.name, themes: themes(), n: FOS_PART,
          part_note: `Это часть ${k} из ${NP} (всего в тесте ${FOS_MIN} вопросов — по 2 на каждого обучающегося). Вопросы охватывают все темы.` +
            (k > 1 ? ` Уже написаны вопросы (не повторяй их и не перефразируй):\n- ${prev(`tests:${m.code}`, k, 'tests').map(q => q.q).join('\n- ')}` : '') }),
        check: d => {
          const e = []; const T = d.tests || [];
          if (T.length !== FOS_PART) e.push(`вопросов ${T.length}, нужно ровно ${FOS_PART}`);
          T.forEach((q, i) => { if (!nonEmpty(q.q)) e.push(`вопрос ${i + 1}: нет текста`); if (!Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options).size !== 4) e.push(`вопрос ${i + 1}: нужно 4 разных варианта`); if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) e.push(`вопрос ${i + 1}: answer 0–3`); if (!Number.isInteger(q.t) || q.t < 1 || q.t > m.themes.length) e.push(`вопрос ${i + 1}: t — порядковый номер темы 1–${m.themes.length}`); });
          T.forEach((q, i) => (q.options || []).forEach(o => { if (Q.VAGUE_OPTION.test(String(o))) e.push(`вопрос ${i + 1}: вариант «${o}» недопустим — только конкретные варианты`); }));
          const before = prev(`tests:${m.code}`, k, 'tests').map(q => q.q);
          Q.near([...before, ...T.map(q => q.q)], 0.85).filter(([, b]) => T.some(q => String(q.q).slice(0, 90) === b)).forEach(([a, b]) => e.push(`вопросы почти одинаковые: «${a}» / «${b}» — замени новый`));
          const longest = T.filter(q => { const L = (q.options || []).map(o => String(o).length); return L.length === 4 && L[q.answer] === Math.max(...L) && L.filter(x => x === L[q.answer]).length === 1; }).length;
          if (T.length >= 10 && longest / T.length > 0.6) e.push(`в ${longest} из ${T.length} вопросов правильный вариант самый длинный — ответ угадывается по длине; сделай неправильные варианты такой же длины и правдоподобными`);
          const cnt = [0, 0, 0, 0]; T.forEach(q => { if (q.answer >= 0 && q.answer <= 3) cnt[q.answer]++; });
          if (T.length && Math.max(...cnt) > Math.ceil(T.length * 0.45)) e.push(`правильные ответы распределены неравномерно (${cnt.join('/')}) — перемешай варианты`);
          return e;
        },
        apply: d => {
          parts[id] = { tests: d.tests.map(q => ({ q: q.q, options: q.options, answer: q.answer, t: q.t })) };
          c.fos.tests[m.code] = Array.from({ length: NP }, (_, i) => (parts[`tests:${m.code}:${i + 1}`] || {}).tests || []).flat();
        },
      });
    }
    const f = examForms(m);
    // билеты: по каждой промежуточной аттестации (Э/ДЗ/З) — FOS_MIN вопросов и FOS_MIN заданий, частями по FOS_PART
    examKeys(m).forEach(ek => {
      const base = `exam:${m.code}${ek.last ? '' : '@' + ek.sem}`;
      const thList = ek.last ? m.themes.map(t => `${t.num} ${t.name}`) : studiedThemes(m, ek.sem);
      for (let k = 1; k <= NP; k++) {
        const id = `${base}:${k}`;
        S.push({
          id, title: `Вопросы и задания к ${FORM_NAMES[ek.form] || ek.form} ${m.code} (${ek.label}), часть ${k} из ${NP}`,
          prompt: () => tpl('exam', { ...vars0, mdk_code: m.code, mdk_name: m.name, themes: thList.map((t, i) => `${i + 1}) ${t}`).join('; '),
            forms: `${FORM_NAMES[ek.form] || ek.form}, ${ek.label}`, nq: FOS_PART, nt: FOS_PART,
            part_note: `Это часть ${k} из ${NP}: всего нужно ${FOS_MIN} вопросов и ${FOS_MIN} заданий — по 2 на каждого обучающегося.` +
              (k > 1 ? ` Уже написаны (не повторяй и не перефразируй):\nВопросы:\n- ${prev(base, k, 'questions').join('\n- ')}\nЗадания:\n- ${prev(base, k, 'tasks').join('\n- ')}` : '') }),
          check: d => {
            const e = [];
            if ((d.questions || []).length !== FOS_PART) e.push(`questions: нужно ровно ${FOS_PART}`);
            if ((d.tasks || []).length !== FOS_PART) e.push(`tasks: нужно ровно ${FOS_PART}`);
            [...(d.questions || []), ...(d.tasks || [])].forEach((x, i) => { if (!nonEmpty(x)) e.push(`элемент ${i + 1}: пустая строка`); });
            const pq = prev(base, k, 'questions'), pt = prev(base, k, 'tasks');
            const own = (arr, b) => arr.some(x => String(x).slice(0, 90) === b);
            Q.near([...pq, ...(d.questions || [])], 0.8).filter(([, b]) => own(d.questions || [], b)).forEach(([a, b]) => e.push(`вопросы почти одинаковые: «${a}» / «${b}»`));
            // задания одного типа с разными исходными данными допустимы (индивидуальные варианты); полный повтор — нет
            Q.near([...pt, ...(d.tasks || [])], 2).filter(([, b]) => own(d.tasks || [], b)).forEach(([a]) => e.push(`задание повторяется дословно: «${a}» — дай другие исходные данные или другое действие`));
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
    if (f['ДР'] || f['КР']) {
      const lbl = (f['ДР'] || f['КР'])[0];
      const semIdx = m.sems.find(b => b.label === lbl).sem;
      S.push({
        id: `cw:${m.code}`, title: `Контрольная работа ${m.code} (4 варианта)`,
        prompt: () => tpl('cw', { ...vars0, mdk_code: m.code, mdk_name: m.name, sem_label: lbl, themes: studiedThemes(m, semIdx).join('; ') }),
        check: d => { const e = []; if ((d.variants || []).length < 3) e.push('нужно 4 варианта (не меньше 3)'); (d.variants || []).forEach((v, i) => { if ((v.tasks || []).length < 2) e.push(`вариант ${i + 1}: не меньше 2 заданий`); if (!nonEmpty(v.answer)) e.push(`вариант ${i + 1}: нет answer`); }); return e; },
        apply: d => { c.fos.control_works[m.code] = { minutes: d.minutes || 90, variants: d.variants }; },
      });
    }
  });

  const upF = c.up.find(u => u.form);
  if (upF) S.push({
    id: 'upq', title: `Вопросы к зачёту по учебной практике ${upF.code}`,
    prompt: () => tpl('upq', { ...vars0, n: FOS_MIN, code: upF.code, works: c.up.flatMap(u => u.works.map(w => w.name)).join('; ') }),
    check: d => { const e = []; const q = d.questions || []; if (q.length < FOS_MIN) e.push(`вопросов ${q.length}, нужно не меньше ${FOS_MIN} — по 2 на каждого обучающегося`); Q.near(q, 0.85).forEach(([a, b]) => e.push(`вопросы почти одинаковые: «${a}» / «${b}»`)); return e; },
    apply: d => { c.fos.up_questions = d.questions; },
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
      if (/портфолио/i.test(JSON.stringify(d))) E('портфолио не используется — убери все упоминания');
      return e;
    },
    apply: d => { c.fos.module_exam = { parts: d.parts, conditions: d.conditions, variants: d.variants, checklist: d.checklist.map(r => [r[0], r[1], Number(r[2])]), protocol_title: d.protocol_title || '', protocol_checks: d.protocol_checks }; },
  });
  // общая проверка для всех этапов: запрещённые слова, заглушки, служебные фразы нейросети
  S.forEach(st => { const own = st.check; st.check = d => [...own(d), ...Q.bannedIn(d)]; });
  return S;
}

module.exports = { listStages, contextBlock };
