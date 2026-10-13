// Строгая проверка наполнения перед сборкой документа.
// Ошибки (errors) блокируют сборку, предупреждения (warnings) — нет.
'use strict';
const { LESSON, PP_DAY } = require('./skeleton.js');

const OK_CODES = ['ОК 01', 'ОК 02', 'ОК 03', 'ОК 04', 'ОК 05', 'ОК 06', 'ОК 07', 'ОК 08', 'ОК 09'];
const nonEmpty = s => typeof s === 'string' && s.trim().length > 0;
const sumH = arr => (arr || []).reduce((a, x) => a + (Number(x[1]) || 0), 0);

// "ПК 1.1, ПК 1.2; ОК 01, ОК 02" -> {pk:[...], ok:[...]}
function parseCodes(s) {
  const t = String(s || '');
  const pk = [...t.matchAll(/ПК\s*(\d+\.\d+)/g)].map(m => 'ПК ' + m[1]);
  const ok = [...t.matchAll(/ОК\s*(\d{2})/g)].map(m => 'ОК ' + m[1]);
  return { pk, ok };
}

function examForms(mdk) {
  const f = {};
  (mdk.blocks || []).forEach(b => { if (b.form) (f[b.form] = f[b.form] || []).push(b.label); });
  return f;
}

function validateThemesBlock(mdk, b, pkList, E, W, path) {
  let t = 0, p = 0;
  if (!Array.isArray(b.themes) || !b.themes.length) { E(`${path}: нет тем`); return; }
  b.themes.forEach((th, k) => {
    const tp = `${path} → тема ${k + 1} «${th.name || '?'}»`;
    if (!nonEmpty(th.name)) E(`${tp}: нет названия темы`);
    if (!nonEmpty(th.summary) || th.summary.length < 40) E(`${tp}: нет краткого содержания темы (summary, не короче 40 символов)`);
    if (!Array.isArray(th.theory)) E(`${tp}: theory должен быть списком названий занятий`);
    if (!Array.isArray(th.practice)) E(`${tp}: practice должен быть списком [название, часы]`);
    (th.theory || []).forEach((x, i) => { if (!nonEmpty(x)) E(`${tp}: пустое теоретическое занятие №${i + 1}`); });
    (th.practice || []).forEach((x, i) => {
      if (!Array.isArray(x) || !nonEmpty(x[0])) E(`${tp}: практическое занятие №${i + 1} должно быть [название, часы]`);
      else if (!(x[1] > 0) || x[1] % LESSON) E(`${tp}: «${x[0]}» — ${x[1]} ч, должно быть кратно ${LESSON}`);
    });
    if (th.summary && (th.theory || []).some(x => x === th.summary)) E(`${tp}: краткое содержание совпадает с названием занятия`);
    const c = parseCodes(th.codes);
    if (!c.pk.length) E(`${tp}: в codes нет ни одной ПК`);
    if (!c.ok.length) E(`${tp}: в codes нет ни одной ОК`);
    c.pk.forEach(x => { if (!pkList.includes(x)) E(`${tp}: ${x} не относится к модулю`); });
    c.ok.forEach(x => { if (!OK_CODES.includes(x)) E(`${tp}: неизвестный код ${x}`); });
    t += (th.theory || []).length * LESSON; p += sumH(th.practice);
  });
  const need = b.hours - (b.K || 0);
  if (t + p !== need) E(`${path}: занятия дают ${t + p} ч (теория ${t} + практика ${p}), а по плану в семестре ${need} ч`);
  return { t, p };
}

function validate(content, opts = {}) {
  const errors = [], warnings = [];
  const E = m => errors.push(m), W = m => warnings.push(m);
  const pkList = (content.meta.pk || []).map(x => x[0]);
  const stages = opts.stages || ['mdk', 'up', 'pp', 'program', 'fos'];

  if (stages.includes('mdk')) {
    const pkSeen = new Set();
    content.mdk.forEach(m => {
      let T = 0, P = 0;
      m.blocks.forEach(b => {
        const r = validateThemesBlock(m, b, pkList, E, W, `${m.code}, ${b.label}`);
        if (r) { T += r.t; P += r.p; }
        (b.themes || []).forEach(th => parseCodes(th.codes).pk.forEach(x => pkSeen.add(x)));
      });
      if (T !== m.T) E(`${m.code}: теория по занятиям ${T} ч, по плану ${m.T} ч`);
      if (P !== m.P) E(`${m.code}: практика по занятиям ${P} ч, по плану ${m.P} ч`);
      const titles = m.blocks.flatMap(b => (b.themes || []).flatMap(th => [...(th.theory || []), ...(th.practice || []).map(x => x[0])]));
      const dup = titles.filter((x, i) => titles.indexOf(x) !== i);
      if (dup.length) W(`${m.code}: повторяются названия занятий: ${[...new Set(dup)].slice(0, 5).join('; ')}`);
      if (m.course_project) {
        const cp = m.course_project;
        if ((cp.topics || []).length < 10) E(`${m.code}: курсовой проект — нужно не меньше 10 тем`);
        if (sumH(cp.stages) !== cp.hours) E(`${m.code}: этапы курсового проекта дают ${sumH(cp.stages)} ч, по плану ${cp.hours} ч`);
        (cp.stages || []).forEach(s => { if (s[1] % LESSON) E(`${m.code}: этап «${s[0]}» не кратен ${LESSON} ч`); });
      }
    });
    pkList.forEach(x => { if (!pkSeen.has(x)) W(`${x} не встречается ни в одной теме МДК (проверьте, что она формируется хотя бы на практике)`); });
  }

  if (stages.includes('up')) content.up.forEach(u => {
    const path = `${u.code}, ${u.label}`;
    if (!u.works || !u.works.length) { E(`${path}: нет видов работ`); return; }
    let s = 0;
    u.works.forEach((w, i) => {
      if (!nonEmpty(w.name)) E(`${path}: вид работ №${i + 1} без названия`);
      (w.tasks || []).forEach(t => { if (!(t[1] > 0) || t[1] % LESSON) E(`${path}: «${t[0]}» — ${t[1]} ч, должно быть кратно ${LESSON}`); });
      parseCodes(w.codes).pk.forEach(x => { if (!pkList.includes(x)) E(`${path}: ${x} не относится к модулю`); });
      s += sumH(w.tasks);
    });
    if (s !== u.hours) E(`${path}: занятия дают ${s} ч, по плану ${u.hours} ч`);
  });

  if (stages.includes('pp')) content.pp.forEach(u => {
    const path = `${u.code}, ${u.label}`;
    if (!u.works || !u.works.length) { E(`${path}: нет видов работ`); return; }
    const days = u.works.reduce((a, w) => a + (w.days || []).length, 0);
    if (days * PP_DAY !== u.hours) E(`${path}: ${days} дн. × ${PP_DAY} ч = ${days * PP_DAY} ч, по плану ${u.hours} ч`);
    u.works.forEach(w => { (w.days || []).forEach(d => { if (!nonEmpty(d)) E(`${path}: пустой день в «${w.name}»`); }); parseCodes(w.codes).pk.forEach(x => { if (!pkList.includes(x)) E(`${path}: ${x} не относится к модулю`); }); });
  });

  if (stages.includes('program')) {
    const pr = content.program;
    pkList.forEach(x => { const r = (pr.pk_results || {})[x] || {}; ['um', 'zn', 'nav'].forEach(k => { if ((r[k] || []).length < 2) E(`program.pk_results["${x}"].${k}: нужно не меньше 2 пунктов (уметь / знать / владеть навыками)`); }); });
    pkList.forEach(x => { const c = pr.pk_criteria[x]; if (!c || !nonEmpty(c[0]) || !nonEmpty(c[1])) E(`program.pk_criteria["${x}"]: нужны [критерий, методы оценки]`); });
    OK_CODES.forEach(x => { const c = pr.ok_criteria[x]; if (!c || !nonEmpty(c[0]) || !nonEmpty(c[1])) E(`program.ok_criteria["${x}"]: нужны [показатель, методы оценки]`); });
    if (!nonEmpty(pr.place_text)) E('program.place_text: нет текста о месте модуля');
    const cnd = pr.conditions || {};
    if (!(cnd.rooms || []).length) E('program.conditions.rooms: нет помещений');
    if (!(cnd.software || []).length) W('program.conditions.software: пусто');
    if ((cnd.literature_main || []).length < 2) E('program.conditions.literature_main: нужно не меньше 2 изданий');
    W('Литературу (program.conditions.literature_*) обязательно сверить с фондом библиотеки и ЭБС: нейросеть может ошибаться в выходных данных.');
  }

  if (stages.includes('fos')) {
    const f = content.fos;
    content.mdk.forEach(m => {
      const tests = f.tests[m.code] || [];
      if (tests.length < 15) E(`fos.tests["${m.code}"]: нужно не меньше 15 вопросов (сейчас ${tests.length})`);
      const cnt = [0, 0, 0, 0];
      tests.forEach((q, i) => {
        const p = `fos.tests["${m.code}"][${i + 1}]`;
        if (!nonEmpty(q.q)) E(`${p}: нет текста вопроса`);
        if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => !nonEmpty(o))) E(`${p}: нужно ровно 4 непустых варианта`);
        else if (new Set(q.options).size !== 4) E(`${p}: варианты повторяются`);
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) E(`${p}: answer должен быть 0–3`); else cnt[q.answer]++;
      });
      if (tests.length && Math.max(...cnt) / tests.length > 0.6) W(`fos.tests["${m.code}"]: больше 60 % правильных ответов под одной буквой — перемешайте варианты`);
      const forms = examForms(m);
      if (forms['Э'] || forms['ДЗ'] || forms['З']) {
        const ex = f.exams[m.code] || {};
        const nq = forms['Э'] ? 20 : 15, nt = forms['Э'] ? 10 : 8;
        if ((ex.questions || []).length < nq) E(`fos.exams["${m.code}"].questions: нужно не меньше ${nq}`);
        if ((ex.tasks || []).length < nt) E(`fos.exams["${m.code}"].tasks: нужно не меньше ${nt}`);
      }
      if (forms['ДР'] || forms['КР']) {
        const cw = f.control_works[m.code];
        if (!cw || (cw.variants || []).length < 2) E(`fos.control_works["${m.code}"]: нужно не меньше 2 вариантов контрольной работы`);
        else cw.variants.forEach((v, i) => { if ((v.tasks || []).length < 2) E(`fos.control_works["${m.code}"] вариант ${i + 1}: нужно не меньше 2 заданий`); if (!nonEmpty(v.answer)) W(`fos.control_works["${m.code}"] вариант ${i + 1}: нет эталона ответа`); });
      }
    });
    const me = f.module_exam;
    const covered = new Set((me.parts || []).flatMap(p => p.pk || []));
    pkList.forEach(x => { if (!covered.has(x)) E(`fos.module_exam.parts: ${x} не проверяется на экзамене по модулю`); });
    if ((me.variants || []).length < 2) E('fos.module_exam.variants: нужно не меньше 2 вариантов');
    (me.variants || []).forEach((v, i) => { if (!(v.tasks || []).length) E(`fos.module_exam.variants[${i + 1}]: нет заданий`); });
    const pts = (me.checklist || []).reduce((a, r) => a + (Number(r[2]) || 0), 0);
    if (pts !== 100) E(`fos.module_exam.checklist: сумма баллов ${pts}, должна быть 100`);
    pkList.forEach(x => { if (!(me.checklist || []).some(r => r[0] === x)) E(`fos.module_exam.checklist: нет критериев по ${x}`); });
    if ((me.protocol_checks || []).length < 3) E('fos.module_exam.protocol_checks: нужно не меньше 3 проверок');
    if (!nonEmpty(me.conditions)) E('fos.module_exam.conditions: нет условий проведения');
  }
  return { errors, warnings };
}

module.exports = { validate, parseCodes, examForms, OK_CODES };
