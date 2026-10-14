// Построение каркаса наполнения (content.json): часы по МДК, семестрам и практикам; темы — из ПОП.
// Каркас не содержит авторских текстов — их пишет нейросеть или преподаватель.
'use strict';
const fs = require('fs');
const { moduleFromPlan, semLabel, FORM_NAMES } = require('./plan.js');
const { LESSON, distribute } = require('./sequence.js');

const PP_DAY = 6;    // день производственной практики — 6 часов

// Форма аттестации элемента: учебный план, но project.forms_override может её заменить (null — аттестации нет).
function formOf(project, item, semIdx) {
  const ov = (project.forms_override || {});
  if (Object.prototype.hasOwnProperty.call(ov, item.index)) return ov[item.index];
  return item.forms[semIdx] || null;
}

// Темы МДК из ПОП: названия, содержание и практические работы — без изменений.
// Число теоретических занятий и пар на каждую практическую работу распределяется автоматически.
function themesFromPop(sec, T, P) {
  const nT = T / LESSON, nP = P / LESSON;
  const tCount = nT ? distribute(nT, sec.themes.map(t => t.content.join(' ').length)) : sec.themes.map(() => 0);
  // группы лабораторных работ: обычно одна работа ПОП — одна группа; если пар по плану меньше,
  // чем работ ПОП, соседние короткие работы одной темы объединяются в одно занятие (названия сохраняются полностью)
  let groups = sec.themes.flatMap((t, ti) => t.labs.map(l => ({ ti, titles: [l.title] })));
  const len = g => g.titles.join(' ').length;
  while (groups.length > nP) {
    let best = -1;
    for (let i = 0; i + 1 < groups.length; i++) if (groups[i].ti === groups[i + 1].ti && (best < 0 || len(groups[i]) + len(groups[i + 1]) < len(groups[best]) + len(groups[best + 1]))) best = i;
    if (best < 0) throw new Error(`практических пар по плану (${nP}) меньше, чем тем с лабораторными работами ПОП — распределите вручную`);
    groups.splice(best, 2, { ti: groups[best].ti, titles: [...groups[best].titles, ...groups[best + 1].titles] });
  }
  const pairs = groups.length ? distribute(nP, groups.map(len)) : [];
  return sec.themes.map((t, ti) => ({
    num: t.num, name: t.name, content: t.content, codes: '',
    theory_count: tCount[ti], theory: [],
    works: groups.map((g, j) => ({ ...g, n: j + 1, pairs: pairs[j] })).filter(g => g.ti === ti)
      .map(g => (g.titles.length > 1 ? { n: g.n, title: g.titles.map(x => x.replace(/\.\s*$/, '')).join('. '), pop_titles: g.titles, pairs: g.pairs } : { n: g.n, title: g.titles[0], pairs: g.pairs })),
  }));
}

function buildSkeleton(plan, project, fgos, pop) {
  const m = moduleFromPlan(plan, project.pm);
  const off = project.course_offset || 0;
  const mod = fgos.modules.find(x => x.pm === project.pm && (!project.vd_name || x.name === project.vd_name));
  if (!mod) throw new Error(`В справочнике ФГОС нет модуля ${project.pm}${project.vd_name ? ' «' + project.vd_name + '»' : ''}`);
  const errors = [];
  const mdk = m.mdk.map((it, i) => {
    [['теория', it.theory], ['практика', it.practice], ['курсовой', it.course]].forEach(([n, v]) => { if (v % LESSON) errors.push(`${it.index}: часы «${n}» (${v}) не делятся на пары`); });
    const sems = it.sem.map((h, s) => ({ h, s })).filter(x => x.h > 0).map(x => ({ sem: x.s, label: semLabel(x.s, off), hours: x.h, form: formOf(project, it, x.s) }));
    if (sems.reduce((a, x) => a + x.hours, 0) !== it.theory + it.practice + it.course) errors.push(`${it.index}: сумма часов по семестрам ≠ теория + практика + курсовой`);
    if (it.course) sems[sems.length - 1].K = it.course;
    const sec = pop && pop.sections.find(x => x.mdk === it.index);
    if (pop && !sec) errors.push(`${it.index}: в файле ПОП нет раздела для этого МДК`);
    let themes = [];
    if (sec) { try { themes = themesFromPop(sec, it.theory, it.practice); } catch (e) { errors.push(`${it.index}: ${e.message}`); } }
    return {
      code: it.index, name: it.name, section: sec ? sec.section : `Раздел ${i + 1}. ${it.name}`,
      T: it.theory, P: it.practice, K: it.course, sems, themes,
      course_project: it.course ? { hours: it.course, topics: [], stages: [] } : null,
    };
  });
  const up = m.up.flatMap(it => it.sem.map((h, i) => ({ h, i })).filter(s => s.h > 0).map(s => {
    if (s.h % LESSON) errors.push(`${it.index}: часы семестра ${s.i + 1} (${s.h}) не делятся на пары`);
    return { code: it.index, sem: s.i, label: semLabel(s.i, off), hours: s.h, form: formOf(project, it, s.i), works: [] };
  }));
  const pp = m.pp.flatMap(it => it.sem.map((h, i) => ({ h, i })).filter(s => s.h > 0).map(s => {
    if (s.h % PP_DAY) errors.push(`${it.index}: часы семестра ${s.i + 1} (${s.h}) не делятся на дни по ${PP_DAY} ч`);
    return { code: it.index, sem: s.i, label: semLabel(s.i, off), hours: s.h, days: s.h / PP_DAY, form: formOf(project, it, s.i), works: [] };
  }));
  const total = m.pm.oblig || m.pm.max;
  const sum = mdk.reduce((a, x) => a + x.T + x.P + x.K, 0) + up.reduce((a, x) => a + x.hours, 0) + pp.reduce((a, x) => a + x.hours, 0);
  if (sum !== total) errors.push(`Сумма элементов модуля (${sum}) ≠ объёму ${project.pm} по плану (${total})`);
  return {
    skeleton: {
      _info: 'Каркас сгенерирован автоматически по учебному плану и ПОП. Часы, названия тем, содержание тем и практические работы ПОП не менять: их проверяет валидатор.',
      meta: {
        pm: project.pm, pm_name: mod.name, vd: mod.vd, total_hours: total,
        exam_sem: m.lastSem, exam_label: semLabel(m.lastSem, off), n_sem: plan.nSem,
        pk: mod.pk, ok: fgos.ok.map(x => x[0]),
      },
      mdk, up, pp,
      program: { pk_methods: {}, conditions: { equipment: {}, software: [] }, lr_methods: {} },
      fos: { tests: {}, exams: {}, control_works: {}, up_questions: [], module_exam: { variants: [], checklist: [], protocol_checks: [], conditions: '' } },
    },
    errors,
  };
}

function loadPop(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

module.exports = { buildSkeleton, loadPop, LESSON, PP_DAY, FORM_NAMES };
