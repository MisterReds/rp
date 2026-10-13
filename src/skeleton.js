// Построение каркаса наполнения (content.json): бюджеты часов по МДК, семестрам и практикам.
// Каркас не содержит текстов — их пишет нейросеть или преподаватель.
'use strict';
const { moduleFromPlan, semLabel, FORM_NAMES } = require('./plan.js');

const LESSON = 2;    // пара — 2 академических часа (МДК, учебная практика)
const PP_DAY = 6;    // день производственной практики — 6 часов

function evenRound(x) { return Math.round(x / 2) * 2; }

// Распределить часы теории/практики/курсового по семестрам МДК.
function splitMdk(item) {
  const sems = item.sem.map((h, i) => ({ i, h })).filter(s => s.h > 0);
  const total = sems.reduce((a, s) => a + s.h, 0);
  const errors = [];
  if (total !== item.theory + item.practice + item.course)
    errors.push(`${item.index}: сумма по семестрам (${total}) ≠ теория + практика + курсовой (${item.theory}+${item.practice}+${item.course})`);
  [['теория', item.theory], ['практика', item.practice], ['курсовой', item.course]].forEach(([n, v]) => { if (v % 2) errors.push(`${item.index}: часы «${n}» (${v}) не делятся на пары по 2 ч`); });
  sems.forEach(s => { if (s.h % 2) errors.push(`${item.index}: часы семестра ${s.i + 1} (${s.h}) не делятся на пары по 2 ч`); });
  // курсовой проект — в последние семестры
  let K = item.course;
  const k = {};
  for (let j = sems.length - 1; j >= 0 && K > 0; j--) { const t = Math.min(K, sems[j].h); k[sems[j].i] = t; K -= t; }
  const rest = sems.map(s => ({ i: s.i, h: s.h - (k[s.i] || 0) }));
  const restTotal = rest.reduce((a, s) => a + s.h, 0) || 1;
  let tLeft = item.theory;
  const out = rest.map((s, j) => {
    let T = j === rest.length - 1 ? tLeft : Math.min(s.h, evenRound(item.theory * s.h / restTotal));
    T = Math.max(0, Math.min(T, s.h));
    tLeft -= T;
    return { sem: s.i, hours: s.h + (k[s.i] || 0), T, P: s.h - T, K: k[s.i] || 0 };
  });
  if (tLeft !== 0) {
    // перераспределить остаток теории, если последний семестр не вместил
    for (const b of out) { const room = b.P; const add = Math.min(room, tLeft); b.T += add; b.P -= add; tLeft -= add; if (!tLeft) break; }
  }
  return { blocks: out, errors };
}

function buildSkeleton(plan, project, fgos) {
  const m = moduleFromPlan(plan, project.pm);
  const off = project.course_offset || 0;
  const mod = fgos.modules.find(x => x.pm === project.pm && (!project.vd_name || x.name === project.vd_name));
  if (!mod) throw new Error(`В справочнике ФГОС нет модуля ${project.pm}${project.vd_name ? ' «' + project.vd_name + '»' : ''}`);
  const errors = [];
  const mdk = m.mdk.map(it => {
    const { blocks, errors: e } = splitMdk(it); errors.push(...e);
    return {
      code: it.index, name: it.name, T: it.theory, P: it.practice, K: it.course,
      forms: Object.fromEntries(Object.entries(it.forms).map(([s, f]) => [s, f])),
      blocks: blocks.map(b => ({
        sem: b.sem, label: semLabel(b.sem, off), hours: b.hours, T: b.T, P: b.P, K: b.K,
        form: it.forms[b.sem] || null,
        lessons_theory: b.T / LESSON,
        themes: [],
      })),
      course_project: it.course ? { hours: it.course, topics: [], stages: [] } : null,
    };
  });
  const up = m.up.flatMap(it => it.sem.map((h, i) => ({ h, i })).filter(s => s.h > 0).map(s => {
    if (s.h % LESSON) errors.push(`${it.index}: часы семестра ${s.i + 1} (${s.h}) не делятся на пары`);
    return { code: it.index, sem: s.i, label: semLabel(s.i, off), hours: s.h, form: it.forms[s.i] || null, works: [] };
  }));
  const pp = m.pp.flatMap(it => it.sem.map((h, i) => ({ h, i })).filter(s => s.h > 0).map(s => {
    if (s.h % PP_DAY) errors.push(`${it.index}: часы семестра ${s.i + 1} (${s.h}) не делятся на дни по ${PP_DAY} ч`);
    return { code: it.index, sem: s.i, label: semLabel(s.i, off), hours: s.h, days: s.h / PP_DAY, form: it.forms[s.i] || null, works: [] };
  }));
  const total = m.pm.oblig || m.pm.max;
  const sum = mdk.reduce((a, x) => a + x.T + x.P + x.K, 0) + up.reduce((a, x) => a + x.hours, 0) + pp.reduce((a, x) => a + x.hours, 0);
  if (sum !== total) errors.push(`Сумма элементов модуля (${sum}) ≠ объёму ${project.pm} по плану (${total})`);
  return {
    skeleton: {
      _info: 'Каркас сгенерирован автоматически по учебному плану. Часы не менять: их проверяет валидатор. Тексты заполняются этапами наполнения.',
      meta: {
        pm: project.pm, pm_name: mod.name, vd: mod.vd, total_hours: total,
        exam_sem: m.lastSem, exam_label: semLabel(m.lastSem, off),
        pk: mod.pk,
      },
      mdk, up, pp,
      program: { place_text: '', prerequisites: [], next_modules: [], skills: { nav: [], um: [], zn: [] }, pk_ps: {}, pk_criteria: {}, ok_criteria: {}, conditions: { rooms: [], software: [], literature_main: [], literature_add: [] } },
      fos: { tests: {}, exams: {}, control_works: {}, module_exam: { variants: [], checklist: [], protocol_checks: [], conditions: '', portfolio: '' } },
    },
    errors,
  };
}

module.exports = { buildSkeleton, LESSON, PP_DAY, FORM_NAMES };
