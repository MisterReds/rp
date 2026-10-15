// Порядок занятий внутри тем и разбиение МДК по семестрам.
// Темы и практические работы задаются ПОП и не меняются; занятия идут парами по 2 ч.
'use strict';
const LESSON = 2;

// Распределить total единиц по весам (метод наибольших остатков), не меньше min на каждый элемент.
function distribute(total, weights, min = 1) {
  const n = weights.length;
  if (!n) return [];
  if (total < n * min) throw new Error(`нельзя распределить ${total} по ${n} элементам (минимум ${min} на элемент)`);
  const res = Array(n).fill(min);
  const rest = total - n * min;
  const W = weights.reduce((a, b) => a + b, 0) || n;
  const raw = weights.map(w => (W ? (w / W) * rest : rest / n));
  raw.forEach((x, i) => { res[i] += Math.floor(x); });
  let left = total - res.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { res[i] += 1; left -= 1; } });
  return res;
}

// Занятия темы по порядку: теория, а практические работы равномерно вставляются после теоретических занятий.
// Практическая работа на несколько пар выводится подряд с пометкой «часть k».
function themeLessons(th) {
  // явный перечень занятий (МДК, перенесённый из готового документа): [{k:'T'|'P', t:'название', h:2, att:true}]
  if (Array.isArray(th.lessons)) {
    const out = [];
    th.lessons.forEach((l, i) => {
      const k = Math.max(1, (l.h || LESSON) / LESSON);
      for (let j = 1; j <= k; j++) {
        if (l.k === 'T') out.push({ kind: 'T', title: l.t, att: !!l.att });
        else out.push({ kind: 'P', n: `${th.num || th.name || 'x'}#${i}`, title: l.t, part: j, parts: k });
      }
    });
    return out;
  }
  const T = th.theory || [];
  const W = th.works || [];
  const out = [];
  // subtitles — конкретные задания пар внутри одной работы ПОП («Название: задание» вместо «(часть k)»)
  const pairs = w => Array.from({ length: w.pairs }, (_, k) => ({ kind: 'P', n: w.n, title: w.title, part: k + 1, parts: w.pairs, sub: (w.subtitles || [])[k] }));
  if (!T.length) { W.forEach(w => out.push(...pairs(w))); return out; }
  const pos = W.map((w, j) => Math.ceil(((j + 1) * T.length) / W.length));
  T.forEach((t, i) => {
    out.push({ kind: 'T', title: t });
    W.forEach((w, j) => { if (pos[j] === i + 1) out.push(...pairs(w)); });
  });
  return out;
}

// Разбить занятия МДК по семестрам учебного плана. Тема, не уместившаяся в семестр, продолжается в следующем.
// Семестры, где зачёт (ДЗ/З) проводится последней парой МДК и входит в КТП (у МДК из готовой программы — как в документе)
const ATT_FORMS = ['ДЗ', 'З'];
const attSems = m => (m.custom ? [] : (m.sems || []).filter(s => ATT_FORMS.includes(s.form)).map(s => s.sem));
const ATT_TITLE = { 'ДЗ': 'Дифференцированный зачёт', 'З': 'Зачёт' };

function mdkBlocks(m) {
  const seq = (m.themes || []).flatMap((th, ti) => themeLessons(th).map(l => ({ ...l, ti })));
  const att = attSems(m);
  // каждая практическая пара — отдельная практическая работа со своим номером (сквозной внутри МДК)
  let pw = 0;
  seq.forEach(l => { if (l.kind === 'P') l.pw = ++pw; });
  let k = 0;
  let num = 0;
  const blocks = (m.sems || []).map(s => {
    const n = Math.max(0, (s.hours - (s.K || 0)) / LESSON);
    const isAtt = att.includes(s.sem);
    const items = seq.slice(k, k + n - (isAtt ? 1 : 0));
    k += n - (isAtt ? 1 : 0);
    if (isAtt) items.push({ kind: 'T', title: ATT_TITLE[s.form], att: true, ti: items.length ? items[items.length - 1].ti : (k < seq.length ? seq[k].ti : 0) });
    const groups = [];
    items.forEach(l => {
      l.num = ++num;
      const g = groups[groups.length - 1];
      if (g && g.ti === l.ti) g.lessons.push(l);
      else groups.push({ ti: l.ti, theme: m.themes[l.ti], cont: groups.length === 0 && l !== seq[0] && seq[seq.indexOf(l) - 1] && seq[seq.indexOf(l) - 1].ti === l.ti, lessons: [l] });
    });
    // пара зачёта идёт в часы того вида, из которых взята: у МДК без теории по плану — в практику
    const attP = x => x.att && !m.T;
    const T = items.filter(x => x.kind === 'T' && !attP(x)).length * LESSON;
    const P = items.filter(x => x.kind === 'P' || attP(x)).length * LESSON;
    return { ...s, T, P, groups, short: n - items.length };
  });
  return { blocks, total: seq.length + att.length, placed: Math.min(k, seq.length) };
}

// Подпись практического занятия: «Практическая работа № N. Название (часть k)»
function practiceLabel(l) {
  return `Практическая работа № ${l.pw}. ${pairTitle(l)}`;
}

function pairTitle(l) {
  const t = l.title.replace(/\.\s*$/, '');
  if (l.sub) return `${t}: ${l.sub}`;
  return `${t}${l.parts > 1 ? ` (часть ${l.part})` : ''}`;
}

// Номера практических работ (по парам) для каждой работы ПОП: { n: [pw, ...] }
function pwMap(m) {
  const map = {};
  mdkBlocks(m).blocks.forEach(b => b.groups.forEach(g => g.lessons.forEach(l => { if (l.kind === 'P') (map[l.n] = map[l.n] || []).push(l.pw); })));
  return map;
}

// Пункты производственной практики: строка = 1 день (6 ч) или [текст, часы] (часы кратны 6, как в программах практик техникума)
const PP_H = 6;
const ppItems = w => (w.days || []).map(d => (Array.isArray(d) ? [d[0], Number(d[1])] : [d, PP_H]));
const ppText = w => ppItems(w).map(x => x[0]);
const ppHours = w => ppItems(w).reduce((a, x) => a + x[1], 0);

module.exports = { attSems, ATT_FORMS, ppItems, ppText, ppHours, LESSON, distribute, themeLessons, mdkBlocks, practiceLabel, pairTitle, pwMap };
