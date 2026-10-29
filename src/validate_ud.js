// Проверка наполнения учебной дисциплины (project.json: "kind": "ud"). Ошибки блокируют сборку, предупреждения — нет.
'use strict';
const { LESSON, mdkBlocks, srHours, srTasks, themeKey } = require('./sequence.js');
const { parseCodes, FOS_MIN } = require('./validate.js');

const nonEmpty = s => typeof s === 'string' && s.trim().length > 0;
const ATT = ['ДЗ', 'З'];
const ATT_TITLE = /^(дифференцированный\s+)?зач[её]т/i;

// Промежуточные аттестации с билетами (Э, ДЗ, З): ключ в fos.exams — код дисциплины для последней, «код|семестр» для более ранних
function examKeysUd(u) {
  const at = (u.sems || []).filter(b => ['Э', 'ДЗ', 'З'].includes(b.form));
  return at.map((b, i) => ({ key: i === at.length - 1 ? u.code : `${u.code}|${b.label}`, sem: b.sem, label: b.label, form: b.form, last: i === at.length - 1 }));
}

// Блоки занятий дисциплины по семестрам: у ДЗ/З последняя пара семестра — зачёт и входит в часы (как в КТП МДК)
function udBlocks(u) { return mdkBlocks({ ...u, custom: true }); }

function validateUd(content, opts = {}) {
  const errors = [], warnings = [];
  const E = m => errors.push(m), W = m => warnings.push(m);
  const u = content.ud, meta = content.meta || {};
  const pop = opts.pop, plan = opts.plan, fgos = opts.fgos;
  const okList = meta.ok || [];
  const pkList = (meta.pk || []).map(x => x[0]);
  const code = u.code;

  // источники
  if (!pop) E('Не подключён файл ПОП (project.json → pop): результаты, оснащение и литература берутся из ПОП-УД');
  if (pop) {
    if (pop.discipline !== code) E(`ПОП относится к дисциплине ${pop.discipline}, а наполнение — к ${code}`);
    const popOk = Object.keys((pop.results || {}).ok || {});
    if (JSON.stringify([...okList].sort()) !== JSON.stringify([...popOk].sort())) E(`meta.ok ${okList.join(', ')} ≠ ОК из ПОП ${popOk.join(', ')} — ОК дисциплины берутся из приложения ПООП, а не из ФГОС целиком`);
    const popPk = Object.keys((pop.results || {}).pk || {});
    if (JSON.stringify([...pkList].sort()) !== JSON.stringify([...popPk].sort())) E(`meta.pk ${pkList.join(', ')} ≠ ПК из ПОП ${popPk.join(', ')}`);
  }
  if (fgos) {
    okList.forEach(k => { if (!fgos.ok.some(x => x[0] === k)) E(`${k} нет во ФГОС`); });
    (meta.pk || []).forEach(([k, n]) => { const f = fgos.modules.flatMap(m => m.pk).find(x => x[0] === k); if (!f) E(`${k} нет во ФГОС`); else if (f[1] !== n) E(`${k}: наименование не совпадает с ФГОС`); });
  }

  // часы и занятия
  const planItem = plan && (plan.items || []).find(i => i.index === code);
  if (!planItem) E(`В учебном плане нет дисциплины ${code}`);
  let T = 0, P = 0;
  const titles = [];
  (u.themes || []).forEach((th, k) => {
    const tp = `${code} → ${th.num || ''} «${th.name || '?'}»`;
    if (!nonEmpty(th.num) || !nonEmpty(th.name)) E(`${tp}: у темы нет номера или названия`);
    if (!nonEmpty(th.section)) E(`${tp}: нет раздела (section)`);
    if (!Array.isArray(th.content) || !th.content.length || th.content.some(x => !nonEmpty(x))) E(`${tp}: нет содержания темы (перечня дидактических единиц)`);
    if (!Array.isArray(th.lessons) || !th.lessons.length) E(`${tp}: в теме нет занятий`);
    (th.lessons || []).forEach((l, i) => {
      if (!nonEmpty(l.t)) E(`${tp}: занятие №${i + 1} без названия`);
      if (!(l.h > 0) || l.h % LESSON) E(`${tp}: «${l.t}» — ${l.h} ч, должно быть кратно ${LESSON}`);
      if (l.k === 'T') T += l.h || LESSON; else if (l.k === 'P') P += l.h || LESSON; else E(`${tp}: «${l.t}» — тип занятия k должен быть 'T' или 'P'`);
      titles.push(String(l.t).trim().toLowerCase());
    });
    const c = parseCodes(th.codes);
    if (!c.ok.length) E(`${tp}: в codes нет ни одной ОК дисциплины (${okList.join(', ')})`);
    c.ok.forEach(x => { if (!okList.includes(x)) E(`${tp}: ${x} не входит в ОК дисциплины (${okList.join(', ')})`); });
    c.pk.forEach(x => { if (!pkList.includes(x)) E(`${tp}: ${x} не относится к дисциплине (${pkList.join(', ')})`); });
    if (k && u.themes[k - 1].section !== th.section && u.themes.slice(0, k - 1).some(t => t.section === th.section)) E(`${tp}: темы раздела «${th.section}» идут не подряд`);
  });
  // КТП составлена по ПОП (meta.content_from_pop): название и содержание тем — дословно из ПОП, ни один абзац не потерян, названия теоретических занятий — фрагменты содержания
  if (meta.content_from_pop && pop) {
    const pt = pop.sections.flatMap(x => x.themes);
    const cmp = s => String(s).replace(/\s+/g, ' ').trim();
    (u.themes || []).forEach(th => {
      const x = pt.find(y => y.num === th.num);
      if (!x) { E(`${code} → ${th.num}: темы нет в ПОП`); return; }
      if (cmp(th.name) !== cmp(x.name)) E(`${code} → ${th.num}: название темы не совпадает с ПОП «${x.name}»`);
      if (JSON.stringify((th.content || []).map(cmp)) !== JSON.stringify(x.content.map(cmp))) E(`${code} → ${th.num}: содержание темы не дословно из ПОП (абзацев ${(th.content || []).length}, в ПОП ${x.content.length}); перенос — абзацы ПОП по порядку, без пересказа`);
      const all = cmp(x.content.join(' '));
      (th.lessons || []).filter(l => l.k === 'T').forEach(l => l.t.split(/;\s*/).forEach(fr => { if (fr && !all.includes(cmp(fr))) E(`${code} → ${th.num}: название занятия «${fr}» — не фрагмент содержания ПОП`); }));
      const cov = cmp((th.lessons || []).filter(l => l.k === 'T').map(l => l.t).join(' '));
      const lost = x.content.join(' ').split(/(?<=\.)\s+(?=[А-ЯЁ])/).map(cmp).filter(z => z && !cov.includes(cmp(z).replace(/\.$/, '')));
      if (lost.length) E(`${code} → ${th.num}: фрагмент содержания ПОП не охвачен занятиями: «${lost[0].slice(0, 70)}»`);
    });
  }
  const dup = titles.filter((x, i) => titles.indexOf(x) !== i);
  if (dup.length) W(`${code}: повторяются названия занятий: ${[...new Set(dup)].slice(0, 5).join('; ')}`);
  const attSem = (u.sems || []).filter(s => ATT.includes(s.form));
  const A = attSem.length * LESSON; // пары зачёта (ДЗ/З) входят в часы
  const planTP = `теория ${u.T} ч, практика ${u.P} ч`;
  const total = T + P;
  if (total !== u.T + u.P + (u.K || 0)) E(`${code}: занятия дают ${total} ч, по плану ${u.T + u.P + (u.K || 0)} ч`);
  else if (T !== u.T || P !== u.P) {
    const msg = `${code}: деление часов по занятиям (теория ${T} ч, практика ${P} ч) не совпадает с планом (${planTP})`;
    if (nonEmpty(meta.split_note)) W(msg + ` — подтверждено в meta.split_note: ${meta.split_note}`); else E(msg + '. Исправьте виды занятий или подтвердите расхождение в meta.split_note');
  }
  if (planItem) {
    if (total !== planItem.oblig) E(`${code}: занятия дают ${total} ч, в плане обязательная нагрузка ${planItem.oblig} ч`);
    (u.sems || []).forEach(s => { if ((planItem.sem[s.sem] || 0) !== s.hours) E(`${code}: ${s.label} — ${s.hours} ч, в плане ${planItem.sem[s.sem] || 0} ч`); });
    if ((u.sems || []).reduce((a, s) => a + s.hours, 0) !== planItem.oblig) E(`${code}: сумма часов семестров не равна плану`);
    const sh = srHours(u);
    if (Array.isArray(u.sr) && sh !== planItem.self) E(`${code}: сумма часов самостоятельной работы (sr) ${sh} ≠ «Самостоятельная» по плану (${planItem.self})`);
    if (!Array.isArray(u.sr) && planItem.self > 0) W(`${code}: по плану самостоятельная работа ${planItem.self} ч, а в наполнении нет sr`);
  }
  const b = udBlocks(u);
  if (b.total * LESSON !== (u.sems || []).reduce((a, s) => a + s.hours, 0)) E(`${code}: занятия (${b.total * LESSON} ч) не совпадают с часами семестров`);
  if (b.placed !== b.total) E(`${code}: не все занятия уместились в семестры`);
  // номера практических занятий — сквозные, 1…N (считает mdkBlocks)
  // зачёт (ДЗ/З): последняя пара семестра, 2 ч, входит в часы; экзамен — в сессию, в часы занятий не входит
  b.blocks.forEach(bl => {
    const last = bl.groups.length ? bl.groups[bl.groups.length - 1].lessons : [];
    const lastL = last[last.length - 1];
    if (ATT.includes(bl.form)) {
      const lt = lastL ? (lastL.title || '') : '';
      if (!lastL || !lastL.att && !ATT_TITLE.test(lt)) E(`${code}, ${bl.label}: последней парой семестра (${LESSON} ч) должен быть ${bl.form === 'З' ? 'зачёт' : 'дифференцированный зачёт'} (занятие с "att": true) — сейчас «${lt}»`);
    } else if (bl.form === 'Э') {
      bl.groups.forEach(g => g.lessons.forEach(l => { if (l.att || /^экзамен/i.test(l.title || '')) E(`${code}, ${bl.label}: экзамен проводится в сессию и в часы занятий не входит — уберите занятие «${l.title}»`); }));
    }
  });
  (u.sr || []).forEach((e, i) => {
    const sp = `${code}, самостоятельная работа №${i + 1}`;
    if (!(u.sems || []).some(s => s.sem === e.sem)) E(`${sp}: семестр sem=${e.sem} не входит в семестры дисциплины`);
    if (!(Number(e.hours) > 0)) E(`${sp}: hours должно быть больше 0`);
    const tk = srTasks(e);
    tk.forEach(([t]) => { if (!nonEmpty(t)) E(`${sp}: пустое задание`); });
    if (tk.length && tk.every(x => x[1] > 0) && tk.reduce((a, x) => a + x[1], 0) !== Number(e.hours)) E(`${sp}: часы заданий не равны hours`);
    if (e.theme && !u.themes.some(th => themeKey(th.num) === themeKey(e.theme))) E(`${sp}: тема «${e.theme}» не найдена`);
  });
  pkList.forEach(x => { if (!u.themes.some(th => parseCodes(th.codes).pk.includes(x))) W(`${x} не встречается ни в одной теме`); });
  okList.forEach(x => { if (!u.themes.some(th => parseCodes(th.codes).ok.includes(x))) W(`${x} не встречается ни в одной теме`); });

  // оснащение и методы ЛР
  const pr = content.program || {};
  const eq = (pr.conditions || {}).equipment || {};
  if (!(eq.cabinet || []).length) E('program.conditions.equipment.cabinet: пусто');
  if (!(eq.lab || []).length) W('program.conditions.equipment.lab: пусто — в 3.1 не будет оснащения лаборатории');
  if (!((pr.conditions || {}).software || []).length) W('program.conditions.software: пусто');
  [...okList, 'none'].forEach(k => { if (!nonEmpty((pr.lr_methods || {})[k])) E(`program.lr_methods["${k}"]: нет методов формирования ЛР (п. 4.2)`); });
  if (!nonEmpty((pr.control || {}).current)) W('program.control.current: нет перечня форм текущего контроля — будет типовой текст');

  // ФОС
  const f = content.fos || {};
  const tests = f.tests || [];
  if (tests.length < FOS_MIN) E(`fos.tests: нужно не меньше ${FOS_MIN} вопросов — по 2 на обучающегося (сейчас ${tests.length})`);
  const cnt = [0, 0, 0, 0];
  tests.forEach((q, i) => {
    const p = `fos.tests[${i + 1}]`;
    if (!nonEmpty(q.q)) E(`${p}: нет текста вопроса`);
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => !nonEmpty(o))) E(`${p}: нужно ровно 4 непустых варианта`);
    else if (new Set(q.options).size !== 4) E(`${p}: варианты повторяются`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) E(`${p}: answer должен быть 0–3`); else cnt[q.answer]++;
    if (!Number.isInteger(q.t) || q.t < 1 || q.t > u.themes.length) E(`${p}: t — номер темы 1–${u.themes.length}`);
  });
  if (tests.length && Math.max(...cnt) / tests.length > 0.45) W(`fos.tests: больше 45 % правильных ответов под одной буквой (${cnt.join('/')})`);
  if (u.themes.length && tests.length) u.themes.forEach((t, i) => { if (!tests.some(q => q.t === i + 1)) W(`fos.tests: нет вопросов по теме ${t.num} ${t.name}`); });
  examKeysUd(u).forEach(({ key }) => {
    const ex = (f.exams || {})[key] || {};
    if ((ex.questions || []).length < FOS_MIN) E(`fos.exams["${key}"].questions: нужно не меньше ${FOS_MIN} (сейчас ${(ex.questions || []).length})`);
    if ((ex.tasks || []).length < FOS_MIN) E(`fos.exams["${key}"].tasks: нужно не меньше ${FOS_MIN} (сейчас ${(ex.tasks || []).length})`);
    (ex.tasks || []).forEach((t, i) => { if (!/дано/i.test(t) || !/результат/i.test(t)) E(`fos.exams["${key}"].tasks[${i + 1}]: задание в форме «Дано … Результат …» — нет слов «Дано» и/или «Результат»`); });
  });
  if ((u.sems || []).some(s => ['ДР', 'КР'].includes(s.form))) {
    const cw = (f.control_works || {})[code];
    if (!cw || (cw.variants || []).length < 3) E(`fos.control_works["${code}"]: нужно не меньше 3 вариантов контрольной работы`);
  }
  return { errors, warnings };
}

module.exports = { validateUd, examKeysUd, udBlocks };
