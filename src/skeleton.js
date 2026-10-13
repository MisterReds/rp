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
  const tCount = distribute(nT, sec.themes.map(t => t.content.join(' ').length));
  const labs = sec.themes.flatMap((t, ti) => t.labs.map(l => ({ ti, ...l })));
  const pairs = labs.length ? distribute(nP, labs.map(l => l.title.length)) : [];
  return sec.themes.map((t, ti) => ({
    num: t.num, name: t.name, content: t.content, codes: '',
    theory_count: tCount[ti], theory: [],
    works: labs.map((l, j) => ({ ...l, pairs: pairs[j] })).filter(l => l.ti === ti).map(({ n, title, pairs: p }) => ({ n, title, pairs: p })),
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
        pk: mod.pk,
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
