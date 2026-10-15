// Строгая проверка наполнения перед сборкой документа.
// Ошибки (errors) блокируют сборку, предупреждения (warnings) — нет.
'use strict';
const { LESSON, mdkBlocks, attSems, ppItems, ppText, ppHours } = require('./sequence.js');
const PP_DAY = 6;

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

// Формы аттестации МДК по семестрам: {Э: ['2 курс, 1 семестр'], ...}
// ФОС: по 2 на каждого обучающегося при наборе ~30 человек — не меньше 60 тестовых вопросов на МДК,
// 60 вопросов и 60 практических заданий на каждую промежуточную аттестацию (экзамен/зачёт), 60 вопросов к зачёту по УП
const FOS_MIN = 60;
const FOS_PART = 20; // нейросеть пишет их частями по 20

// Промежуточные аттестации МДК с билетами (Э, ДЗ, З): ключ в fos.exams — код МДК для последней,
// «код|семестр» для более ранних (так их ищет сборка)
function examKeys(mdk) {
  const at = (mdk.sems || []).filter(b => ['Э', 'ДЗ', 'З'].includes(b.form));
  return at.map((b, i) => ({ key: i === at.length - 1 ? mdk.code : `${mdk.code}|${b.label}`, sem: b.sem, label: b.label, form: b.form, last: i === at.length - 1 }));
}

function examForms(mdk) {
  const f = {};
  (mdk.sems || []).forEach(b => { if (b.form) (f[b.form] = f[b.form] || []).push(b.label); });
  return f;
}

function validate(content, opts = {}) {
  const errors = [], warnings = [];
  const E = m => errors.push(m), W = m => warnings.push(m);
  const pkList = (content.meta.pk || []).map(x => x[0]);
  const OKC = content.meta.ok || OK_CODES;
  const pop = opts.pop;
  const stages = opts.stages || ['mdk', 'up', 'pp', 'program', 'fos'];

  if (stages.includes('mdk')) {
    const pkSeen = new Set();
    content.mdk.forEach(m => {
      const sec = pop && pop.sections.find(s => s.mdk === m.code);
      if (pop && sec && !m.custom) {
        if (m.themes.length !== sec.themes.length) E(`${m.code}: тем ${m.themes.length}, в ПОП ${sec.themes.length} — темы ПОП нельзя добавлять и удалять`);
        sec.themes.forEach((pt, i) => {
          const t = m.themes[i]; if (!t) return;
          if (t.name !== pt.name || t.num !== pt.num) E(`${m.code}: тема ${i + 1} «${t.num} ${t.name}» не совпадает с ПОП «${pt.num} ${pt.name}»`);
          if (JSON.stringify(t.content) !== JSON.stringify(pt.content)) E(`${m.code}, ${pt.num} ${pt.name}: содержание темы изменено относительно ПОП`);
          const got = (t.works || []).flatMap(w => w.pop_titles || [w.title]);
          pt.labs.forEach((l, li) => { if (got[li] !== l.title) E(`${m.code}, ${pt.num}: нет лабораторной работы ПОП «${l.title.slice(0, 60)}…» на своём месте (название и порядок менять нельзя)`); });
        });
      }
      let T = 0, P = 0;
      const nums = [];
      m.themes.forEach((th, k) => {
        const tp = `${m.code} → ${th.num || ''} «${th.name || '?'}»`;
        if (Array.isArray(th.lessons)) {
          // занятия перенесены из готового документа (m.custom): проверяются только часы и названия
          th.lessons.forEach((l, i) => {
            if (!nonEmpty(l.t)) E(`${tp}: занятие №${i + 1} без названия`);
            if (!(l.h > 0) || l.h % LESSON) E(`${tp}: «${l.t}» — ${l.h} ч, должно быть кратно ${LESSON}`);
            if (l.k === 'T') T += l.h || LESSON; else if (l.k === 'P') P += l.h || LESSON; else E(`${tp}: «${l.t}» — тип занятия k должен быть 'T' или 'P'`);
          });
          if (!th.lessons.length) E(`${tp}: в теме нет занятий`);
        } else {
        if (!nonEmpty(th.name)) E(`${tp}: нет названия темы`);
        if (!Array.isArray(th.content) || !th.content.length) E(`${tp}: нет содержания темы`);
        if (!Array.isArray(th.theory)) E(`${tp}: theory должен быть списком названий занятий`);
        (th.theory || []).forEach((x, i) => { if (!nonEmpty(x)) E(`${tp}: пустое теоретическое занятие №${i + 1}`); });
        if (th.theory_count !== undefined && (th.theory || []).length !== th.theory_count) E(`${tp}: теоретических занятий ${(th.theory || []).length}, по распределению нужно ${th.theory_count}`);
        (th.works || []).forEach(w => {
          if (!nonEmpty(w.title)) E(`${tp}: практическая работа без названия`);
          if (!Number.isInteger(w.pairs) || w.pairs < 1) E(`${tp}: у практической работы № ${w.n} должно быть целое число пар ≥ 1`);
          nums.push(w.n); P += (w.pairs || 0) * LESSON;
        });
        if (!(th.theory || []).length && !(th.works || []).length) E(`${tp}: в теме нет занятий`);
        T += (th.theory || []).length * LESSON;
        }
        const c = parseCodes(th.codes);
        if (!c.pk.length) E(`${tp}: в codes нет ни одной ПК`);
        if (!c.ok.length) E(`${tp}: в codes нет ни одной ОК`);
        c.pk.forEach(x => { if (!pkList.includes(x)) E(`${tp}: ${x} не относится к модулю`); pkSeen.add(x); });
        c.ok.forEach(x => { if (!OKC.includes(x)) E(`${tp}: неизвестный код ${x}`); });
      });
      if (new Set(nums).size !== nums.length) E(`${m.code}: внутренние номера практических работ (n) должны быть уникальны`);
      const A = attSems(m).length * LESSON; // пары зачёта (ДЗ/З) — в часах МДК
      if (!((T + A === m.T && P === m.P) || (T === m.T && P + A === m.P))) E(`${m.code}: теория ${T} ч + практика ${P} ч${A ? ` + зачёт ${A} ч` : ''} не совпадают с планом (теория ${m.T} ч, практика ${m.P} ч)`);
      const b = mdkBlocks(m);
      if (b.total * LESSON !== m.sems.reduce((a, s) => a + s.hours - (s.K || 0), 0)) E(`${m.code}: занятия (${b.total * LESSON} ч) не совпадают с часами семестров`);
      const titles = m.themes.flatMap(th => th.theory || []);
      const dup = titles.filter((x, i) => titles.indexOf(x) !== i);
      if (dup.length) W(`${m.code}: повторяются названия занятий: ${[...new Set(dup)].slice(0, 5).join('; ')}`);
      if (m.course_project) {
        const cp = m.course_project;
        if (!cp.topics_ref && (cp.topics || []).length < 10) E(`${m.code}: курсовой проект — нужно не меньше 10 тем`);
        if (sumH(cp.stages) !== cp.hours) E(`${m.code}: этапы курсового проекта дают ${sumH(cp.stages)} ч, по плану ${cp.hours} ч`);
      }
    });
    pkList.forEach(x => { if (!pkSeen.has(x)) W(`${x} не встречается ни в одной теме МДК (формируется на практике)`); });
  }

  if (stages.includes('up')) {
    content.up.forEach(u => {
      const path = `${u.code}, ${u.label}`;
      if (!u.works || !u.works.length) { E(`${path}: нет видов работ`); return; }
      let s = 0;
      u.works.forEach((w, i) => {
        if (!nonEmpty(w.name)) E(`${path}: вид работ №${i + 1} без названия`);
        if (pop && (pop.up_works || []).length && !pop.up_works.includes(w.name)) E(`${path}: вид работ «${w.name}» отсутствует в ПОП (названия видов работ берутся из ПОП без изменений)`);
        (w.tasks || []).forEach(t => { if (!(t[1] > 0) || t[1] % LESSON) E(`${path}: «${t[0]}» — ${t[1]} ч, должно быть кратно ${LESSON}`); });
        parseCodes(w.codes).pk.forEach(x => { if (!pkList.includes(x)) E(`${path}: ${x} не относится к модулю`); });
        s += sumH(w.tasks);
      });
      if (s !== u.hours) E(`${path}: занятия дают ${s} ч, по плану ${u.hours} ч`);
      if (['ДЗ', 'З'].includes(u.form)) { const lw = u.works[u.works.length - 1]; const lt = (lw.tasks || [])[(lw.tasks || []).length - 1] || []; if (!/зач[её]т/i.test(lt[0] || '') || lt[1] !== LESSON) E(`${path}: последней парой (${LESSON} ч) должен быть зачёт — сейчас «${lt[0]}», ${lt[1]} ч`); }
    });
    if (pop && pop.up_works && content.up.length && !content._practice_source) { const used = content.up.flatMap(u => u.works.map(w => w.name)); pop.up_works.forEach(n => { if (!used.includes(n)) E(`Учебная практика: не включён вид работ ПОП «${n}»`); }); }
  }

  if (stages.includes('pp')) {
    content.pp.forEach(u => {
      const path = `${u.code}, ${u.label}`;
      if (!u.works || !u.works.length) { E(`${path}: нет видов работ`); return; }
      const hrs = u.works.reduce((a, w) => a + ppHours(w), 0);
      if (hrs !== u.hours) E(`${path}: пункты практики дают ${hrs} ч, по плану ${u.hours} ч`);
      u.works.forEach(w => ppItems(w).forEach(([t, h]) => { if (!(h > 0) || h % PP_DAY) E(`${path}: «${String(t).slice(0, 60)}» — ${h} ч, должно быть кратно ${PP_DAY} (дни по ${PP_DAY} ч)`); }));
      u.works.forEach(w => {
        if (pop && (pop.pp_works || []).length && !pop.pp_works.includes(w.name)) E(`${path}: вид работ «${w.name}» отсутствует в ПОП`);
        ppText(w).forEach(d => { if (!nonEmpty(d)) E(`${path}: пустой день в «${w.name}»`); if (!u.form && /зач[её]т/i.test(d)) E(`${path}: аттестация по практике не предусмотрена, а в дне «${d}» указан зачёт`); });
        parseCodes(w.codes).pk.forEach(x => { if (!pkList.includes(x)) E(`${path}: ${x} не относится к модулю`); });
      });
    });
    if (pop && pop.pp_works && content.pp.length && !content._practice_source) { const used = content.pp.flatMap(u => u.works.map(w => w.name)); pop.pp_works.forEach(n => { if (!used.includes(n)) E(`Производственная практика: не включён вид работ ПОП «${n}»`); }); }
  }

  if (stages.includes('program')) {
    const pr = content.program;
    const cnd = pr.conditions || {};
    if (!pop) E('Не подключён файл ПОП (project.json → pop): результаты, критерии, помещения и литература берутся из ПОП');
    if (!(cnd.software || []).length) W('program.conditions.software: пусто');
    if (!Object.keys(pr.lr_methods || {}).length) E('program.lr_methods: нет методов формирования ЛР (п. 4.2)');
  }

  if (stages.includes('fos')) {
    const f = content.fos;
    content.mdk.forEach(m => {
      const tests = f.tests[m.code] || [];
      if (tests.length < FOS_MIN) E(`fos.tests["${m.code}"]: нужно не меньше ${FOS_MIN} вопросов — по 2 на обучающегося (сейчас ${tests.length})`);
      const cnt = [0, 0, 0, 0];
      tests.forEach((q, i) => {
        const p = `fos.tests["${m.code}"][${i + 1}]`;
        if (!nonEmpty(q.q)) E(`${p}: нет текста вопроса`);
        if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => !nonEmpty(o))) E(`${p}: нужно ровно 4 непустых варианта`);
        else if (new Set(q.options).size !== 4) E(`${p}: варианты повторяются`);
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) E(`${p}: answer должен быть 0–3`); else cnt[q.answer]++;
      });
      if (tests.length && Math.max(...cnt) / tests.length > 0.45) W(`fos.tests["${m.code}"]: больше 45 % правильных ответов под одной буквой — перемешайте варианты`);
      const forms = examForms(m);
      examKeys(m).forEach(({ key }) => {
        const ex = f.exams[key] || {};
        if ((ex.questions || []).length < FOS_MIN) E(`fos.exams["${key}"].questions: нужно не меньше ${FOS_MIN} (сейчас ${(ex.questions || []).length})`);
        if ((ex.tasks || []).length < FOS_MIN) E(`fos.exams["${key}"].tasks: нужно не меньше ${FOS_MIN} (сейчас ${(ex.tasks || []).length})`);
      });
      if (forms['ДР'] || forms['КР']) {
        const cw = f.control_works[m.code];
        if (!cw || (cw.variants || []).length < 3) E(`fos.control_works["${m.code}"]: нужно не меньше 3 вариантов контрольной работы (шаблон СПЭТ: 3–4 варианта)`);
        else cw.variants.forEach((v, i) => { if ((v.tasks || []).length < 2) E(`fos.control_works["${m.code}"] вариант ${i + 1}: нужно не меньше 2 заданий`); if (!nonEmpty(v.answer)) W(`fos.control_works["${m.code}"] вариант ${i + 1}: нет эталона ответа`); });
      }
    });
    if (content.up.some(u => u.form) && (f.up_questions || []).length < FOS_MIN) E(`fos.up_questions: нужно не меньше ${FOS_MIN} вопросов к зачёту по учебной практике (сейчас ${(f.up_questions || []).length})`);
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
    if (/портфолио/i.test(JSON.stringify(me))) E('fos.module_exam: портфолио не используется — уберите упоминания портфолио');
  }
  return { errors, warnings };
}

module.exports = { validate, parseCodes, examForms, examKeys, OK_CODES, FOS_MIN, FOS_PART };
