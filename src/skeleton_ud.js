// Каркас наполнения учебной дисциплины (project.json: "kind": "ud"): часы и семестры — из учебного плана,
// занятия и их порядок — из КТП преподавателя (data/ktp/*.json, tools/ktp_from_xlsx.py), результаты, ОК и ПК — из ПОП (приложение 2).
// Авторских текстов в каркасе нет: коды компетенций по темам, оснащение, тесты и вопросы добавляют этапы (src/stages_ud.js).
'use strict';
const { disciplineFromPlan, semLabel, FORM_NAMES } = require('./plan.js');
const LESSON = 2;

function formOf(project, item, semIdx) {
  const ov = project.forms_override || {};
  if (Object.prototype.hasOwnProperty.call(ov, item.index)) return ov[item.index];
  return item.forms[semIdx] || null;
}

const noDot = s => String(s).replace(/\s*\.\s*$/, '');

// Содержание темы (перечень дидактических единиц) в КТП не задано: берутся названия её занятий —
// теоретических, а у темы из одних практических работ — практических. Составлено программой, не ПОП; в COMPLETENESS.md отмечается.
function contentFromLessons(lessons) {
  const th = lessons.filter(l => l.k === 'T');
  return (th.length ? th : lessons).map(l => noDot(l.t));
}

function buildSkeletonUd(plan, project, fgos, pop, ktp) {
  const code = project.ud;
  const it = disciplineFromPlan(plan, code);
  const off = project.course_offset || 0;
  const errors = [];
  [['теория', it.theory], ['практика', it.practice], ['курсовой', it.course], ['самостоятельная', it.self]].forEach(([n, v]) => { if (v % LESSON) errors.push(`${code}: часы «${n}» (${v}) не делятся на пары`); });
  const sems = it.sem.map((h, s) => ({ h, s })).filter(x => x.h > 0).map(x => ({ sem: x.s, label: semLabel(x.s, off), hours: x.h, form: formOf(project, it, x.s) }));
  if (sems.reduce((a, x) => a + x.hours, 0) !== it.theory + it.practice + it.course) errors.push(`${code}: сумма часов по семестрам ≠ теория + практика + курсовой`);
  if (it.course) errors.push(`${code}: по плану курсовой проект ${it.course} ч — режим «учебная дисциплина» курсовых не поддерживает; вопрос человеку`);
  if (!ktp) errors.push('Не подключена КТП (project.json → ktp): занятия дисциплины берутся из КТП преподавателя');
  const themes = [];
  if (ktp) {
    ktp.sections.forEach(sec => sec.themes.forEach(t => {
      const lessons = t.lessons.map(l => ({ k: l.k, t: l.t, h: l.h, ...(l.homework && l.homework !== '-' ? { hw: l.homework } : {}), ...(l.materials && l.materials !== '-' ? { mat: l.materials } : {}) }));
      themes.push({ num: t.num, name: t.name, section: sec.name, content: contentFromLessons(lessons), codes: '', lessons });
    }));
    const kh = themes.reduce((a, t) => a + t.lessons.reduce((b, l) => b + l.h, 0), 0);
    const kT = themes.reduce((a, t) => a + t.lessons.filter(l => l.k === 'T').reduce((b, l) => b + l.h, 0), 0);
    const kP = kh - kT;
    if (kh !== it.theory + it.practice + it.course) errors.push(`КТП: ${kh} ч, по плану ${it.theory + it.practice + it.course} ч`);
    else if (kT !== it.theory) errors.push(`КТП и план расходятся в делении часов: КТП — теория ${kT} ч, практика ${kP} ч; план — теория ${it.theory} ч, практика ${it.practice} ч (общий объём совпадает). В документе — деление по КТП; вопрос человеку`);
  }
  if (pop && pop.discipline !== code) errors.push(`ПОП относится к ${pop.discipline}, а проект — к ${code}`);
  const okAll = fgos.ok.map(x => x[0]);
  const okPop = Object.keys(((pop || {}).results || {}).ok || {}).filter(k => okAll.includes(k));
  const pkAll = fgos.modules.flatMap(m => m.pk);
  const pkPop = Object.keys(((pop || {}).results || {}).pk || {}).map(k => pkAll.find(x => x[0] === k)).filter(Boolean);
  if (pop && Object.keys(pop.results.ok || {}).some(k => !okAll.includes(k))) errors.push('В ПОП есть ОК, которых нет во ФГОС');
  const total = it.oblig || it.max;
  return {
    skeleton: {
      _info: 'Каркас сгенерирован по учебному плану, КТП и ПОП (режим «учебная дисциплина»). Часы, названия и порядок занятий из КТП, результаты и тексты ПОП не менять: их проверяет валидатор.',
      meta: {
        kind: 'ud', code, name: it.name, total_hours: total, exam_sem: sems.length ? sems[sems.length - 1].sem : 0,
        exam_label: sems.length ? sems[sems.length - 1].label : '', n_sem: plan.nSem,
        ok: okPop.length ? okPop : okAll, pk: pkPop,
      },
      ...(ktp && ktp._generated ? { _notes: ['КТП преподавателя отсутствует — занятия составлены нами по ПОП и плану (tools/ktp_from_pop.py); заменить при получении КТП.'] } : {}),
      ud: { code, name: it.name, custom: true, T: it.theory, P: it.practice, K: it.course, plan_self: it.self, sems, themes },
      program: { conditions: { equipment: {}, software: [] }, lr_methods: {} },
      fos: { tests: [], exams: {} },
    },
    errors,
  };
}

module.exports = { buildSkeletonUd, contentFromLessons, FORM_NAMES, LESSON };
