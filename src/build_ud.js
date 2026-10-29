// Сборка документа «Рабочая программа учебной дисциплины + ФОС» по макету рабочей программы УД ГБПОУ «СПЭТ» («Топ-50»).
// Режим project.json: "kind": "ud". Сборка профессиональных модулей (src/build.js) этим файлом не затрагивается.
// Оформление (шрифт, поля, колонтитулы, таблицы) — те же хелперы, что у программы ПМ (src/docx_helpers.js).
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./docx_helpers.js');
const { D, mm, P_MARG, P_W, L_MARG, L_W, C, p, center, caption, h1, h2, h3, bullets, olist, cp, cell, table, hdr, simpleTable, widths } = H;
const { Document, Packer, Paragraph, TextRun, TableRow, Footer, PageNumber, AlignmentType, PageOrientation, VerticalAlign, BorderStyle } = D;
const { parseCodes } = require('./validate.js');
const { validateUd, examKeysUd, udBlocks } = require('./validate_ud.js');
const { LESSON, practiceLabel, pairTitle, srHours, srTasks, themeKey } = require('./sequence.js');

const LETTERS = ['а', 'б', 'в', 'г'];
const L = AlignmentType.LEFT;
const uniq = a => [...new Set(a)];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const FORM = {
  'Э': ['Э', 'экзамена', 'экзамен', 'экзамену'], 'ДЗ': ['ДЗ', 'дифференцированного зачёта', 'дифференцированный зачёт', 'дифференцированному зачёту'],
  'З': ['З', 'зачёта', 'зачёт', 'зачёту'], 'ДР': ['КР', 'контрольной работы', 'контрольная работа', 'контрольной работе'], 'КР': ['КР', 'контрольной работы', 'контрольная работа', 'контрольной работе'],
};
const formAbbr = f => (FORM[f] ? FORM[f][0] : f);
const formGen = f => (FORM[f] ? FORM[f][1] : f);
const formNom = f => (FORM[f] ? FORM[f][2] : f);
const formDat = f => (FORM[f] ? FORM[f][3] : f);

function ranges(nums) {
  const a = uniq(nums).sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j - i >= 2 ? `${a[i]}–${a[j]}` : (j > i ? `${a[i]}, ${a[j]}` : `${a[i]}`));
    i = j;
  }
  return out.join(', ');
}
const okStr = oks => (oks.length ? 'ОК ' + ranges(oks.map(x => Number(x.slice(3)))).replace(/\b(\d)\b/g, '0$1') : '');
const pkStr = pks => {
  if (!pks.length) return '';
  const byMod = {};
  pks.forEach(k => { const [a, b] = k.slice(3).split('.').map(Number); (byMod[a] = byMod[a] || []).push(b); });
  return 'ПК ' + Object.entries(byMod).map(([a, bs]) => ranges(bs).split(', ').map(r => r.split('–').map(x => `${a}.${x}`).join('–')).join(', ')).join(', ');
};
const endDot = s => (/[.!?…]$/.test(s.trim()) ? s.trim() : s.trim() + '.');
const semi = arr => arr.map((e, i, a) => e.replace(/[;.]\s*$/, '') + (i === a.length - 1 ? '.' : ';'));
const rightCap = t => p(t, { italics: true, size: 20, noIndent: true, align: AlignmentType.RIGHT, before: 120, after: 60, keepNext: true });
const underlined = (text, o = {}) => new Paragraph({ alignment: C, spacing: { before: o.before || 0, after: 0, line: 276 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } }, children: [H.run(text, { bold: o.bold })] });
// текст с переводами строк (код в вопросах, «Дано / Задание / Результат»): каждая строка — через разрыв строки внутри абзаца
const ml = (text, o = {}) => String(text).split('\n').flatMap((t, i) => (i ? [new TextRun({ break: 1 }), H.run(t, o)] : [H.run(t, o)]));
const olistMl = (items, size = 24) => { const ref = H.newListRef(); return items.map(t => new Paragraph({ numbering: { reference: ref, level: 0 }, children: ml(t, { size }), alignment: AlignmentType.LEFT, spacing: { line: 276 } })); };
const small = t => p(t, { italics: true, size: 20, noIndent: true, align: C, after: 200 });

function buildDocumentUd(ctx) {
  const pageBreak = ctx.project.tight_breaks ? () => new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' }, children: [new TextRun({ text: '', size: 2 }), new D.PageBreak()] }) : H.pageBreak;
  const { project: pj, fgos, vosp, pop, content: c } = ctx;
  const org = pj.org, ppl = pj.people || {};
  const u = c.ud, meta = c.meta;
  const spec = `${fgos.code} ${fgos.name}`;
  const udTitle = `${u.code} ${u.name}`;
  const udQ = `${u.code} «${u.name}»`;
  const OK = fgos.ok.filter(x => meta.ok.includes(x[0]));
  const OK_CODES = OK.map(x => x[0]);
  const PK = meta.pk;
  const LR = vosp.lr;
  const okLr = require('./lr.js').okLrOf(vosp, pj);
  const lrFromOk = oks => uniq(oks.flatMap(o => okLr[o] || [])).filter(n => LR[n]).sort((a, b) => a - b);
  // ЛР документа — только соответствующие ОК модуля/дисциплины (Таблица 3 программы воспитания): объединение ok_lr по ОК, по возрастанию
  const LR_ALL = require('./lr.js').lrSet(OK_CODES, okLr, LR);
  const lrStr = arr => (arr.length ? 'ЛР ' + ranges(arr) : '');
  const codesBlock = (pk, ok, lr) => [okStr(ok), pkStr(pk), lrStr(lr)].filter(Boolean);
  const themeCodes = th => parseCodes(th.codes);
  const B = udBlocks(u);
  const blocks = B.blocks;
  const sumT = blocks.reduce((a, b) => a + b.T, 0), sumP = blocks.reduce((a, b) => a + b.P, 0), sumS = srHours(u);
  const total = sumT + sumP + sumS;
  const hasSr = sumS > 0;
  const fos = c.fos, prog = c.program || {};
  const formsText = u.sems.filter(s => s.form).map(s => `${formGen(s.form)} (${s.label})`).join(' и ') || 'не предусмотрена';
  const forms = uniq(u.sems.map(s => s.form).filter(Boolean));
  const ek = examKeysUd(u);
  const allLessons = blocks.flatMap(b => b.groups.flatMap(g => g.lessons));
  const practical = allLessons.filter(l => l.kind === 'P');

  // ---------- титульный лист (макет УД: «Рабочая программа УЧЕБНОЙ ДИСЦИПЛИНЫ») ----------
  const titlePage = [
    center(org.ministry.toUpperCase()),
    center(`ГБПОУ ${org.name}`, { bold: true, after: 3000 }),
    center('Рабочая программа УЧЕБНОЙ ДИСЦИПЛИНЫ', { bold: true, size: 28, after: 360 }),
    underlined(udTitle, { bold: true }),
    p('код и наименование учебной дисциплины', { italics: true, size: 20, noIndent: true, align: C, after: 480 }),
    center(`ДЛЯ СТУДЕНТОВ ГРУППЫ ${pj.group}`, { bold: true }),
    center('ОБУЧАЮЩИХСЯ ПО СПЕЦИАЛЬНОСТИ', { bold: true, after: 120 }),
    underlined(spec, { bold: true }),
    p('Код и наименование специальности', { italics: true, size: 20, noIndent: true, align: C, after: 4400 }),
    center(`г. ${org.city}, ${pj.year} год`),
    pageBreak(),
  ];
  const back = [
    p(`Составлена в соответствии с Федеральным государственным образовательным стандартом среднего профессионального образования (далее ФГОС СПО), утвержденным ${fgos.order_by} приказом от ${fgos.order_date} и зарегистрированным в Минюсте России ${fgos.minjust}, по специальности ${spec}, а также Методическими указаниями ${org.short} и на основе примерной программы, а также с учетом`, { after: 120 }),
    p('– требований технического описания компетенции в рамках конкурса профессионального мастерства «Профессионалы»:', { after: 120 }),
    center(pj.competence || '', { bold: true, after: 480 }),
    p(`Рассмотрено на заседании ПЦК ${pj.pcc || ''}`, { noIndent: true }),
    p('Протокол № ___  от ____________ г.', { noIndent: true }),
    p(`ППЦК __________ ${ppl.pcc_head || 'Ф.И.О.'}`, { noIndent: true, after: 360 }),
    p('Рассмотрено на заседании', { noIndent: true }),
    p(`Методического совета ${org.short}`, { noIndent: true }),
    p('Протокол № _____  от _____________ г.', { noIndent: true }),
    p(`Председатель МС ________ ${ppl.ms_head || 'Ф.И.О.'}`, { noIndent: true, after: 360 }),
    p('Составитель:', { noIndent: true }),
    p(`${ppl.developer || 'Ф.И.О., преподаватель ' + org.short}`, { noIndent: true }),
    pageBreak(),
  ];

  // ---------- раздел 1 ----------
  const w2 = widths(P_W, [25, 0], 1);
  const hasNav = Object.values((pop.results || {}).ok || {}).concat(Object.values((pop.results || {}).pk || {})).some(x => (x.nav || []).length);
  const wideFirst = pop._source_kind === 'poop_spo'; // ПООП СПО: одна общая строка с кодами и расшифровкой ОК/ПК — первый столбец шире
  const wR = hasNav ? widths(P_W, [34, 0, 0, 0], 1) : widths(P_W, [wideFirst ? 56 : 34, 0, 0], 1);
  { const rest = P_W - wR[0]; const k = wR.length - 1; for (let i = 1; i < wR.length; i++) wR[i] = i < wR.length - 1 ? Math.floor(rest / k) : rest - Math.floor(rest / k) * (k - 1); }
  const listCell = (items, w) => cell((items || []).map((t, i, a) => t.replace(/[;.]\s*$/, '') + (i === a.length - 1 ? '.' : ';')), w);
  const resRow = (k, name, r) => new TableRow({ children: [cell(`${k}. ${name}`, wR[0]), listCell(r.um, wR[1]), listCell(r.zn, wR[2]), ...(hasNav ? [listCell(r.nav, wR[3])] : [])] });
  // ПОП, где одна строка таблицы результатов относится сразу к нескольким кодам (pop.results_shared): одна строка с общими умениями и знаниями
  const resRowShared = (codes, r) => new TableRow({ children: [cell(codes.map(([k, n]) => cp(`${k}. ${n}`)), wR[0]), listCell(r.um, wR[1]), listCell(r.zn, wR[2]), ...(hasNav ? [listCell(r.nav, wR[3])] : [])] });
  const resultsTable = table(wR, [hdr(['Код и расшифровка ОК, ПК', 'Умения', 'Знания', ...(hasNav ? ['Владеть навыками'] : [])], wR),
    ...(pop.results_shared
      ? [resRowShared([...OK, ...PK], (OK.length ? pop.results.ok[OK[0][0]] : pop.results.pk[PK[0][0]]) || {})]
      : [...OK.map(([k, n]) => resRow(k, n, pop.results.ok[k] || {})),
        ...PK.map(([k, n]) => resRow(k, n, pop.results.pk[k] || {}))])]);

  // 1.3 распределение часов по семестрам (макет: 8 столбцов семестров)
  const lastSem = Math.max(...u.sems.map(s => s.sem), meta.exam_sem);
  const nS = Math.max(8, lastSem + 1);
  const w13 = [mm(26), 0, ...Array(nS).fill(mm(11)), mm(16)];
  w13[1] = P_W - w13.reduce((a, b) => a + b, 0);
  const semCells = (vals, o = {}) => Array.from({ length: nS }, (_, i) => cell(vals[i] === undefined || vals[i] === null ? '' : String(vals[i]), w13[2 + i], { align: C, ...o }));
  const labelW = w13[0] + w13[1];
  const row13 = (label, vals, tot, o = {}) => new TableRow({ children: [cell(label, labelW, { colSpan: 2, ...o }), ...semCells(vals, o), cell(tot === undefined ? '' : String(tot), w13[2 + nS], { align: C, ...o })] });
  const sub13 = (label, vals, tot, first, span) => new TableRow({ children: [...(first ? [cell('В том числе:', w13[0], { rowSpan: span, vAlign: VerticalAlign.CENTER })] : []), cell(label, w13[1], {}), ...semCells(vals), cell(String(tot), w13[2 + nS], { align: C })] });
  const bySem = f => { const a = []; blocks.forEach(b => { a[b.sem] = f(b); }); return a; };
  const oblig = bySem(b => b.T + b.P);
  const rows13 = [
    new TableRow({ tableHeader: true, children: [cell('Нагрузка обучающегося', labelW, { bold: true, align: C, rowSpan: 2, colSpan: 2, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' }), cell('Номер семестра', w13.slice(2, 2 + nS).reduce((a, b) => a + b, 0), { bold: true, align: C, colSpan: nS, shade: 'EDEDED' }), cell('Всего часов', w13[2 + nS], { bold: true, align: C, rowSpan: 2, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' })] }),
    new TableRow({ tableHeader: true, children: Array.from({ length: nS }, (_, i) => cell(String(i + 1), w13[2 + i], { bold: true, align: C, shade: 'EDEDED' })) }),
    row13(`УД ${udQ}`, bySem(b => b.T + b.P + b.S), total, { bold: true }),
    row13('Обязательной аудиторной учебной нагрузки', oblig, sumT + sumP),
    sub13('Теоретических занятий', bySem(b => b.T), sumT, true, 2),
    sub13('Практических занятий', bySem(b => b.P), sumP, false),
    row13('Самостоятельной работы', hasSr ? bySem(b => b.S) : [], hasSr ? sumS : '—'),
    row13(`Промежуточная аттестация в форме ${formsText}`, bySem(b => (b.form ? formAbbr(b.form) : '')), '', { italics: true }),
  ];

  const sec1 = [
    h1('1. Общая характеристика рабочей программы учебной дисциплины'),
    h2('1.1. Место учебной дисциплины в структуре программы подготовки специалистов среднего звена'),
    p(pop.place),
    h2('1.2. Цели и планируемые результаты освоения учебной дисциплины'),
    ...(pop.goal ? [p(pop.goal)] : []), // в ПООП СПО цели дисциплины нет
    p(`${pop.results_intro ? pop.results_intro + ' ' : ''}В результате освоения дисциплины обучающийся должен:`),
    rightCap('Таблица 1'),
    resultsTable,
    p('В процессе изучения дисциплины обучающийся должен достигать следующих личностных результатов в соответствии с программой воспитания по специальности:', { before: 160 }),
    underlined(spec),
    small('Код и наименование специальности'),
    rightCap('Таблица 2'),
    table(w2, [hdr(['Код ЛР из программы воспитания', 'Наименование личностных результатов'], w2), ...LR_ALL.map(n => new TableRow({ children: [cell('ЛР ' + n, w2[0]), cell(LR[n], w2[1])] }))]),
    p(`Источник: ${vosp.title}.`, { size: 22, noIndent: true, before: 80 }),
    h2('1.3. Распределение часов, отводимых на освоение учебной дисциплины, по семестрам'),
    table(w13, rows13),
    ...(sumT !== u.T || sumP !== u.P ? [p(`Примечание. Деление часов на теоретические и практические занятия приведено по календарно-тематическому плану (п. 2.2): теоретических ${sumT} ч, практических ${sumP} ч; по учебному плану группы ${pj.group} — теоретических ${u.T} ч, практических ${u.P} ч. Общий объём (${total} ч) совпадает.`, { size: 22, noIndent: true, before: 80 })] : []),
  ];

  // ---------- раздел 2 ----------
  const w21 = widths(P_W, [45, 0], 1);
  const rows21 = [
    ['Объем образовательной программы', String(total), { bold: true }], ['в том числе:', '', {}],
    ['теоретические занятия (лекции, семинары)', String(sumT), {}], ['практические занятия (лабораторно-практические занятия)', String(sumP), {}],
    ['Самостоятельная работа', hasSr ? String(sumS) : 'учебным планом не предусмотрена', {}],
    [`Промежуточная аттестация в форме ${formsText}`, '', { italics: true }],
  ];
  const wC = widths(L_W, [55, 0, 20, 42], 1);
  const span2 = wC[0] + wC[1];
  const fullRow = (text, o = {}) => new TableRow({ children: [cell(text, L_W, { colSpan: 4, ...o })] });
  const lineRow = (text, hours, o = {}) => new TableRow({ children: [cell(text, span2, { colSpan: 2, ...o }), cell(hours === undefined ? '' : String(hours), wC[2], { align: C, ...o }), cell(o.codes || '', wC[3])] });
  const srRowList = e => [['Самостоятельная работа обучающихся' + ((e.intro || srTasks(e).length) ? ':' : ''), Number(e.hours) || 0, true],
    ...(e.intro ? [[e.intro, 0, false]] : []), ...srTasks(e).map(([t, h], i) => [`${i + 1}) ${t}`, h, false])];
  const srRows = e => srRowList(e).map(([t, h, bold]) => new TableRow({ children: [cell([cp(t, bold ? { bold: true } : {})], wC[1]), cell(h ? String(h) : '', wC[2], { align: C, ...(bold ? { bold: true } : {}) })] }));
  const ktpRows = [hdr(['Наименование разделов и тем', 'Содержание учебного материала, практические занятия, самостоятельная работа обучающихся', 'Объем в часах', 'Коды компетенции, формированию которых способствует элемент программы'], wC),
    new TableRow({ tableHeader: true, children: ['1', '2', '3', '4'].map((t, i) => cell(t, wC[i], { align: C })) })];
  let curSection = null;
  blocks.forEach((b, bi) => {
    ktpRows.push(fullRow(b.label, { bold: true, align: C, shade: 'F2F2F2' }));
    ktpRows.push(fullRow(`теор- ${b.T} ч, п/р- ${b.P} ч, с/р ${b.S} ч`, { bold: true, align: C }));
    b.groups.forEach(g => {
      const th = g.theme;
      if (th.section && th.section !== curSection) {
        curSection = th.section;
        const sth = u.themes.filter(t => t.section === th.section);
        const sh = sth.reduce((a, t) => a + t.lessons.reduce((b2, l) => b2 + l.h, 0), 0);
        const sp = uniq(sth.flatMap(t => themeCodes(t).pk)), so = uniq(sth.flatMap(t => themeCodes(t).ok));
        ktpRows.push(new TableRow({ children: [cell(th.section, span2, { colSpan: 2, bold: true }), cell(String(sh), wC[2], { bold: true, align: C }), cell(codesBlock(sp, so, lrFromOk(so)), wC[3])] }));
      }
      const x = themeCodes(th);
      const gSr = (b.sr || []).filter(e => themeKey(e.theme) === themeKey(th.num) && themeKey(th.num) && b.groups.filter(y => y.theme === th).pop() === g);
      const span = 1 + g.lessons.length + gSr.reduce((a, e) => a + srRowList(e).length, 0);
      const thHours = g.lessons.length * LESSON;
      ktpRows.push(new TableRow({ children: [
        cell([cp(`${th.num || ''} ${th.name || ''}`.trim(), { bold: true })], wC[0], { rowSpan: span }),
        cell([cp('Содержание (перечень дидактических единиц по Теме)' + (g.cont ? ' — продолжение темы' : ''), { bold: true }), ...(th.content || []).map((t, i) => cp(`${i + 1}. ${t}`))], wC[1]),
        cell(String(thHours), wC[2], { bold: true, align: C }),
        cell(codesBlock(x.pk, x.ok, lrFromOk(x.ok)), wC[3], { rowSpan: span }),
      ] }));
      g.lessons.forEach(l => ktpRows.push(new TableRow({ children: [cell(`${l.num}. ${l.kind === 'T' ? l.title : practiceLabel(l)}`, wC[1]), cell(String(LESSON), wC[2], { align: C })] })));
      gSr.forEach(e => ktpRows.push(...srRows(e)));
    });
    (b.sr || []).filter(e => !themeKey(e.theme) || !b.groups.some(g => themeKey(g.theme.num) === themeKey(e.theme))).forEach(e => {
      const rr = srRowList(e);
      rr.forEach(([t, h, bold], i) => ktpRows.push(new TableRow({ children: [
        ...(i === 0 ? [cell([cp(e.title || 'Внеаудиторная самостоятельная работа', { bold: true })], wC[0], { rowSpan: rr.length })] : []),
        cell([cp(t, bold ? { bold: true } : {})], wC[1]), cell(h ? String(h) : '', wC[2], { align: C, ...(bold ? { bold: true } : {}) }),
        ...(i === 0 ? [cell('', wC[3], { rowSpan: rr.length })] : []),
      ] })));
    });
    if (bi === blocks.length - 1 && !hasSr) ktpRows.push(lineRow('Самостоятельная работа обучающихся: учебным планом не предусмотрена', '—'));
    const attInside = b.groups.some(g => g.lessons.some(l => l.att));
    if (b.form && !attInside) ktpRows.push(lineRow(`Промежуточная аттестация в форме ${formGen(b.form)}`, '—', { italics: true }));
  });
  ktpRows.push(lineRow(`Всего по ${u.code}`, total, { bold: true }));
  const sec2 = [
    h1('2. Структура и содержание программы учебной дисциплины:'),
    h2('2.1. Объем учебной дисциплины и виды учебной работы'),
    table(w21, [hdr(['Вид учебной работы', 'Объем в часах'], w21), ...rows21.map(([a, b, o]) => new TableRow({ children: [cell(a, w21[0], o), cell(b, w21[1], { align: C, ...o })] }))]),
    h2('2.2. Тематический план и содержание учебной дисциплины'),
    table(wC, ktpRows),
  ];

  // ---------- раздел 3 ----------
  const cabRoom = pop.rooms.find(r => /Кабинет/.test(r)) || '';
  const cabName = (cabRoom.match(/«([^»]+)»/) || cabRoom.match(/^Кабинет\S*\s+(.+?),?\s+оснащ/) || [])[1] || '';
  const labName = (((pop.rooms.find(r => /Лаборатор/.test(r)) || '').match(/^Лаборатори[а-я]*\s+(.+?),?\s+оснащ/) || [])[1] || '').replace(/[«»]/g, '');
  const eq = (prog.conditions || {}).equipment || {};
  const lit = pop.literature_main || [];
  const litAdd = pop.literature_add || [];
  const elRes = (prog.electronic || []);
  const sec3 = [
    h1('3. Условия реализации программы учебной дисциплины'),
    h2('3.1. Для реализации программы учебной дисциплины должны быть предусмотрены следующие специальные помещения:'),
    ...bullets(semi(pop.rooms)),
    ...(cabName ? [p(`Реализация программы дисциплины требует наличия учебного кабинета «${cabName}».`, { before: 120 })] : []), // ПООП СПО: кабинета нет, только лаборатория — она названа в списке помещений
    p(`Помещение ${cabName ? 'кабинета' : 'лаборатории'} должно соответствовать требованиям санитарных правил (СП 2.4.3648-20 "Санитарно-эпидемиологические требования к организациям воспитания и обучения, отдыха и оздоровления детей и молодежи"): оснащено типовым оборудованием, в том числе специализированной учебной мебелью и средствами обучения, необходимыми для выполнения требований к уровню подготовки обучающихся.`),
    ...(cabName ? [p('Оборудование учебного кабинета:', { bold: true, keepNext: true, before: 120 }),
      ...bullets(semi(eq.cabinet || [])),
      p('В случае необходимости:', { bold: true, keepNext: true, before: 120 })] : []),
    p(`Лаборатория «${labName}» оснащенная необходимым для реализации программы учебной дисциплины оборудованием:`, { keepNext: true, ...(cabName ? {} : { before: 120 }) }),
    ...bullets(semi(eq.lab || [])),
    p('Технические средства обучения:', { bold: true, keepNext: true, before: 120 }),
    ...bullets(semi(['персональный компьютер с лицензионным программным обеспечением (Операционная система Windows, текстовый процессор MS Word, программа презентаций MS Power Point, программа браузер с доступ в Интернет)', 'проектор с экраном', ...((prog.conditions || {}).software || [])])),
    p('Залы:', { bold: true, keepNext: true, before: 120 }),
    ...bullets(['Библиотека, с выходом в сеть Интернет.']),
    h2('3.2. Информационное обеспечение реализации программы'),
    p('Для реализации программы библиотечный фонд образовательной организации должен иметь печатные и/или электронные образовательные и информационные ресурсы, рекомендуемых для использования в образовательном процессе.'),
    h3('3.2.1. Печатные издания'),
    ...olist(lit),
    h3('3.2.2. Электронные издания (электронные ресурсы)'),
    ...(elRes.length ? olist(elRes) : [p('[проверить] Перечень электронных изданий и ресурсов в примерной программе не приведён — указать по данным библиотеки техникума.')]),
    h3('3.2.3. Дополнительные источники'),
    ...(litAdd.length ? olist(litAdd) : [p('[проверить] Дополнительные источники в примерной программе не приведены — указать по данным библиотеки техникума.')]),
    h2('3.3. Кадровое обеспечение образовательного процесса'),
    p('Квалификация педагогических работников образовательной организации должна отвечать квалификационным требованиям, указанным в квалификационных справочниках, и (или) профессиональных стандартах (при наличии).'),
    p(`Педагогические работники, привлекаемые к реализации образовательной программы, должны получать дополнительное профессиональное образование по программам повышения квалификации, в том числе в форме стажировки в организациях, направление деятельности которых соответствует области профессиональной деятельности ${fgos.professional_area}, указанной в ФГОС СПО по специальности ${spec}, не реже 1 раза в 3 года с учетом расширения спектра профессиональных компетенций.`),
  ];

  // ---------- раздел 4 ----------
  const ctl = prog.control || {};
  const w41 = widths(P_W, [30, 0, 58, 38], 1);
  const hasCw = (fos.control_works || {})[u.code] || forms.some(f => ['ДР', 'КР'].includes(f));
  const methodsOf = a => {
    const own = (a.methods || []).filter(m => (hasCw || !/^контрольная работа/i.test(m)) && !/проект/i.test(m));
    const extra = /знает|знани/i.test(a.kind)
      ? [`Тестирование (п. 5.1.4)${forms.includes('Э') ? '; ответ на теоретические вопросы билета на экзамене (п. 5.2.3)' : ''}.`]
      : [`Выполнение и защита практических работ (п. 5.1.1)${forms.includes('Э') ? '; практическое задание на экзамене (п. 5.2.4)' : ''}.`];
    return [...own.map(endDot), ...extra];
  };
  const evalRows = [new TableRow({ tableHeader: true, children: [cell('Результаты обучения', w41[0] + w41[1], { bold: true, align: C, colSpan: 2, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' }), cell('Критерии оценки', w41[2], { bold: true, align: C, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' }), cell('Методы оценки', w41[3], { bold: true, align: C, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' })] }),
    ...(pop.assessment || []).map(a => new TableRow({ children: [
      cell([...OK_CODES, ...PK.map(x => x[0])].join(', '), w41[0], {}),
      cell([cp(a.kind, { bold: true }), ...a.results.map(t => cp(t))], w41[1]),
      cell(a.criteria, w41[2]), cell(methodsOf(a), w41[3]),
    ] }))];
  const lrMeth = prog.lr_methods || {};
  const w42 = widths(P_W, [22, 0, 70], 1);
  const lrRows = LR_ALL.map(n => {
    const oks = OK_CODES.filter(o => (okLr[o] || []).includes(n));
    const meth = oks.map(o => `${o}: ${lrMeth[o] || ''}`);
    return new TableRow({ children: [cell('ЛР ' + n, w42[0]), cell(LR[n], w42[1]), cell(meth, w42[2])] });
  });
  const attWhat = forms.length ? forms.map(f => formNom(f)).join(', ') : 'не предусмотрена';
  const sec4 = [
    h1('4. Контроль и оценка результатов освоения программы учебной дисциплины:'),
    h2('4.1. Контроль и оценка результатов освоения учебной дисциплины'),
    p(`${udQ} включает текущий контроль успеваемости и промежуточную аттестацию.`),
    p(`Текущий контроль успеваемости осуществляется в форме ${ctl.current || 'устного опроса, тестирования, выполнения и защиты практических работ'}.`),
    p('В основе текущего контроля используется пятибалльная шкала оценки («5» отлично, «4» хорошо, «3» удовлетворительно, «2» неудовлетворительно).'),
    p('Формы и методы текущего контроля по учебной дисциплине доводятся до сведения обучающихся в начале изучения дисциплины.'),
    p('К рабочей программе разработан фонд оценочных средств (ФОС), который включает в себя контрольно-измерительные материалы (КИМы), предназначенные для оценки результатов обучения.'),
    p(`Промежуточная аттестация (${forms.map(formAbbr).join(', ') || '—'}) осуществляется в форме ${u.sems.filter(s => s.form).map(s => (s.form === 'Э' ? `${formGen('Э')} (${s.label}) по билетам: два теоретических вопроса и практическое задание` : `${formGen(s.form)} (${s.label})`)).join('; ') || 'не предусмотрена'}.`),
    ...(hasSr ? [] : [p('Самостоятельная внеаудиторная работа учебным планом не предусмотрена.')]),
    rightCap('Таблица 3'),
    table(w41, evalRows),
    rightCap('Таблица 4. Личностные результаты реализации программы воспитания'),
    table(w42, [hdr(['Код ЛР', 'Личностные результаты реализации программы воспитания', 'Методы и формы обучения, способствующие достижению обучающимися ЛР'], w42), ...lrRows]),
  ];

  // ---------- раздел 5: ФОС ----------
  const crit5 = rows => simpleTable(widths(P_W, [45, 0], 1), ['Оценка', 'Критерий'], rows);
  const prCrit = crit5([
    ['5 «отлично»', prog.pr_criteria5 || 'Работа выполнена полностью, программа запускается и даёт верный результат на всех тестовых данных, код оформлен по стандарту кодирования, на контрольные вопросы даны полные ответы'],
    ['4 «хорошо»', 'Работа выполнена полностью, допущены 1–2 несущественные ошибки или недочёты в оформлении, исправленные после замечания'],
    ['3 «удовлетворительно»', 'Работа выполнена не менее чем на 60 %, основной результат достигнут, ответы на вопросы неполные'],
    ['2 «неудовлетворительно»', 'Работа выполнена менее чем на 60 % или результат не достигнут']]);
  const testScale = simpleTable(widths(P_W, [70, 0], 1), ['Доля верных ответов, %', 'Оценка'], [['90–100', '5 «отлично»'], ['75–89', '4 «хорошо»'], ['60–74', '3 «удовлетворительно»'], ['менее 60', '2 «неудовлетворительно»']], { center: [0, 1] });
  const examCrit = (name) => crit5([
    ['5 «отлично»', 'Полные ответы на оба теоретических вопроса; практическое задание выполнено полностью, результат верный'],
    ['4 «хорошо»', 'Ответы с несущественными неточностями; практическое задание выполнено с 1–2 ошибками, исправленными самостоятельно'],
    ['3 «удовлетворительно»', 'Ответ на один вопрос полный, на второй — частичный; практическое задание выполнено не менее чем на 60 %'],
    ['2 «неудовлетворительно»', 'Ответы отсутствуют или содержат грубые ошибки; практическое задание не выполнено']]);
  const keyTable = T => {
    const half2 = Math.ceil(T.length / 2); const w = Array(4).fill(Math.floor(P_W / 4));
    const r = [];
    for (let i = 0; i < half2; i++) { const a = T[i], b = T[i + half2]; r.push(new TableRow({ children: [cell(String(i + 1), w[0], { align: C }), cell(LETTERS[a.answer], w[1], { align: C }), cell(b ? String(i + half2 + 1) : '', w[2], { align: C }), cell(b ? LETTERS[b.answer] : '', w[3], { align: C })] })); }
    return table(w, [hdr(['№ вопроса', 'Ответ', '№ вопроса', 'Ответ'], w), ...r]);
  };
  // билет по структуре макета: шапка, номер билета, вопросы 1–2, практическое задание 3 (без эталона «Результат»), подписи — отдельными строками
  const ticket = (label, ex, form) => {
    const task = String(ex.tasks[0]).split('\n').filter(l => !/^Результат:/.test(l));
    const row = (lines, o = {}) => new TableRow({ children: [cell(lines, P_W, o)] });
    return table([P_W], [
      row([org.short, udTitle, `Специальность ${spec}, группа ${pj.group}, ${label}`], { align: C }),
      row([form === 'Э' ? 'ЭКЗАМЕНАЦИОННЫЙ БИЛЕТ № 1' : 'БИЛЕТ № 1'], { align: C, bold: true, shade: 'F2F2F2' }),
      row([`1. ${ex.questions[0]}`]), row([`2. ${ex.questions[Math.floor(ex.questions.length / 2)]}`]),
      row([`3. Практическое задание: ${task[0]}`, ...task.slice(1)]),
      row(['Время на подготовку — 30 минут, на выполнение практического задания — 30 минут.'], { italics: true }),
      row(['Преподаватель ____________ /____________/', 'Председатель ПЦК ____________ /____________/']),
    ]);
  };
  const w511 = widths(P_W, [32, 0], 1);
  const sub = t => p(t, { bold: true, italics: true, noIndent: true, before: 160, after: 80, keepNext: true });
  const hasKtpCw = allLessons.some(l => /контрольн/i.test(l.title || ''));
  const attOf = f => ek.filter(x => (f === 'ДЗ' ? ['ДЗ', 'З'].includes(x.form) : x.form === f));
  const tickets = (list, listCap, tasksCap) => list.flatMap(x => {
    const ex = (fos.exams || {})[x.key] || { questions: [], tasks: [] };
    return [...(list.length > 1 ? [sub(`${cap(x.label)}`)] : []), ...(listCap ? [caption(listCap(x)), ...olistMl(ex.questions)] : []), ...(tasksCap ? [caption(tasksCap(x)), ...olistMl(ex.tasks)] : [])];
  });
  const f5 = [h1('5. Фонд оценочных средств'),
    h2('5.1. Контрольно-измерительные материалы для проведения текущего контроля'),
    h3('5.1.1. Перечень практических работ'),
    ...(practical.length ? [table(w511, [hdr(['№ практической работы', 'Тема практической работы'], w511), ...practical.map(l => new TableRow({ children: [cell(l.nopoop ? 'занятие ' + l.pw : String(l.pw), w511[0], { align: C }), cell(pairTitle(l), w511[1])] }))]),
      caption('Критерии оценки практической работы'), prCrit] : [p('Практические работы календарно-тематическим планом не предусмотрены.')]),
    h3('5.1.2. Перечень самостоятельных внеаудиторных работ'),
    ...(hasSr ? [table(w511, [hdr(['№ самостоятельной внеаудиторной работы', 'Задание СВР в соответствии с п. 2.2 КТП'], w511), ...(u.sr || []).flatMap(e => (srTasks(e).length ? srTasks(e).map(x => x[0]) : [e.intro || 'Самостоятельная работа']).map(t => t)).map((t, i) => new TableRow({ children: [cell(String(i + 1), w511[0], { align: C }), cell(t, w511[1])] }))])]
      : [p('Самостоятельная внеаудиторная работа учебным планом группы ' + pj.group + ' не предусмотрена.')]),
    h3('5.1.3. Контрольные работы'),
    p(hasKtpCw ? 'Контрольные работы проводятся по календарно-тематическому плану (п. 2.2).' : 'Контрольные работы календарно-тематическим планом (п. 2.2) не предусмотрены.'),
    h3('5.1.4. Тестирование'),
    p(`Тестирование проводится по завершении изучения тем ${prog.test_where || 'в электронной среде (СДО Moodle) или на бланке'}; время — 1 минута на вопрос. Каждое задание имеет один правильный ответ и оценивается в 1 балл. Всего в банке — ${fos.tests.length} вопросов; обучающемуся выдаётся выборка по темам.`),
    caption('Шкала оценки тестирования'), testScale];
  const thNames = i => `${u.themes[i].num} ${(u.themes[i].name || '').replace(/\.\s*$/, '')}`.trim();
  let qn = 0;
  const ordered = u.themes.flatMap((t, i) => fos.tests.filter(q => q.t === i + 1));
  u.themes.forEach((t, i) => {
    const T = fos.tests.filter(q => q.t === i + 1);
    if (!T.length) return;
    f5.push(sub(thNames(i)), ...T.flatMap(q => { qn += 1; return [p(ml(`${qn}. ${q.q}`), { noIndent: true, align: L, before: 80, keepNext: true }), p(q.options.map((o, j) => `${LETTERS[j]}) ${o}`).join('    '), { noIndent: true, indent: { left: mm(6) } })]; }));
  });
  f5.push(caption('Ключ к тесту'), keyTable(ordered));
  f5.push(h2('5.2. Контрольно-измерительные материалы для проведения промежуточной аттестации'),
    h3('5.2.1. Контрольная работа'));
  if (hasCw) {
    const cw = (fos.control_works || {})[u.code];
    f5.push(p(`Форма — контрольная работа. Работа выполняется письменно, время — ${(cw && cw.minutes) || 90} минут; ${cw ? cw.variants.length : 4} варианта одинаковой сложности.`));
    if (cw) { cw.variants.forEach((v, i) => f5.push(p(`Вариант ${i + 1}`, { bold: true, noIndent: true, before: 160, keepNext: true }), ...v.tasks.map((t, j) => p(ml(`Задание ${j + 1}. ${t}`), { noIndent: true, align: L })))); f5.push(p('Эталоны ответов', { bold: true, noIndent: true, before: 160, keepNext: true }), ...cw.variants.map((v, i) => p(`Вариант ${i + 1}. ${v.answer}`, { noIndent: true }))); }
  } else f5.push(p('Контрольная работа как форма промежуточной аттестации учебным планом не предусмотрена.'));
  f5.push(h3('5.2.2. Вопросы к дифференцированному зачёту'));
  if (attOf('ДЗ').length) f5.push(p('Дифференцированный зачёт проводится по билетам: два теоретических вопроса и одно практическое задание.'), ...tickets(attOf('ДЗ'), x => `Вопросы к ${formDat(x.form)}`, x => `Типы практических задач к ${formDat(x.form)}`), caption('Образец билета'), ticket(attOf('ДЗ')[0].label, (fos.exams || {})[attOf('ДЗ')[0].key], 'ДЗ'), caption('Критерии оценки'), examCrit());
  else f5.push(p('Дифференцированный зачёт и зачёт учебным планом группы ' + pj.group + ' не предусмотрены.'));
  f5.push(h3('5.2.3. Вопросы к экзамену'));
  if (attOf('Э').length) f5.push(p('Экзамен проводится по билетам: два теоретических вопроса и одно практическое задание. Критерии оценки — п. 5.2.4.'), ...tickets(attOf('Э'), x => 'Вопросы к экзамену', null));
  else f5.push(p('Экзамен учебным планом группы ' + pj.group + ' не предусмотрен.'));
  f5.push(h3('5.2.4. Типы практических задач к экзамену'));
  if (attOf('Э').length) f5.push(...tickets(attOf('Э'), null, x => 'Типы практических задач к экзамену'), caption('Образец экзаменационного билета'), ticket(attOf('Э')[0].label, (fos.exams || {})[attOf('Э')[0].key], 'Э'), caption('Критерии оценки на экзамене'), examCrit());
  else f5.push(p('Экзамен учебным планом группы ' + pj.group + ' не предусмотрен.'));

  const footer = () => new Footer({ children: [new Paragraph({ alignment: C, children: [new TextRun({ font: H.FONT, size: 22, children: [PageNumber.CURRENT] })] })] });
  const portrait = { page: { size: { width: 11906, height: 16838 }, margin: P_MARG } };
  const landscape = { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: L_MARG } };
  const doc = new Document({
    creator: org.short, title: `Рабочая программа ${udTitle}`,
    styles: H.styles(), numbering: H.numberingConfig(),
    sections: [
      { properties: { ...portrait, titlePage: true }, footers: { default: footer(), first: new Footer({ children: [new Paragraph('')] }) }, children: [...titlePage, ...back, ...sec1] },
      { properties: { ...landscape }, footers: { default: footer() }, children: sec2 },
      { properties: { ...portrait }, footers: { default: footer() }, children: [...sec3, pageBreak(), ...sec4, pageBreak(), ...f5] },
    ],
  });
  return { doc };
}

async function buildUd(ctx, opts = {}) {
  if (!ctx.content) throw new Error(`Нет файла наполнения ${ctx.contentPath}. Сначала выполните init и fill.`);
  if (!ctx.pop) throw new Error('В project.json не указан файл ПОП (поле "pop").');
  const v = validateUd(ctx.content, { pop: ctx.pop, plan: ctx.plan, fgos: ctx.fgos });
  v.warnings.forEach(w => console.log('  предупреждение:', w));
  if (v.errors.length && !opts.force) {
    v.errors.forEach(e => console.log('  ОШИБКА:', e));
    throw new Error(`Наполнение не прошло проверку (${v.errors.length} ошибок). Исправьте или запустите с --force.`);
  }
  fs.mkdirSync(path.dirname(ctx.outputPath), { recursive: true });
  const { doc } = buildDocumentUd(ctx);
  fs.writeFileSync(ctx.outputPath, await Packer.toBuffer(doc));
  return { output: ctx.outputPath };
}

module.exports = { buildUd, buildDocumentUd };
