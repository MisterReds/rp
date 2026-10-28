// Разбор учебного плана, скопированного из Excel (текст с табуляциями, TSV).
// Ожидаемые столбцы: Индекс | Наименование | Формы ПА | Макс. | Самост. | Обяз. | Теория | Практика | Курсовых | семестр 1 | семестр 2 | ...
'use strict';
const fs = require('fs');

const INDEX_RE = /^(СГ|ОП|П|ПМ|МДК|УП|ПП|ПДП|ГИА|ОУД|ОД|БД|ПД|ПОО|ОГСЭ|ЕН)(\.\d+)*\.?\s*$/;
const FORM_NAMES = {
  'Э': 'экзамен', 'ДЗ': 'дифференцированный зачёт', 'З': 'зачёт',
  'ДР': 'другая форма контроля (контрольная работа)', 'КР': 'контрольная работа', 'ЭК': 'экзамен квалификационный',
};

function num(x) {
  const v = String(x || '').replace(/\s/g, '').replace(',', '.');
  return v === '' ? 0 : Number(v);
}

function parsePlanText(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let title = '';
  for (const line of lines) {
    const c = line.split('\t').map(s => s.trim());
    if (!title && /ОП|Учебный план|План/i.test(c[0] || '')) title = c[0];
    if (!INDEX_RE.test(c[0] || '')) continue;
    // числовая часть начинается с 4-го столбца
    const nums = c.slice(3).map(num);
    if (nums.some(Number.isNaN)) continue;
    const [max, self, oblig, theory, practice, course, ...sem] = nums;
    items.push({ index: c[0].replace(/\.$/, ''), name: c[1], forms_raw: c[2] || '', max, self, oblig, theory, practice, course, sem });
  }
  const nSem = Math.max(0, ...items.map(i => i.sem.length));
  items.forEach(i => { while (i.sem.length < nSem) i.sem.push(0); });
  items.forEach(i => { i.forms = mapForms(i); });
  return { title, nSem, items };
}

// Формы ПА перечислены через запятую по семестрам, в которых есть часы ("-, -, Э").
function mapForms(item) {
  const active = item.sem.map((h, i) => (h > 0 ? i : -1)).filter(i => i >= 0);
  const raw = item.forms_raw;
  const res = {};
  if (!raw || /^[-–]?\/?\d/.test(raw) && raw.includes('/')) return res; // сводная строка цикла "-/2/4/1"
  const parts = raw.split(',').map(s => s.trim()).filter(s => s.length);
  if (parts.length === active.length) parts.forEach((f, k) => { if (f !== '-' && f !== '–') res[active[k]] = f; });
  else if (parts.length === 1 && active.length) { if (parts[0] !== '-') res[active[active.length - 1]] = parts[0]; }
  else parts.forEach((f, k) => { if (k < active.length && f !== '-') res[active[k]] = f; });
  return res;
}

function semLabel(i, offset = 0) {
  return `${Math.floor(i / 2) + 1 + offset} курс, ${(i % 2) + 1} семестр`;
}

// Выбрать из плана всё, что относится к модулю ПМ.0N
function moduleFromPlan(plan, pmCode) {
  const n = pmCode.replace(/^ПМ\./, '');
  const pm = plan.items.find(i => i.index === pmCode);
  if (!pm) throw new Error(`В учебном плане не найден модуль ${pmCode}`);
  const mdk = plan.items.filter(i => i.index.startsWith(`МДК.${n}.`));
  const up = plan.items.filter(i => i.index === `УП.${n}` || i.index.startsWith(`УП.${n}.`));
  const pp = plan.items.filter(i => i.index === `ПП.${n}` || i.index.startsWith(`ПП.${n}.`));
  // Преддипломная практика ПДП.00 бывает включена в строку ПМ плана, но в программу модуля не входит:
  // если строка ПМ больше суммы МДК + УП + ПП ровно на часы ПДП по семестрам — они вычитаются из строки ПМ.
  const sumSem = items => Array.from({ length: plan.nSem }, (_, s) => items.reduce((a, i) => a + (i.sem[s] || 0), 0));
  const sumOf = (items, k) => items.reduce((a, i) => a + (i[k] || 0), 0);
  const parts = [...mdk, ...up, ...pp], pdp = plan.items.filter(i => /^ПДП(\.|$)/.test(i.index));
  const partSem = sumSem(parts), pdpSem = sumSem(pdp);
  let pmEff = pm;
  if (pdp.length && partSem.some((h, s) => h !== pm.sem[s]) && partSem.every((h, s) => h + pdpSem[s] === pm.sem[s])) {
    pmEff = { ...pm, sem: partSem, oblig: pm.oblig - sumOf(pdp, 'oblig'), max: pm.max - sumOf(pdp, 'max'), self: pm.self - sumOf(pdp, 'self'), practice: pm.practice - sumOf(pdp, 'practice'), pdp: pdp.map(i => i.index) };
  }
  const lastSem = pmEff.sem.reduce((a, h, i) => (h > 0 ? i : a), -1);
  return { pm: pmEff, mdk, up, pp, lastSem, nSem: plan.nSem };
}

// Строка учебной дисциплины (ОП.04, ОГСЭ.02, ЕН.01, ОД.01 …) из плана
function disciplineFromPlan(plan, code) {
  const it = plan.items.find(i => i.index === code);
  if (!it) throw new Error(`В учебном плане не найдена дисциплина ${code}`);
  return it;
}

function loadPlan(file) { return parsePlanText(fs.readFileSync(file, 'utf8')); }

module.exports = { parsePlanText, loadPlan, moduleFromPlan, disciplineFromPlan, semLabel, FORM_NAMES };
