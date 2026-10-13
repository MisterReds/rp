// Сборка единого документа: рабочая программа ПМ + фонд оценочных средств (приложение 1).
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./docx_helpers.js');
const { D, mm, P_MARG, P_W, L_MARG, L_W, C, run, p, center, caption, h1, h2, h3, bullets, olist, pageBreak, cp, cell, cellBullets, table, hdr, simpleTable, widths, noBorders } = H;
const { Document, Packer, Paragraph, TextRun, TableRow, Footer, PageNumber, AlignmentType, PageOrientation, TabStopType, Tab } = D;
const { loadPlan, moduleFromPlan, semLabel, FORM_NAMES } = require('./plan.js');
const { validate, parseCodes, examForms, OK_CODES } = require('./validate.js');
const { LESSON, PP_DAY } = require('./skeleton.js');

const LETTERS = ['а', 'б', 'в', 'г'];
const uniq = a => [...new Set(a)];
const sortCodes = a => uniq(a).sort((x, y) => x.localeCompare(y, 'ru', { numeric: true }));

function loadProject(projectFile) {
  const dir = path.dirname(path.resolve(projectFile));
  const pj = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  const rd = f => path.resolve(dir, f);
  const ctx = {
    dir, project: pj,
    fgos: JSON.parse(fs.readFileSync(rd(pj.fgos), 'utf8')),
    vosp: JSON.parse(fs.readFileSync(rd(pj.vospitanie), 'utf8')),
    plan: loadPlan(rd(pj.plan)),
    contentPath: rd(pj.content || 'content.json'),
    outputPath: rd(pj.output || 'out.docx'),
  };
  if (fs.existsSync(ctx.contentPath)) ctx.content = JSON.parse(fs.readFileSync(ctx.contentPath, 'utf8'));
  return ctx;
}

// "ПК 1.1, ПК 1.2; ОК 01" из множества кодов
function codesStr(pk, ok) {
  const parts = [];
  if (pk.length) parts.push(sortCodes(pk).join(', '));
  if (ok.length) parts.push(sortCodes(ok).join(', '));
  return parts.join('; ');
}

function buildDocument(ctx, pages = {}) {
  const { project: pj, fgos, vosp, content: c } = ctx;
  const org = pj.org;
  const PK = c.meta.pk;
  const pkCodes = PK.map(x => x[0]);
  const OK = fgos.ok;
  const LR = vosp.lr;
  // По умолчанию — все ЛР, соотнесённые с ОК в программе воспитания; подмножество — только если в project.json "lr_subset": true
  const okLrMod = (pj.lr_subset && vosp.ok_lr_module) ? vosp.ok_lr_module : vosp.ok_lr;
  const lrFromOk = oks => uniq(oks.flatMap(o => okLrMod[o] || [])).sort((a, b) => a - b);
  const LR_MOD = lrFromOk(OK_CODES);
  const LR_ALL = Object.keys(LR).map(Number).sort((a, b) => a - b);
  const LR_FREE = LR_ALL.filter(n => !LR_MOD.includes(n));
  const lrStr = arr => (arr.length ? 'ЛР ' + arr.join(', ') : '');
  const pmTitle = `${c.meta.pm} ${c.meta.pm_name}`;
  const allLessons = [];

  // ---------- титульный лист ----------
  const half = Math.floor(P_W / 2);
  const approval = table([half, P_W - half], [new TableRow({ children: [
    cell(['РАССМОТРЕНО', 'на заседании ПЦК', org.pcc, 'Протокол № ____', 'от «___» ________ 20__ г.', 'Председатель ПЦК', '__________ /__________/'], half, { size: 24 }),
    cell(['УТВЕРЖДАЮ', org.approver, '__________ /__________/', '«___» ________ 20__ г.'], P_W - half, { size: 24 }),
  ] })], { borders: noBorders });
  const titlePage = [
    center(org.ministry), center(org.type), center(org.name, { after: 600 }),
    approval,
    center('', { before: 1800 }),
    center('РАБОЧАЯ ПРОГРАММА ПРОФЕССИОНАЛЬНОГО МОДУЛЯ', { bold: true, size: 28, after: 240 }),
    center(pmTitle.toUpperCase(), { bold: true, size: 28, after: 480 }),
    center(`по специальности ${fgos.code} ${fgos.name}`),
    center(`квалификация: ${fgos.qualification}`),
    center(`форма обучения: ${pj.form}`),
    center(`учебный план группы ${pj.group}`, { after: 3200 }),
    center(`${org.city}, ${pj.year} г.`),
    pageBreak(),
  ];
  const normative = [
    `Федерального государственного образовательного стандарта среднего профессионального образования по специальности ${fgos.code} ${fgos.name}, утверждённого ${fgos.order};`,
    `примерной образовательной программы по специальности ${fgos.code} ${fgos.name}, включённой в реестр примерных образовательных программ (регистрационный номер ${pj.pop_reg_number || '______'});`,
    ...(fgos.professional_standards || []).map(s => s.replace(/^п/, 'п') + ';'),
    'Порядка организации и осуществления образовательной деятельности по образовательным программам среднего профессионального образования, утверждённого приказом Министерства просвещения Российской Федерации от 24 августа 2022 г. № 762;',
    'Положения о практической подготовке обучающихся, утверждённого приказом Министерства науки и высшего образования Российской Федерации № 885, Министерства просвещения Российской Федерации № 390 от 5 августа 2020 г.;',
    `${vosp.title.replace(/^Р/, 'р')};`,
    ...(pj.extra_normative || []).map(s => s + ';'),
    `учебного плана образовательной программы «${fgos.name}» (группа ${pj.group}).`,
  ];
  const back = [
    p(`Рабочая программа профессионального модуля ${c.meta.pm} «${c.meta.pm_name}» разработана на основе:`, { after: 120 }),
    ...olist(normative),
    p('', { after: 240 }),
    p(`Организация-разработчик: ${org.type.toLowerCase()} ${org.name} (${org.short}).`, { after: 240 }),
    p(`Разработчик: ${pj.people.developer}.`, { after: 240 }),
    p(`Эксперт от работодателя: ${pj.people.expert}.`, { after: 240 }),
    pageBreak(),
  ];

  // ---------- содержание ----------
  const TOC = [
    ['s1', '1. Общая характеристика рабочей программы профессионального модуля', 0, '1. ОБЩАЯ ХАРАКТЕРИСТИКА РАБОЧЕЙ ПРОГРАММЫ'],
    ['s2', '2. Структура и содержание профессионального модуля', 0, '2. СТРУКТУРА И СОДЕРЖАНИЕ ПРОФЕССИОНАЛЬНОГО МОДУЛЯ'],
    ['s3', '3. Условия реализации профессионального модуля', 0, '3. УСЛОВИЯ РЕАЛИЗАЦИИ ПРОФЕССИОНАЛЬНОГО МОДУЛЯ'],
    ['s4', '4. Контроль и оценка результатов освоения профессионального модуля', 0, '4. КОНТРОЛЬ И ОЦЕНКА РЕЗУЛЬТАТОВ ОСВОЕНИЯ'],
    ['f0', 'Приложение 1. Фонд оценочных средств по профессиональному модулю', 0, 'ФОНД ОЦЕНОЧНЫХ СРЕДСТВ ПО ПРОФЕССИОНАЛЬНОМУ МОДУЛЮ'],
    ['f1', '1. Паспорт фонда оценочных средств', 1, '1. ПАСПОРТ ФОНДА ОЦЕНОЧНЫХ СРЕДСТВ'],
    ['f2', '2. Оценочные средства текущего контроля', 1, '2. ОЦЕНОЧНЫЕ СРЕДСТВА ТЕКУЩЕГО КОНТРОЛЯ'],
    ['f3', '3. Оценочные средства промежуточной аттестации по МДК', 1, '3. ОЦЕНОЧНЫЕ СРЕДСТВА ПРОМЕЖУТОЧНОЙ АТТЕСТАЦИИ'],
    ['f4', '4. Оценочные средства по учебной и производственной практике', 1, '4. ОЦЕНОЧНЫЕ СРЕДСТВА ПО УЧЕБНОЙ И ПРОИЗВОДСТВЕННОЙ'],
    ['f5', '5. Оценочные средства экзамена по модулю', 1, '5. ОЦЕНОЧНЫЕ СРЕДСТВА ЭКЗАМЕНА ПО МОДУЛЮ'],
    ['f6', '6. Ключи к тестовым заданиям', 1, '6. КЛЮЧИ К ТЕСТОВЫМ ЗАДАНИЯМ'],
    ['f7', '7. Формы документов', 1, '7. ФОРМЫ ДОКУМЕНТОВ'],
  ];
  const tocLine = (text, page, level) => new Paragraph({
    children: [run(text), new TextRun({ font: H.FONT, size: 24, children: [new Tab(), String(page || '')] })],
    tabStops: [{ type: TabStopType.RIGHT, position: P_W - 10, leader: 'dot' }],
    indent: { left: level ? mm(5) : 0, right: mm(10) }, spacing: { after: 80 },
  });
  const toc = [center('СОДЕРЖАНИЕ', { bold: true, after: 240 }), ...TOC.map(([k, t, l]) => tocLine(t, pages[k], l)), pageBreak()];

  // ---------- производные данные ----------
  const m = moduleFromPlan(ctx.plan, pj.pm);
  const activeSems = m.pm.sem.map((h, i) => (h > 0 ? i : -1)).filter(i => i >= 0);
  const off = pj.course_offset || 0;
  const firstSem = activeSems[0], lastSem = activeSems[activeSems.length - 1];
  const courseOf = i => Math.floor(i / 2) + 1 + off;
  const studyText = firstSem === lastSem ? semLabel(firstSem, off) : `${courseOf(firstSem) === courseOf(lastSem) ? courseOf(firstSem) + ' курсе' : courseOf(firstSem) + '–' + courseOf(lastSem) + ' курсах'} (${firstSem + 1}–${lastSem + 1} семестры учебного плана)`;
  const elemCodes = {};
  c.mdk.forEach(md => {
    const pk = [], ok = [];
    md.blocks.forEach(b => b.themes.forEach(th => { const x = parseCodes(th.codes); pk.push(...x.pk); ok.push(...x.ok); }));
    elemCodes[md.code] = { pk: uniq(pk), ok: uniq(ok) };
  });
  const practiceCodes = arr => { const pk = []; arr.forEach(u => u.works.forEach(w => pk.push(...parseCodes(w.codes).pk))); return uniq(pk); };
  const upPK = practiceCodes(c.up), ppPK = practiceCodes(c.pp);
  const sumMdkT = c.mdk.reduce((a, x) => a + x.T, 0), sumMdkP = c.mdk.reduce((a, x) => a + x.P, 0), sumK = c.mdk.reduce((a, x) => a + (x.K || 0), 0);
  const upH = c.up.reduce((a, x) => a + x.hours, 0), ppH = c.pp.reduce((a, x) => a + x.hours, 0);
  const total = sumMdkT + sumMdkP + sumK + upH + ppH;
  const formName = f => FORM_NAMES[f] || f;
  const formsList = [];
  c.mdk.forEach(md => md.blocks.forEach(b => b.form && formsList.push(`${md.code} — ${formName(b.form)} (${b.label})`)));
  c.up.forEach(u => u.form && formsList.push(`${u.code} — ${formName(u.form)} (${u.label})`));
  c.pp.forEach(u => u.form && formsList.push(`${u.code} — ${formName(u.form)} (${u.label})`));
  formsList.push(`${c.meta.pm} — экзамен по модулю (${c.meta.exam_label})`);

  // ---------- раздел 1 ----------
  const pr = c.program;
  const w2 = widths(P_W, [25, 0], 1);
  const hasPS = pr.pk_ps && Object.keys(pr.pk_ps).length;
  const wPK = hasPS ? widths(P_W, [25, 0, 35], 1) : w2;
  const pkHead = hasPS ? ['Код', 'Наименование видов деятельности и профессиональных компетенций', 'Трудовые функции ПС'] : ['Код', 'Наименование видов деятельности и профессиональных компетенций'];
  const pkTable = table(wPK, [hdr(pkHead, wPK),
    new TableRow({ children: [cell(c.meta.vd, wPK[0], { bold: true }), cell(c.meta.pm_name, wPK[1], { bold: true }), ...(hasPS ? [cell('', wPK[2])] : [])] }),
    ...PK.map(([k, n]) => new TableRow({ children: [cell(k, wPK[0]), cell(n, wPK[1]), ...(hasPS ? [cell(pr.pk_ps[k] || '', wPK[2])] : [])] }))]);
  const w3 = widths(P_W, [35, 0], 1);
  const wLR = widths(P_W, [25, 0, 55], 1);
  // таблица 1.2: Код ОК, ПК | Уметь | Знать | Владеть навыками (макет ПОП)
  const wR = widths(P_W, [20, 0, 0, 0], 1);
  { const rest = P_W - wR[0]; wR[1] = Math.floor(rest / 3); wR[2] = Math.floor(rest / 3); wR[3] = rest - wR[1] - wR[2]; }
  const listCell = (items, w) => cell((items || []).map((t, i, a) => t.replace(/[;.]\s*$/, '') + (i === a.length - 1 ? '.' : ';')), w);
  const okRes = fgos.ok_results || {};
  const pkRes = pr.pk_results || {};
  const resultsTable = table(wR, [hdr(['Код ОК, ПК', 'Уметь', 'Знать', 'Владеть навыками'], wR),
    ...OK_CODES.map(o => new TableRow({ children: [cell(o, wR[0]), listCell((okRes[o] || {}).um, wR[1]), listCell((okRes[o] || {}).zn, wR[2]), cell('', wR[3])] })),
    ...pkCodes.map(k => new TableRow({ children: [cell(k, wR[0]), listCell((pkRes[k] || {}).um, wR[1]), listCell((pkRes[k] || {}).zn, wR[2]), listCell((pkRes[k] || {}).nav, wR[3])] }))]);
  const sec1 = [
    h1('1. Общая характеристика рабочей программы профессионального модуля'),
    center(`«${pmTitle}»`, { bold: true, after: 200 }),
    h2('1.1. Цель и место профессионального модуля в структуре образовательной программы'),
    p(`Цель модуля: освоение вида деятельности «${c.meta.pm_name}» и соответствующих ему общих и профессиональных компетенций, а также личностных результатов.`),
    p(`Профессиональный модуль включён в обязательную часть профессионального цикла образовательной программы по специальности ${fgos.code} ${fgos.name}. Модуль изучается на ${studyText}.` +
      (pr.prerequisites.length ? ` Модуль опирается на ${pr.prerequisites.join(', ')}.` : '') +
      (pr.next_modules.length ? ` Результаты освоения модуля используются при изучении: ${pr.next_modules.join(', ')}.` : '')),
    p(pr.place_text),
    p(`В результате освоения профессионального модуля обучающийся должен освоить вид деятельности «${c.meta.pm_name}» и соответствующие ему общие и профессиональные компетенции, а также достичь личностных результатов.`),
    h3('1.1.1. Перечень общих компетенций'),
    table(w2, [hdr(['Код', 'Наименование общих компетенций'], w2), ...OK.map(([k, n]) => new TableRow({ children: [cell(k, w2[0]), cell(n, w2[1])] }))]),
    h3('1.1.2. Перечень профессиональных компетенций'),
    pkTable,
    h3('1.1.3. Личностные результаты'),
    p(`Освоение модуля обеспечивает достижение личностных результатов (целевых ориентиров воспитания), установленных документом: ${vosp.title}. Соответствие общих компетенций и личностных результатов принято по документу «${vosp.source_table}».`, { after: 120 }),
    table(widths(P_W, [25, 0], 1), [hdr(['ОК', 'Личностные результаты (целевые ориентиры воспитания)'], widths(P_W, [25, 0], 1)),
      ...OK_CODES.map(o => new TableRow({ children: [cell(o, mm(25)), cell(lrStr(okLrMod[o] || []), P_W - mm(25))] })),
      ...(LR_FREE.length ? [new TableRow({ children: [cell('Без привязки к ОК', mm(25)), cell(lrStr(LR_FREE) + ' — формируются в ходе учебных занятий, практики и воспитательной работы', P_W - mm(25))] })] : [])]),
    p('Перечень личностных результатов, формируемых в модуле:', { before: 200, after: 120, keepNext: true }),
    table(w2, [hdr(['Код', 'Личностные результаты реализации программы воспитания (дескрипторы)'], w2), ...LR_ALL.map(n => new TableRow({ children: [cell('ЛР ' + n, w2[0]), cell(LR[n], w2[1])] }))]),
    h2('1.2. Планируемые результаты освоения профессионального модуля'),
    p('Результаты освоения профессионального модуля соотносятся с планируемыми результатами освоения образовательной программы, представленными в матрице компетенций выпускника (п. 4.3 ПОП).'),
    p('В результате освоения профессионального модуля обучающийся должен:', { after: 120, keepNext: true }),
    resultsTable,
  ];

  // ---------- раздел 2 ----------
  const wT = widths(L_W, [0, 40, 40], 0);
  const trud = table(wT, [hdr(['Наименование составных частей модуля', 'Объём, ч', 'В т. ч. в форме практической подготовки, ч'], wT),
    ...[['Учебные занятия', sumMdkT + sumMdkP, sumMdkP], ['Курсовая работа (проект)', sumK || '—', sumK || '—'], ['Самостоятельная работа', '—', '—'], ['Практика, в т. ч.:', upH + ppH, upH + ppH], ['учебная', upH, upH], ['производственная', ppH, ppH], ['Промежуточная аттестация', 'в период сессии', '—']]
      .map(([a, b, x]) => new TableRow({ children: [cell(a, wT[0]), cell(String(b), wT[1], { align: C }), cell(String(x), wT[2], { align: C })] })),
    new TableRow({ children: [cell('Всего', wT[0], { bold: true }), cell(String(total), wT[1], { bold: true, align: C }), cell(String(sumMdkP + sumK + upH + ppH), wT[2], { bold: true, align: C })] })]);
  const wS = widths(L_W, [38, 0, 18, 22, 18, 22, 18, 18, 18, 20], 1);
  const hc = (t, w, o = {}) => cell(t, w, { bold: true, align: C, vAlign: D.VerticalAlign.CENTER, shade: 'EDEDED', ...o });
  const okAll = 'ОК 01–09';
  const structRows = [
    ...c.mdk.map((md, i) => [[codesStr(elemCodes[md.code].pk, elemCodes[md.code].ok), lrStr(lrFromOk(elemCodes[md.code].ok))], `Раздел ${i + 1}. ${md.code} ${md.name}`, md.T + md.P + (md.K || 0), md.P + (md.K || 0), md.T + md.P + (md.K || 0), md.P, md.K || '—', '—', '', '']),
    ...c.up.length ? [[[codesStr(upPK, []) + '; ' + okAll, lrStr(LR_MOD)], `Учебная практика ${c.up[0].code}`, upH, upH, '', '', '', '', upH, '']] : [],
    ...c.pp.length ? [[[codesStr(ppPK, []) + '; ' + okAll, lrStr(LR_MOD)], `Производственная практика ${c.pp[0].code}`, ppH, ppH, '', '', '', '', '', ppH]] : [],
    ['', 'Промежуточная аттестация', '*', '', '', '', '', '', '', ''],
  ];
  const struct = table(wS, [
    new TableRow({ tableHeader: true, children: [hc('Коды ПК, ОК, ЛР', wS[0], { rowSpan: 3 }), hc('Наименования разделов профессионального модуля', wS[1], { rowSpan: 3 }), hc('Всего, ч', wS[2], { rowSpan: 3 }), hc('В т. ч. в форме практ. подготовки', wS[3], { rowSpan: 3 }), hc('Объём профессионального модуля, ч', wS.slice(4).reduce((a, b) => a + b, 0), { colSpan: 6 })] }),
    new TableRow({ tableHeader: true, children: [hc('Обучение по МДК', wS[4] + wS[5] + wS[6] + wS[7], { colSpan: 4 }), hc('Практики', wS[8] + wS[9], { colSpan: 2 })] }),
    new TableRow({ tableHeader: true, children: [hc('Всего', wS[4]), hc('Лаб. и практ. занятий', wS[5]), hc('Курсовых работ', wS[6]), hc('Самост. работа', wS[7]), hc('Учебная', wS[8]), hc('Производств.', wS[9])] }),
    new TableRow({ tableHeader: true, children: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((t, i) => cell(t, wS[i], { align: C })) }),
    ...structRows.map(r => new TableRow({ children: r.map((v, i) => cell(Array.isArray(v) ? v : String(v), wS[i], { align: i >= 2 ? C : AlignmentType.LEFT })) })),
    new TableRow({ children: [cell('', wS[0]), cell('Всего', wS[1], { bold: true }), ...[total, sumMdkP + sumK + upH + ppH, sumMdkT + sumMdkP + sumK, sumMdkP, sumK || '—', '—', upH, ppH].map((v, i) => cell(String(v), wS[i + 2], { bold: true, align: C }))] }),
  ]);

  const wC = widths(L_W, [55, 0, 20, 38], 1);
  const span2 = wC[0] + wC[1];
  const part = (title, k, n) => (n > 1 ? `${title} (часть ${k})` : title);
  const rows = [hdr(['Наименование разделов и тем профессионального модуля, МДК', 'Содержание учебного материала, лабораторные работы и практические занятия', 'Объём, ч', 'Коды ПК, ОК, ЛР'], wC),
    new TableRow({ tableHeader: true, children: ['1', '2', '3', '4'].map((t, i) => cell(t, wC[i], { align: C })) })];
  const shadeRow = (text, hours) => new TableRow({ children: [cell(text, span2, { bold: true, colSpan: 2, shade: 'F5F5F5' }), cell(String(hours), wC[2], { bold: true, align: C, shade: 'F5F5F5' }), cell('', wC[3], { shade: 'F5F5F5' })] });
  const semRow = (text, hours) => new TableRow({ children: [cell(text, span2, { italics: true, bold: true, colSpan: 2 }), cell(String(hours), wC[2], { italics: true, bold: true, align: C }), cell('', wC[3])] });
  const attRow = text => new TableRow({ children: [cell(text, span2, { colSpan: 2, italics: true }), cell('*', wC[2], { align: C }), cell('', wC[3])] });
  c.mdk.forEach((md, mi) => {
    rows.push(shadeRow(`Раздел ${mi + 1}. ${md.code} ${md.name}`, md.T + md.P + (md.K || 0)));
    let n = 0, tn = 0;
    md.blocks.forEach(b => {
      rows.push(semRow(b.label, b.hours));
      b.themes.forEach(x => {
        tn += 1;
        const T = x.theory.length * LESSON, P = x.practice.reduce((s, y) => s + y[1], 0);
        const prRows = [];
        x.practice.forEach(([title, h]) => { const k = h / LESSON; for (let i = 1; i <= k; i++) prRows.push(part(title, i, k)); });
        const span = 1 + x.theory.length + 1 + prRows.length;
        const lr = lrStr(lrFromOk(parseCodes(x.codes).ok));
        rows.push(new TableRow({ children: [
          cell([cp(`Тема ${mi + 1}.${tn}. ${x.name}`, { bold: true }), cp(`Всего: ${T + P} ч`, { italics: true })], wC[0], { rowSpan: span }),
          cell([cp('Содержание учебного материала', { bold: true }), cp(x.summary)], wC[1]),
          cell(String(T), wC[2], { align: C, bold: true }),
          cell([x.codes, lr], wC[3], { rowSpan: span }),
        ] }));
        x.theory.forEach(t => { rows.push(new TableRow({ children: [cell(`${++n}. ${t}`, wC[1]), cell(String(LESSON), wC[2], { align: C })] })); allLessons.push(t); });
        rows.push(new TableRow({ children: [cell('В том числе практических занятий', wC[1], { bold: true }), cell(String(P), wC[2], { align: C, bold: true })] }));
        prRows.forEach(t => rows.push(new TableRow({ children: [cell(`${++n}. ${t}`, wC[1]), cell(String(LESSON), wC[2], { align: C })] })));
      });
      if (b.K && md.course_project) {
        const cpj = md.course_project;
        const stRows = [];
        cpj.stages.forEach(([t, h]) => { const k = h / LESSON; for (let i = 1; i <= k; i++) stRows.push(part(t, i, k)); });
        rows.push(new TableRow({ children: [
          cell([cp('Курсовой проект (работа)', { bold: true }), cp(`Всего: ${cpj.hours} ч`, { italics: true })], wC[0], { rowSpan: 1 + stRows.length }),
          cell([cp('Тематика курсовых проектов (работ)', { bold: true }), ...cpj.topics.map((t, i) => cp(`${i + 1}. ${t}`))], wC[1]),
          cell(String(cpj.hours), wC[2], { align: C, bold: true }),
          cell([codesStr(elemCodes[md.code].pk, elemCodes[md.code].ok)], wC[3], { rowSpan: 1 + stRows.length }),
        ] }));
        stRows.forEach(t => rows.push(new TableRow({ children: [cell(`${++n}. ${t}`, wC[1]), cell(String(LESSON), wC[2], { align: C })] })));
      }
      if (b.form) rows.push(attRow(`Промежуточная аттестация: ${formName(b.form)}`));
    });
  });
  const practiceRows = (arr, kind) => {
    if (!arr.length) return;
    const tot = arr.reduce((a, x) => a + x.hours, 0);
    rows.push(shadeRow(kind === 'up' ? `Учебная практика ${arr[0].code}` : `Производственная практика ${arr[0].code}`, tot));
    let n = 0, v = 0;
    arr.forEach(u => {
      rows.push(semRow(u.label, u.hours));
      u.works.forEach(w => {
        v += 1;
        const lines = [];
        if (kind === 'up') w.tasks.forEach(([t, h]) => { const k = h / LESSON; for (let i = 1; i <= k; i++) lines.push([part(t, i, k), LESSON]); });
        else w.days.forEach(d => lines.push([d, PP_DAY]));
        const codes = parseCodes(w.codes).pk;
        lines.forEach(([t, h], i) => {
          const ch = [];
          if (i === 0) ch.push(cell([cp(`Вид работ ${v}. ${w.name}`, { bold: true }), cp(`Всего: ${lines.reduce((a, x) => a + x[1], 0)} ч`, { italics: true })], wC[0], { rowSpan: lines.length }));
          ch.push(cell(`${++n}. ${t}`, wC[1]), cell(String(h), wC[2], { align: C }));
          if (i === 0) ch.push(cell([(codes.length ? codesStr(codes, []) + '; ' : '') + okAll, lrStr(LR_MOD)], wC[3], { rowSpan: lines.length }));
          rows.push(new TableRow({ children: ch }));
        });
      });
      if (u.form) rows.push(attRow(`Промежуточная аттестация: ${formName(u.form)}`));
    });
  };
  practiceRows(c.up, 'up');
  practiceRows(c.pp, 'pp');
  rows.push(new TableRow({ children: [cell(`Экзамен по модулю (${c.meta.exam_label})`, span2, { colSpan: 2, bold: true }), cell('*', wC[2], { align: C }), cell([`${pkCodes[0]}–${pkCodes[pkCodes.length - 1].replace('ПК ', '')}; ${okAll}`, lrStr(LR_MOD)], wC[3])] }));
  rows.push(new TableRow({ children: [cell('Всего', span2, { colSpan: 2, bold: true }), cell(String(total), wC[2], { bold: true, align: C }), cell('', wC[3])] }));
  const sec2 = [
    h1('2. Структура и содержание профессионального модуля'),
    h2('2.1. Структура профессионального модуля'), struct,
    p(`* Промежуточная аттестация проводится в период сессии по календарному учебному графику; часы в объём модуля по учебному плану не включены. Формы: ${formsList.join('; ')}.`, { size: 22, before: 120, noIndent: true }),
    h2('2.2. Содержание профессионального модуля'),
    table(wC, rows),
  ];

  // ---------- раздел 3 ----------
  const cnd = pr.conditions;
  const sec3 = [
    h1('3. Условия реализации профессионального модуля'),
    h2('3.1. Материально-техническое обеспечение'),
    p('Для реализации программы профессионального модуля предусмотрены следующие специальные помещения.'),
    ...cnd.rooms.flatMap(r => [p(`${r.name} — для ${r.purpose}:`, { keepNext: true }), ...bullets(r.equipment.map((e, i, a) => e + (i === a.length - 1 ? '.' : ';')))]),
    p('Помещение для самостоятельной работы оснащается компьютерами с доступом в сеть Интернет и в электронную информационно-образовательную среду организации.'),
    ...(cnd.software.length ? [p('Программное обеспечение:', { keepNext: true }), ...bullets(cnd.software.map((e, i, a) => e + (i === a.length - 1 ? '.' : ';')))] : []),
    h2('3.2. Учебно-методическое обеспечение'),
    h3('3.2.1. Основные печатные и электронные издания'), ...olist(cnd.literature_main),
    h3('3.2.2. Дополнительные источники'), ...olist(cnd.literature_add),
    h2('3.3. Кадровое обеспечение'),
    p(`Реализация модуля обеспечивается педагогическими работниками образовательной организации, а также лицами, привлекаемыми на иных условиях, имеющими опыт деятельности не менее 3 лет в организациях области профессиональной деятельности ${fgos.professional_area}. Педагогические работники получают дополнительное профессиональное образование по программам повышения квалификации не реже 1 раза в 3 года, в том числе в форме стажировки в профильных организациях.`),
    h2('3.4. Организация практики'),
    p('Учебная практика проводится в лабораториях и мастерских образовательной организации. Производственная практика проводится в профильных организациях на основании договоров о практической подготовке обучающихся. Руководство практикой осуществляют руководитель практики от образовательной организации и руководитель от профильной организации.'),
  ];

  // ---------- раздел 4 ----------
  const me = c.fos.module_exam;
  const pkCrit = pr.pk_criteria, okCrit = pr.ok_criteria;
  const w4 = widths(P_W, [60, 0, 45], 1);
  const evalTable = table(w4, [hdr(['Код и наименование профессиональных и общих компетенций', 'Критерии оценки', 'Методы оценки'], w4),
    ...PK.map(([k, n]) => new TableRow({ children: [cell(`${k}. ${n}`, w4[0]), cell(pkCrit[k][0], w4[1]), cell(pkCrit[k][1], w4[2])] })),
    ...OK.map(([k, n]) => new TableRow({ children: [cell(`${k}. ${n}`, w4[0]), cell(okCrit[k][0], w4[1]), cell(okCrit[k][1], w4[2])] }))]);
  const w6 = widths(P_W, [40, 0, 50], 1);
  const lrEval = table(w6, [hdr(['Коды ЛР', 'Показатели достижения', 'Формы и методы контроля'], w6),
    ...OK_CODES.map(o => new TableRow({ children: [cell(lrStr(okLrMod[o] || []) + ` (${o})`, w6[0]), cell(okCrit[o][0], w6[1]), cell(okCrit[o][1] + '; характеристика руководителя практики', w6[2])] }))]);
  const pkMax = {};
  me.checklist.forEach(([k, , pt]) => { pkMax[k] = (pkMax[k] || 0) + Number(pt); });
  const partsText = me.parts.map(x => `${x.name} (${x.pk.join(', ')}${x.minutes ? `; ${x.minutes} мин` : ''})`).join('; ');
  const sec4 = [
    h1('4. Контроль и оценка результатов освоения профессионального модуля'),
    p(`Текущий контроль осуществляется преподавателем в форме защиты практических работ, тестирования и экспертного наблюдения за выполнением работ. Промежуточная аттестация проводится в формах, установленных учебным планом. Итоговой формой контроля по модулю является экзамен по модулю, к которому допускаются обучающиеся, освоившие все МДК и практики модуля.`, { after: 120 }),
    evalTable,
    caption('Оценка личностных результатов', { before: 240 }),
    lrEval,
    p(`Экзамен по модулю состоит из следующих частей: ${partsText}. Оценивание ведётся по 100-балльному оценочному листу; вид деятельности признаётся освоенным при наборе не менее 60 баллов и не менее 50 % баллов по каждой ПК. По итогам экзамена принимается решение «вид деятельности освоен / не освоен» и выставляется оценка по пятибалльной шкале.`, { before: 200, after: 120 }),
    simpleTable(widths(P_W, [55, 0], 1), ['Оценка', 'Условие'], [['5 «отлично»', '90–100 баллов'], ['4 «хорошо»', '75–89 баллов'], ['3 «удовлетворительно»', '60–74 балла'], ['2 «неудовлетворительно»', 'менее 60 баллов или менее 50 % баллов по одной из ПК']]),
    p(`Контрольно-оценочные материалы приведены в приложении 1 «Фонд оценочных средств по профессиональному модулю ${c.meta.pm}».`, { before: 200 }),
  ];

  // ---------- приложение 1: ФОС ----------
  const fos = c.fos;
  const f1 = [
    p('Приложение 1', { bold: true, noIndent: true, align: AlignmentType.RIGHT, after: 240 }),
    h1(`Фонд оценочных средств по профессиональному модулю ${c.meta.pm} «${c.meta.pm_name}»`),
    p(`Фонд оценочных средств является неотъемлемой частью рабочей программы профессионального модуля и разработан на основе ФГОС СПО по специальности ${fgos.code}, рабочей программы модуля, документа «${vosp.title}» и локальных актов ${org.short} о текущем контроле успеваемости и промежуточной аттестации обучающихся.`, { after: 240 }),
    h1('1. Паспорт фонда оценочных средств'),
    h2('1.1. Назначение фонда оценочных средств'),
    p(`Фонд оценочных средств (ФОС) предназначен для проверки результатов освоения профессионального модуля ${pmTitle} по специальности ${fgos.code} ${fgos.name}. ФОС включает материалы для текущего контроля, промежуточной аттестации по междисциплинарным курсам и практикам и экзамена по модулю.`),
    p(`Итогом освоения модуля является готовность обучающегося к выполнению вида деятельности «${c.meta.pm_name}». По результатам экзамена по модулю выносится решение «вид деятельности освоен / не освоен» и выставляется оценка по пятибалльной шкале.`),
    h2('1.2. Результаты освоения модуля, подлежащие проверке'),
    h3('1.2.1. Профессиональные компетенции'),
    table(widths(P_W, [60, 0], 1), [hdr(['Код и наименование ПК', 'Основные показатели оценки результата'], widths(P_W, [60, 0], 1)), ...PK.map(([k, n]) => new TableRow({ children: [cell(`${k}. ${n}`, mm(60)), cell(pkCrit[k][0], P_W - mm(60))] }))]),
    h3('1.2.2. Общие компетенции'),
    table(widths(P_W, [60, 0], 1), [hdr(['Код и наименование ОК', 'Основные показатели оценки результата'], widths(P_W, [60, 0], 1)), ...OK.map(([k, n]) => new TableRow({ children: [cell(`${k}. ${n}`, mm(60)), cell(okCrit[k][0], P_W - mm(60))] }))]),
    h3('1.2.3. Личностные результаты'),
    p('Личностные результаты не оцениваются отметкой. Их достижение фиксируется в характеристике руководителя практики и в оценочном листе экзамена по модулю отметкой «проявлено / проявлено частично / не проявлено». Перечень ЛР приведён в п. 1.1.3 рабочей программы.'),
    h2('1.3. Формы контроля и оценивания элементов модуля'),
  ];
  const formRows = [
    ...c.mdk.map(md => [`${md.code} ${md.name}`, md.blocks.map(b => `${b.label} — ${b.form ? formName(b.form) : 'текущий контроль'}`).join('; '), 'Тестирование, защита практических работ' + (md.blocks.some(b => b.form) ? ', промежуточная аттестация по ФОС' : '')]),
    ...c.up.map(u => [`${u.code} Учебная практика`, `${u.label} — ${u.form ? formName(u.form) : 'текущий контроль'}`, 'Наблюдение, проверка выполненных работ, отчёт, аттестационный лист']),
    ...c.pp.map(u => [`${u.code} Производственная практика`, `${u.label} — ${u.form ? formName(u.form) : 'текущий контроль'}`, 'Дневник, отчёт, аттестационный лист, характеристика']),
    [`${c.meta.pm} в целом`, `${c.meta.exam_label} — экзамен по модулю`, me.parts.map(x => x.name).join(', ')],
  ];
  f1.push(simpleTable(widths(P_W, [55, 50, 0], 2), ['Элемент модуля', 'Семестр и форма аттестации', 'Методы контроля'], formRows));
  // матрица
  const wm = [mm(40), ...Array(pkCodes.length).fill(Math.floor((P_W - mm(40)) / pkCodes.length))];
  wm[1] += P_W - wm.reduce((a, b) => a + b, 0);
  const matrixRows = [
    ...c.mdk.map(md => {
      const f = examForms(md);
      return [md.code, ...pkCodes.map(k => (elemCodes[md.code].pk.includes(k) ? ['Т', 'ПР', ...(f['Э'] || f['ДЗ'] || f['З'] ? ['Э'] : []), ...(f['ДР'] || f['КР'] ? ['КР'] : [])].join(', ') : ''))];
    }),
    ...(c.up.length ? [[c.up[0].code, ...pkCodes.map(k => (upPK.includes(k) ? 'ВР' : ''))]] : []),
    ...(c.pp.length ? [[c.pp[0].code, ...pkCodes.map(k => (ppPK.includes(k) ? 'ВР' : ''))]] : []),
    ['Экзамен по модулю', ...pkCodes.map(k => me.parts.filter(x => x.pk.includes(k)).map(x => x.abbr || 'ЭМ').join(', '))],
  ];
  f1.push(h2('1.4. Матрица оценочных средств'),
    table(wm, [hdr(['Элемент модуля', ...pkCodes], wm), ...matrixRows.map(r => new TableRow({ children: r.map((v, i) => cell(v, wm[i], { align: i ? C : AlignmentType.LEFT })) }))]),
    p(`Т — тестирование; ПР — практическая работа; КР — контрольная работа; Э — экзамен (зачёт) по МДК; ВР — виды работ практики; ${me.parts.map(x => `${x.abbr || 'ЭМ'} — ${x.name}`).join('; ')}.`, { size: 22, before: 80, noIndent: true }),
    h2('1.5. Шкала оценивания'),
    simpleTable(widths(P_W, [60, 0], 1), ['Доля верно выполненных заданий (баллов), %', 'Оценка'], [['90–100', '5 «отлично»'], ['75–89', '4 «хорошо»'], ['60–74', '3 «удовлетворительно»'], ['менее 60', '2 «неудовлетворительно»']], { center: [0, 1] }));

  // 2. текущий контроль
  const testBlock = T => T.flatMap((q, i) => [p(`${i + 1}. ${q.q}`, { noIndent: true, before: 80, keepNext: true }), p(q.options.map((o, j) => `${LETTERS[j]}) ${o}`).join('    '), { noIndent: true, indent: { left: mm(6) } })]);
  const prCrit = simpleTable(widths(P_W, [40, 0], 1), ['Оценка', 'Критерий'], [
    ['5 «отлично»', 'Работа выполнена полностью, результат соответствует заданию, отчёт оформлен, на контрольные вопросы даны полные ответы'],
    ['4 «хорошо»', 'Работа выполнена полностью, допущены 1–2 несущественные ошибки, исправленные после замечания'],
    ['3 «удовлетворительно»', 'Работа выполнена не менее чем на 60 %, основной результат достигнут, ответы на вопросы неполные'],
    ['2 «неудовлетворительно»', 'Работа выполнена менее чем на 60 % или результат не достигнут'],
  ]);
  const f2 = [h1('2. Оценочные средства текущего контроля'),
    p('Текущий контроль проводится в форме тестирования по разделам МДК и защиты практических работ. Тест выполняется в электронной среде или на бланке, время — 1 минута на вопрос. Каждое задание имеет один правильный ответ и оценивается в 1 балл. Отметка выставляется по шкале п. 1.5. Ключи к тестам приведены в разделе 6.')];
  c.mdk.forEach((md, i) => {
    f2.push(h2(`2.${i + 1}. Тестовые задания по ${md.code} «${md.name}»`),
      p(`Проверяемые результаты: ${codesStr(elemCodes[md.code].pk, elemCodes[md.code].ok)}.`, { italics: true, noIndent: true, after: 80 }),
      ...testBlock(fos.tests[md.code] || []));
  });
  f2.push(h2(`2.${c.mdk.length + 1}. Практические работы`),
    p('Практические работы выполняются по методическим указаниям. Обучающийся представляет результат работы, отчёт и отвечает на контрольные вопросы. Перечень работ соответствует тематическому плану рабочей программы.'));
  c.mdk.forEach(md => {
    f2.push(p(`Перечень практических работ ${md.code}:`, { bold: true, noIndent: true, before: 120, keepNext: true }));
    let k = 0;
    md.blocks.forEach(b => b.themes.forEach(th => th.practice.forEach(([x, h]) => f2.push(p(`${++k}. ${x} — ${h} ч (тема «${th.name}»).`, { noIndent: true, size: 22 })))));
  });
  f2.push(caption('Критерии оценки практической работы'), prCrit);

  // 3. промежуточная аттестация
  const examCrit = simpleTable(widths(P_W, [40, 0], 1), ['Оценка', 'Критерий'], [
    ['5 «отлично»', 'Полные ответы на оба теоретических вопроса; практическое задание выполнено полностью'],
    ['4 «хорошо»', 'Ответы на вопросы с несущественными неточностями; практическое задание выполнено с 1–2 ошибками, исправленными самостоятельно'],
    ['3 «удовлетворительно»', 'Ответ на один вопрос полный, на второй — частичный; практическое задание выполнено не менее чем на 60 %'],
    ['2 «неудовлетворительно»', 'Ответы на вопросы отсутствуют или содержат грубые ошибки; практическое задание не выполнено'],
  ]);
  const ticket = (md, label, ex) => table([P_W], [new TableRow({ children: [cell([
    `${org.short}`, `${md.code} ${md.name}`, `Специальность ${fgos.code} ${fgos.name}, ${label}`, 'ЭКЗАМЕНАЦИОННЫЙ БИЛЕТ № 1',
    `1. ${ex.questions[0]}`, `2. ${ex.questions[Math.floor(ex.questions.length / 2)]}`, `3. Практическое задание: ${ex.tasks[0]}`,
    'Время на подготовку — 30 минут, на выполнение практического задания — 30 минут.',
    'Преподаватель ____________ /____________/        Председатель ПЦК ____________ /____________/',
  ], P_W, { size: 22 })] })]);
  const f3 = [h1('3. Оценочные средства промежуточной аттестации по МДК')];
  const cwAnswers = [];
  let s3 = 0;
  c.mdk.forEach(md => {
    md.blocks.filter(b => b.form).forEach(b => {
      s3 += 1;
      const codes = codesStr(elemCodes[md.code].pk, elemCodes[md.code].ok);
      if (['Э', 'ДЗ', 'З'].includes(b.form)) {
        const ex = fos.exams[md.code];
        f3.push(h2(`3.${s3}. ${md.code} «${md.name}». ${formName(b.form)[0].toUpperCase() + formName(b.form).slice(1)} (${b.label})`),
          p(`Промежуточная аттестация проводится по билетам. Билет содержит два теоретических вопроса и одно практическое задание. Проверяемые результаты: ${codes}.`),
          caption('Перечень теоретических вопросов'), ...ex.questions.map((q, i) => p(`${i + 1}. ${q}`, { noIndent: true })),
          caption('Перечень практических заданий'), ...ex.tasks.map((q, i) => p(`${i + 1}. ${q}`, { noIndent: true })),
          caption('Образец билета'), ticket(md, b.label, ex),
          caption('Критерии оценки'), examCrit);
      } else {
        const cw = fos.control_works[md.code];
        f3.push(h2(`3.${s3}. ${md.code} «${md.name}». Контрольная работа (${b.label})`),
          p(`Контрольная работа выполняется письменно, время — ${cw.minutes || 90} минут. Проверяемые результаты: ${codes}. Каждое задание оценивается до 10 баллов; итоговая отметка — по шкале п. 1.5. Эталоны ответов приведены в разделе 6.`));
        cw.variants.forEach((v, i) => {
          f3.push(p(`Вариант ${i + 1}`, { bold: true, noIndent: true, before: 160, keepNext: true }), ...v.tasks.map((t, j) => p(`Задание ${j + 1}. ${t}`, { noIndent: true })));
          if (v.answer) cwAnswers.push(`${md.code}, вариант ${i + 1}: ${v.answer}`);
        });
      }
    });
  });

  // 4. практики
  const pracCrit = simpleTable(widths(P_W, [40, 0], 1), ['Оценка', 'Критерий'], [
    ['5 «отлично»', 'Все виды работ выполнены качественно и в срок; отчёт и дневник оформлены полностью; в аттестационном листе все ПК оценены как освоенные'],
    ['4 «хорошо»', 'Все виды работ выполнены, допущены несущественные недочёты; отчёт оформлен с незначительными замечаниями'],
    ['3 «удовлетворительно»', 'Выполнено не менее 60 % видов работ; отчёт неполный; отдельные ПК освоены частично'],
    ['2 «неудовлетворительно»', 'Выполнено менее 60 % видов работ или отчёт не представлен'],
  ]);
  const wW = widths(P_W, [10, 0, 30, 18, 28], 1);
  const worksTable = arr => table(wW, [hdr(['№', 'Вид работ', 'ПК', 'Часы', 'Отметка о выполнении'], wW), ...arr.flatMap(u => u.works.map(w => [w, u])).map(([w, u], i) => new TableRow({ children: [cell(String(i + 1), wW[0], { align: C }), cell(`${w.name} (${u.label})`, wW[1]), cell(codesStr(parseCodes(w.codes).pk, []) || '—', wW[2]), cell(String(w.tasks ? w.tasks.reduce((a, x) => a + x[1], 0) : w.days.length * PP_DAY), wW[3], { align: C }), cell('', wW[4])] }))]);
  const f4 = [h1('4. Оценочные средства по учебной и производственной практике')];
  if (c.up.length) f4.push(h2('4.1. Учебная практика'), p(`Учебная практика ${c.up[0].code} оценивается на основании выполненных работ, отчёта и аттестационного листа (раздел 7, форма 1). Проверяемые результаты: ${codesStr(upPK, [])}; ОК 01–09; ЛР по п. 1.1.3 рабочей программы.`), worksTable(c.up));
  if (c.pp.length) f4.push(h2('4.2. Производственная практика'), p(`Производственная практика ${c.pp[0].code} проводится в профильных организациях. Обучающийся представляет дневник практики, отчёт, аттестационный лист и характеристику от руководителя профильной организации (раздел 7, формы 2 и 3). Проверяемые результаты: ${codesStr(ppPK, [])}; ОК 01–09; ЛР по п. 1.1.3 рабочей программы.`), worksTable(c.pp),
    p('Отчёт по производственной практике включает: титульный лист; характеристику организации; описание выполненных работ по видам; копии составленных документов; выводы.', { before: 120 }));
  f4.push(caption('Критерии оценки по практике'), pracCrit);

  // 5. экзамен по модулю
  const wE = widths(P_W, [18, 0, 22, 22], 1);
  const wOL = widths(P_W, [22, 55, 0, 40], 2);
  const f5 = [h1('5. Оценочные средства экзамена по модулю'),
    h2('5.1. Паспорт экзамена по модулю'),
    p(`Экзамен по модулю проводится (${c.meta.exam_label}) после завершения всех МДК и практик модуля. К экзамену допускаются обучающиеся, имеющие положительные оценки по всем элементам модуля. Экзамен принимает комиссия в составе не менее трёх человек с участием представителя работодателя.`),
    p('Экзамен состоит из частей:', { keepNext: true }),
    ...bullets(me.parts.map((x, i, a) => `${x.name} (${x.pk.join(', ')})${x.minutes ? ` — ${x.minutes} минут` : ''}${x.prep_minutes ? `, подготовка ${x.prep_minutes} минут` : ''}${i === a.length - 1 ? '.' : ';'}`)),
    p('Общие компетенции и личностные результаты оцениваются экспертным наблюдением в ходе экзамена.'),
    p(`Условия проведения: ${me.conditions}`),
    ...(me.portfolio ? [p(`Состав портфолио: ${me.portfolio}`)] : []),
    h2('5.2. Задания для экзамена по модулю'),
    p(`Задания выдаются в ${me.variants.length} вариантах одинакового объёма и сложности.`),
    ...me.variants.flatMap(v => [
      p(v.title, { bold: true, noIndent: true, before: 200, keepNext: true }),
      ...(v.data ? [p(`Исходные данные. ${v.data}`, { noIndent: true })] : []),
      ...olist(v.tasks.map(t => `${t.pk}. ${t.text}`), 22),
      ...(v.examiner_note ? [p(`Для экзаменатора (не выдаётся обучающемуся): ${v.examiner_note}`, { italics: true, noIndent: true, size: 22, before: 80 })] : []),
    ]),
    h2('5.3. Оценочный лист экзамена по модулю'),
    p(`Ф. И. О. обучающегося ________________________   Группа ${pj.group}   Вариант ___`, { noIndent: true, after: 120 }),
    table(wE, [hdr(['ПК', 'Критерий', 'Макс. балл', 'Балл'], wE), ...me.checklist.map(([k, t, pt]) => new TableRow({ children: [cell(k, wE[0]), cell(t, wE[1]), cell(String(pt), wE[2], { align: C }), cell('', wE[3])] })),
      new TableRow({ children: [cell('', wE[0]), cell('Итого', wE[1], { bold: true }), cell('100', wE[2], { bold: true, align: C }), cell('', wE[3])] })]),
    caption('Оценка общих компетенций и личностных результатов', { before: 200 }),
    table(wOL, [hdr(['ОК', 'ЛР', 'Наблюдаемое проявление', 'Проявлено / частично / нет'], wOL), ...OK_CODES.map(o => new TableRow({ children: [cell(o, wOL[0]), cell(lrStr(okLrMod[o] || []), wOL[1]), cell(okCrit[o][0], wOL[2]), cell('', wOL[3])] }))]),
    h2('5.4. Критерии итоговой оценки'),
    p(`Баллы суммируются (максимум 100). Вид деятельности признаётся освоенным, если по каждой ПК набрано не менее 50 % возможных баллов (${Object.entries(pkMax).map(([k, v]) => `${k} — не менее ${Math.ceil(v / 2)}`).join(', ')}) и сумма составляет не менее 60 баллов.`),
    simpleTable(widths(P_W, [60, 0], 1), ['Сумма баллов', 'Оценка'], [['90–100', '5 «отлично», вид деятельности освоен'], ['75–89', '4 «хорошо», вид деятельности освоен'], ['60–74', '3 «удовлетворительно», вид деятельности освоен'], ['менее 60 или не выполнено условие по одной из ПК', '2 «неудовлетворительно», вид деятельности не освоен']], { center: [0] }),
    p('Результаты экзамена оформляются протоколом (раздел 7, форма 5).', { before: 120 }),
  ];

  // 6. ключи
  const keyTable = (T, title) => {
    const half2 = Math.ceil(T.length / 2); const w = Array(4).fill(Math.floor(P_W / 4));
    const r = [];
    for (let i = 0; i < half2; i++) { const a = T[i], b = T[i + half2]; r.push(new TableRow({ children: [cell(String(i + 1), w[0], { align: C }), cell(LETTERS[a.answer], w[1], { align: C }), cell(b ? String(i + half2 + 1) : '', w[2], { align: C }), cell(b ? LETTERS[b.answer] : '', w[3], { align: C })] })); }
    return [p(title, { bold: true, noIndent: true, before: 160, after: 80, keepNext: true }), table(w, [hdr(['№ вопроса', 'Ответ', '№ вопроса', 'Ответ'], w), ...r])];
  };
  const f6 = [h1('6. Ключи к тестовым заданиям'), ...c.mdk.flatMap(md => keyTable(fos.tests[md.code] || [], `${md.code} «${md.name}»`)),
    ...(cwAnswers.length ? [p('Эталоны ответов к контрольным работам', { bold: true, noIndent: true, before: 200, after: 80 }), ...cwAnswers.map(x => p(x, { noIndent: true }))] : [])];

  // 7. формы
  const wA = widths(P_W, [10, 0, 30, 40], 1);
  const sig = t => p(t, { noIndent: true, before: 120 });
  const wPrt = widths(P_W, [10, 0, 45, 35, 25], 1);
  const wPro = widths(P_W, [10, 0, 18, 22, 35, 22], 1);
  const f7 = [h1('7. Формы документов'),
    caption('Форма 1. Аттестационный лист по учебной практике', { before: 0, after: 120 }),
    p(`Ф. И. О. обучающегося ______________________________  Группа ${pj.group}`, { noIndent: true }),
    p(`Сроки практики: с «__» ______ 20__ г. по «__» ______ 20__ г.  Место: ${org.short}`, { noIndent: true, after: 120 }),
    table(wA, [hdr(['№', 'Профессиональная компетенция', 'Освоена / не освоена', 'Подпись руководителя'], wA), ...PK.filter(([k]) => upPK.includes(k)).map(([k, n], i) => new TableRow({ children: [cell(String(i + 1), wA[0], { align: C }), cell(`${k}. ${n}`, wA[1]), cell('', wA[2]), cell('', wA[3])] }))]),
    sig('Итоговая оценка: ____________   Руководитель практики ____________ /____________/   «__» ______ 20__ г.'),
    pageBreak(),
    caption('Форма 2. Аттестационный лист по производственной практике', { before: 0, after: 120 }),
    p(`Ф. И. О. обучающегося ______________________________  Группа ${pj.group}`, { noIndent: true }),
    p('Организация ________________________________  Сроки: с «__» ______ по «__» ______ 20__ г.', { noIndent: true, after: 120 }),
    table(wA, [hdr(['№', 'Профессиональная компетенция', 'Качество выполнения работ (5–2)', 'Освоена / не освоена'], wA), ...PK.map(([k, n], i) => new TableRow({ children: [cell(String(i + 1), wA[0], { align: C }), cell(`${k}. ${n}`, wA[1]), cell('', wA[2]), cell('', wA[3])] }))]),
    sig('Руководитель от организации ____________ /____________/  М. П.'),
    sig('Руководитель от образовательной организации ____________ /____________/   Итоговая оценка: ________'),
    pageBreak(),
    caption('Форма 3. Характеристика обучающегося по итогам производственной практики', { before: 0, after: 120 }),
    p(`Ф. И. О. обучающегося ______________________________  Группа ${pj.group}`, { noIndent: true, after: 120 }),
    table(widths(P_W, [22, 60, 0], 2), [hdr(['ОК', 'Личностные результаты', 'Проявлено / частично / не проявлено'], widths(P_W, [22, 60, 0], 2)), ...OK_CODES.map(o => new TableRow({ children: [cell(o, mm(22)), cell(lrStr(okLrMod[o] || []), mm(60)), cell('', P_W - mm(82))] }))]),
    sig('Дополнительные сведения (дисциплина, ответственность, отношение к работе): ______________________________________________________________'),
    sig('Руководитель от организации ____________ /____________/  М. П.   «__» ______ 20__ г.'),
    pageBreak(),
    caption(`Форма 4. ${me.protocol_title || 'Протокол проверки результата выполнения задания'}`, { before: 0, after: 120 }),
    p('Объект проверки: ______________________  Вариант ___  Дата «__» ______ 20__ г.', { noIndent: true, after: 120 }),
    table(wPrt, [hdr(['№', 'Проверка', 'Метод', 'Ожидаемый результат', 'Факт'], wPrt), ...me.protocol_checks.map((r, i) => new TableRow({ children: [cell(String(i + 1), wPrt[0], { align: C }), cell(r[0], wPrt[1]), cell(r[1], wPrt[2]), cell(r[2], wPrt[3]), cell('', wPrt[4])] }))]),
    sig('Вывод: ______________________________________________'),
    sig('Проверку провёл ____________ /____________/'),
    pageBreak(),
    caption(`Форма 5. Протокол экзамена по профессиональному модулю ${pmTitle}`, { before: 0, after: 120 }),
    p(`Специальность ${fgos.code} ${fgos.name}, группа ${pj.group}. Дата «__» ______ 20__ г.`, { noIndent: true }),
    p('Состав комиссии: председатель ______________________; члены комиссии ______________________, ______________________ (представитель работодателя).', { noIndent: true, after: 120 }),
    table(wPro, [hdr(['№', 'Ф. И. О. обучающегося', 'Вариант', 'Сумма баллов', 'Вид деятельности освоен / не освоен', 'Оценка'], wPro), ...[1, 2, 3, 4, 5].map(i => new TableRow({ children: wPro.map((w, j) => cell(j ? '' : String(i), w, { align: C })) }))]),
    sig('Председатель комиссии ____________ /____________/'),
    sig('Члены комиссии ____________ /____________/   ____________ /____________/'),
  ];

  const fosBody = [...f1, pageBreak(), ...f2, pageBreak(), ...f3, pageBreak(), ...f4, pageBreak(), ...f5, pageBreak(), ...f6, pageBreak(), ...f7];

  const footer = () => new Footer({ children: [new Paragraph({ alignment: C, children: [new TextRun({ font: H.FONT, size: 22, children: [PageNumber.CURRENT] })] })] });
  const portrait = { page: { size: { width: 11906, height: 16838 }, margin: P_MARG } };
  const landscape = { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: L_MARG } };
  const doc = new Document({
    creator: org.short, title: `Рабочая программа ${pmTitle} с фондом оценочных средств`,
    styles: H.styles(), numbering: H.numberingConfig(),
    sections: [
      { properties: { ...portrait, titlePage: true }, footers: { default: footer(), first: new Footer({ children: [new Paragraph('')] }) }, children: [...titlePage, ...back, ...toc, ...sec1] },
      { properties: { ...landscape }, footers: { default: footer() }, children: sec2 },
      { properties: { ...portrait }, footers: { default: footer() }, children: [...sec3, pageBreak(), ...sec4, pageBreak(), ...fosBody] },
    ],
  });
  return { doc, TOC };
}

// --- номера страниц для содержания: рендер через LibreOffice и поиск заголовков в PDF ---
const { execFileSync } = require('child_process');
const os = require('os');
function which(cmd) { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } }
function findSoffice() {
  const cands = ['soffice', 'libreoffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  return cands.find(x => (x.includes('/') || x.includes('\\') ? fs.existsSync(x) : which(x)));
}
function pdfPagesText(pdf) {
  if (which('pdftotext')) return execFileSync('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 1 << 28 }).toString('utf8').split('\f');
  return null;
}
function locatePages(docxPath, TOC) {
  const soffice = findSoffice();
  if (!soffice) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgen-'));
  const src = path.join(tmp, 'doc.docx');
  fs.copyFileSync(docxPath, src);
  execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', tmp, src], { stdio: 'ignore', timeout: 180000 });
  const pages = pdfPagesText(path.join(tmp, 'doc.pdf'));
  if (!pages) return null;
  const norm = s => s.replace(/\s+/g, ' ');
  const res = {};
  let from = 3;
  for (const [key, , , needle] of TOC) {
    const n = norm(needle);
    for (let i = from; i < pages.length; i++) if (norm(pages[i]).includes(n)) { res[key] = i + 1; from = i; break; }
  }
  return res;
}

async function build(projectFile, opts = {}) {
  const ctx = loadProject(projectFile);
  if (!ctx.content) throw new Error(`Нет файла наполнения ${ctx.contentPath}. Сначала выполните init и fill.`);
  const v = validate(ctx.content);
  v.warnings.forEach(w => console.log('  предупреждение:', w));
  if (v.errors.length && !opts.force) {
    v.errors.forEach(e => console.log('  ОШИБКА:', e));
    throw new Error(`Наполнение не прошло проверку (${v.errors.length} ошибок). Исправьте или запустите с --force.`);
  }
  fs.mkdirSync(path.dirname(ctx.outputPath), { recursive: true });
  let { doc, TOC } = buildDocument(ctx);
  fs.writeFileSync(ctx.outputPath, await Packer.toBuffer(doc));
  let pages = null;
  if (!opts.noToc) {
    try { pages = locatePages(ctx.outputPath, TOC); } catch (e) { console.log('  не удалось посчитать страницы:', e.message); }
    if (pages) {
      ({ doc } = buildDocument(ctx, pages));
      fs.writeFileSync(ctx.outputPath, await Packer.toBuffer(doc));
      const check = locatePages(ctx.outputPath, TOC);
      if (check && JSON.stringify(check) !== JSON.stringify(pages)) {
        ({ doc } = buildDocument(ctx, check));
        fs.writeFileSync(ctx.outputPath, await Packer.toBuffer(doc));
      }
    } else console.log('  LibreOffice или pdftotext не найдены: номера страниц в содержании не проставлены. Проставьте их вручную после открытия в Word.');
  }
  return { output: ctx.outputPath, pages };
}

module.exports = { build, buildDocument, loadProject };
