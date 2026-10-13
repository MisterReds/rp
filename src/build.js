// Сборка единого документа по шаблону ГБПОУ «СПЭТ»: рабочая программа ПМ (разделы 1–4) + фонд оценочных средств (раздел 5).
// Названия разделов, тем, содержание тем, практические работы и виды работ практик берутся из ПОП без изменений.
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./docx_helpers.js');
const { D, mm, P_MARG, P_W, L_MARG, L_W, C, p, center, caption, h1, h2, h3, bullets, olist, pageBreak, cp, cell, table, hdr, simpleTable, widths } = H;
const { Document, Packer, Paragraph, TextRun, TableRow, Footer, PageNumber, AlignmentType, PageOrientation, VerticalAlign } = D;
const { loadPlan, semLabel } = require('./plan.js');
const { validate, parseCodes, OK_CODES } = require('./validate.js');
const { LESSON, mdkBlocks, practiceLabel } = require('./sequence.js');
const PP_DAY = 6;

const LETTERS = ['а', 'б', 'в', 'г'];
const L = AlignmentType.LEFT;
const uniq = a => [...new Set(a)];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const endDot = s => (/[.!?…]$/.test(s.trim()) ? s.trim() : s.trim() + '.');

// Формы аттестации: краткая отметка в таблице и название в родительном падеже
const FORM = {
  'Э': ['Э', 'экзамена', 'экзамен'], 'ДЗ': ['ДЗ', 'дифференцированного зачёта', 'дифференцированный зачёт'], 'З': ['З', 'зачёта', 'зачёт'],
  'ДР': ['КР', 'контрольной работы', 'контрольная работа'], 'КР': ['КР', 'контрольной работы', 'контрольная работа'],
};
const formGen = f => (FORM[f] ? FORM[f][1] : f);
const formNom = f => (FORM[f] ? FORM[f][2] : f);
const formAbbr = f => (FORM[f] ? FORM[f][0] : f);

// Сжатие номеров: [1,2,3,5] -> "1–3, 5"
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

function loadProject(projectFile) {
  const dir = path.dirname(path.resolve(projectFile));
  const pj = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  const rd = f => path.resolve(dir, f);
  const ctx = {
    dir, project: pj,
    fgos: JSON.parse(fs.readFileSync(rd(pj.fgos), 'utf8')),
    vosp: JSON.parse(fs.readFileSync(rd(pj.vospitanie), 'utf8')),
    pop: pj.pop ? JSON.parse(fs.readFileSync(rd(pj.pop), 'utf8')) : null,
    plan: loadPlan(rd(pj.plan)),
    contentPath: rd(pj.content || 'content.json'),
    outputPath: rd(pj.output || 'out.docx'),
  };
  if (fs.existsSync(ctx.contentPath)) ctx.content = JSON.parse(fs.readFileSync(ctx.contentPath, 'utf8'));
  return ctx;
}

function buildDocument(ctx) {
  const { project: pj, fgos, vosp, pop, content: c } = ctx;
  const org = pj.org;
  const PK = c.meta.pk;
  const pkCodes = PK.map(x => x[0]);
  const OK = fgos.ok;
  const LR = vosp.lr;
  const okLr = vosp.ok_lr;
  const LR_ALL = Object.keys(LR).map(Number).sort((a, b) => a - b);
  const lrFromOk = oks => uniq(oks.flatMap(o => okLr[o] || [])).sort((a, b) => a - b);
  const lrStr = arr => (arr.length ? 'ЛР ' + ranges(arr) : '');
  const pmTitle = `${c.meta.pm} ${c.meta.pm_name}`;
  const pmQ = `${c.meta.pm} «${c.meta.pm_name}»`;
  const spec = `${fgos.code} ${fgos.name}`;
  const res = pop.results;
  const crit = pop.criteria;

  // ---------- производные данные ----------
  const MB = c.mdk.map(m => ({ m, ...mdkBlocks(m) }));
  const themeCodes = th => parseCodes(th.codes);
  const mdkCodes = m => { const pk = [], ok = []; m.themes.forEach(th => { const x = themeCodes(th); pk.push(...x.pk); ok.push(...x.ok); }); return { pk: uniq(pk).sort(), ok: uniq(ok).sort() }; };
  const workCodes = arr => uniq(arr.flatMap(u => u.works.flatMap(w => parseCodes(w.codes).pk))).sort();
  const upH = c.up.reduce((a, x) => a + x.hours, 0), ppH = c.pp.reduce((a, x) => a + x.hours, 0);
  const sumT = c.mdk.reduce((a, x) => a + x.T, 0), sumP = c.mdk.reduce((a, x) => a + x.P, 0), sumK = c.mdk.reduce((a, x) => a + (x.K || 0), 0);
  const total = sumT + sumP + sumK + upH + ppH;
  const codesBlock = (pk, ok, lr) => [okStr(ok), pkStr(pk), lrStr(lr)].filter(Boolean);
  const semsOf = (m, f) => m.sems.filter(s => s.form === f).map(s => s.label);
  const mdkFormsText = m => {
    const parts = m.sems.filter(s => s.form).map(s => `${formGen(s.form)} (${s.label})`);
    return parts.length ? parts.join(' и ') : 'не предусмотрена';
  };
  const upForm = c.up.find(u => u.form);
  const ppForm = c.pp.find(u => u.form);

  // ---------- титульный лист ----------
  const titlePage = [
    center(org.ministry.toUpperCase(), { bold: true }),
    center(`ГБПОУ ${org.name}`, { bold: true, after: 3000 }),
    center('РАБОЧАЯ ПРОГРАММА ПРОФЕССИОНАЛЬНОГО МОДУЛЯ', { bold: true, size: 28, after: 240 }),
    center(pmTitle, { bold: true, size: 28, after: 480 }),
    center(`для студентов группы ${pj.group}`, { after: 120 }),
    center('обучающихся по специальности', { after: 120 }),
    center(spec, { bold: true, after: 5200 }),
    center(`г. ${org.city}, ${pj.year} год`),
    pageBreak(),
  ];
  const ppl = pj.people || {};
  const back = [
    p(`Составлена в соответствии с Федеральным государственным образовательным стандартом среднего профессионального образования (далее ФГОС СПО), утвержденным ${fgos.order_by} приказом от ${fgos.order_date} и зарегистрированным в Минюсте России ${fgos.minjust} по специальности ${spec}, а также на основе Методических указаний ${org.short} и примерной программы, а также в соответствии с требованиями технического описания компетенции чемпионата по профессиональному мастерству «Профессионалы»:`, { after: 120 }),
    center(pj.competence || '', { bold: true, after: 600 }),
    p(`Рассмотрено на заседании ПЦК ${pj.pcc || ''}`, { noIndent: true }),
    p('Протокол № ___  от ____________ г.', { noIndent: true }),
    p(`ППЦК __________ ${ppl.pcc_head || 'Ф.И.О.'}`, { noIndent: true, after: 360 }),
    p('Рассмотрено на заседании', { noIndent: true }),
    p(`Методического совета ${org.short}`, { noIndent: true }),
    p('Протокол № _____  от _____________ г.', { noIndent: true }),
    p(`Председатель МС ________ ${ppl.ms_head || 'Ф.И.О.'}`, { noIndent: true, after: 360 }),
    p(`Составитель: ${ppl.developer || 'Ф.И.О., преподаватель ' + org.short}`, { noIndent: true, after: 240 }),
    ...(ppl.reviewers || ['Ф.И.О., должность', 'Ф.И.О., должность']).map(r => p(`Рецензент: ${r}`, { noIndent: true, after: 120 })),
    pageBreak(),
  ];

  // ---------- раздел 1 ----------
  const w2 = widths(P_W, [25, 0], 1);
  const listCell = (items, w) => cell((items || []).map((t, i, a) => t.replace(/[;.]\s*$/, '') + (i === a.length - 1 ? '.' : ';')), w);
  const wR = widths(P_W, [20, 0, 0, 0], 1);
  { const rest = P_W - wR[0]; wR[1] = Math.floor(rest / 3); wR[2] = Math.floor(rest / 3); wR[3] = rest - wR[1] - wR[2]; }
  const resultsTable = table(wR, [hdr(['Код ОК, ПК', 'Уметь', 'Знать', 'Владеть навыками'], wR),
    ...OK_CODES.map(o => new TableRow({ children: [cell(o, wR[0]), listCell((res.ok[o] || {}).um, wR[1]), listCell((res.ok[o] || {}).zn, wR[2]), listCell((res.ok[o] || {}).nav, wR[3])] })),
    ...pkCodes.map(k => new TableRow({ children: [cell(k, wR[0]), listCell((res.pk[k] || {}).um, wR[1]), listCell((res.pk[k] || {}).zn, wR[2]), listCell((res.pk[k] || {}).nav, wR[3])] }))]);

  // 1.3 распределение часов по семестрам
  const lastSem = Math.max(...c.mdk.flatMap(m => m.sems.map(s => s.sem)), ...c.up.map(u => u.sem), ...c.pp.map(u => u.sem), c.meta.exam_sem);
  const nS = Math.max(6, lastSem + 1);
  const w13 = [mm(10), 0, ...Array(nS).fill(mm(nS > 6 ? 10 : 13)), mm(15)];
  w13[1] = P_W - w13.reduce((a, b) => a + b, 0);
  const semCells = (vals, o = {}) => Array.from({ length: nS }, (_, i) => cell(vals[i] === undefined || vals[i] === null ? '' : String(vals[i]), w13[2 + i], { align: C, ...o }));
  const r13 = (num, label, vals, tot, o = {}) => new TableRow({ children: [cell(num, w13[0], { align: C, ...o }), cell(label, w13[1], o), ...semCells(vals, o), cell(tot === undefined ? '' : String(tot), w13[2 + nS], { align: C, ...o })] });
  const rows13 = [
    new TableRow({ tableHeader: true, children: [cell('№ п/п', w13[0], { bold: true, align: C, rowSpan: 2, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' }), cell('Нагрузка обучающегося', w13[1], { bold: true, align: C, rowSpan: 2, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' }), cell('Номер семестра', w13.slice(2, 2 + nS).reduce((a, b) => a + b, 0), { bold: true, align: C, colSpan: nS, shade: 'EDEDED' }), cell('Всего часов', w13[2 + nS], { bold: true, align: C, rowSpan: 2, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' })] }),
    new TableRow({ tableHeader: true, children: Array.from({ length: nS }, (_, i) => cell(String(i + 1), w13[2 + i], { bold: true, align: C, shade: 'EDEDED' })) }),
  ];
  const semTot = Array(nS).fill(0);
  let rn = 0;
  MB.forEach(({ m, blocks }) => {
    const h = [], t = [], pr = [], f = [];
    blocks.forEach(b => { h[b.sem] = b.hours; t[b.sem] = b.T; pr[b.sem] = b.P; if (b.form) f[b.sem] = formAbbr(b.form); semTot[b.sem] += b.hours; });
    rows13.push(r13(`${++rn}.`, `${m.code} «${m.name}»`, h, m.T + m.P + (m.K || 0), { bold: true }),
      r13('', 'Обязательной аудиторной учебной нагрузки', h, m.T + m.P + (m.K || 0)),
      r13('', 'в том числе: теоретических занятий', t, m.T),
      r13('', 'лабораторно-практических занятий', pr, m.P),
      ...(m.K ? [r13('', 'курсовой проект (работа)', m.sems.map(s => s.K || ''), m.K)] : []),
      r13('', 'Самостоятельная работа', [], '—'),
      r13('', `Промежуточная аттестация в форме ${mdkFormsText(m)}`, f, ''));
  });
  const practRows = (arr, title, kind) => {
    if (!arr.length) return;
    const h = [], f = [];
    arr.forEach(u => { h[u.sem] = u.hours; semTot[u.sem] += u.hours; if (u.form) f[u.sem] = formAbbr(u.form); });
    rows13.push(r13(`${++rn}.`, `${title} ${arr[0].code}`, h, arr.reduce((a, x) => a + x.hours, 0), { bold: true }));
    const fm = arr.find(u => u.form);
    if (fm) rows13.push(r13('', `Промежуточная аттестация в форме ${formGen(fm.form)} (${fm.label})`, f, ''));
    else rows13.push(r13('', kind === 'pp' ? 'Промежуточная аттестация не проводится; по окончании практики обучающийся оформляет отчёт по практике' : 'Промежуточная аттестация не проводится', arr.map(() => null).reduce((a, _, i) => { a[arr[i].sem] = kind === 'pp' ? 'отчёт' : ''; return a; }, []), ''));
  };
  practRows(c.up, 'Учебная практика', 'up');
  practRows(c.pp, 'Производственная практика', 'pp');
  rows13.push(r13(`${++rn}.`, `Экзамен по модулю ${c.meta.pm}`, Object.assign([], { [c.meta.exam_sem]: 'Эк' }), '', { bold: true }));
  rows13.push(r13('', 'Итого', semTot.map(x => x || ''), total, { bold: true }));

  const hoursLines = [
    `Всего часов ${total}`,
    ...c.mdk.map((m, i) => `${i ? 'на освоение' : 'Из них на освоение'} ${m.code} «${m.name}» — ${m.T + m.P + (m.K || 0)}`),
    `на практики, в том числе учебную ${upH} и производственную ${ppH}`,
  ];

  const sec1 = [
    h1('1. Общая характеристика рабочей программы профессионального модуля'),
    center(`«${pmTitle}»`, { bold: true, after: 200 }),
    h2('1.1. Цель и планируемые результаты освоения профессионального модуля'),
    p(`В результате изучения профессионального модуля студент должен освоить основной вид деятельности «${c.meta.pm_name}» и соответствующие ему общие компетенции и профессиональные компетенции, а также достичь личностных результатов:`),
    h3('1.1.1. Перечень общих компетенций'),
    table(w2, [hdr(['Код', 'Наименование общих компетенций'], w2), ...OK.map(([k, n]) => new TableRow({ children: [cell(k, w2[0]), cell(n, w2[1])] }))]),
    h3('1.1.2. Перечень профессиональных компетенций'),
    table(w2, [hdr(['Код', 'Наименование видов деятельности и профессиональных компетенций'], w2),
      new TableRow({ children: [cell(c.meta.vd, w2[0], { bold: true }), cell(c.meta.pm_name, w2[1], { bold: true })] }),
      ...PK.map(([k, n]) => new TableRow({ children: [cell(k, w2[0]), cell(n, w2[1])] }))]),
    h3('1.1.3. В результате освоения программы профессионального модуля студент должен:'),
    p(pop.results_intro, { after: 120 }),
    resultsTable,
    h3('1.1.4. В процессе изучения профессионального модуля обучающийся должен достигать следующих личностных результатов в соответствии с программой воспитания по специальности:'),
    table(w2, [hdr(['Код ЛР из программы воспитания', 'Наименование личностных результатов'], w2), ...LR_ALL.map(n => new TableRow({ children: [cell('ЛР ' + n, w2[0]), cell(LR[n], w2[1])] }))]),
    p(`Источник: ${vosp.title}.`, { size: 22, noIndent: true, before: 80 }),
    h2('1.2. Количество часов, отводимых на освоение профессионального модуля'),
    ...hoursLines.map(t => p(t, { noIndent: true })),
    h2(`1.3. Распределение часов, отводимых на освоение профессионального модуля «${c.meta.pm_name}», по семестрам:`),
    table(w13, rows13),
  ];

  // ---------- раздел 2 ----------
  const wS = widths(L_W, [45, 0, 18, 16, 24, 18, 18, 22, 22, 20], 1);
  const hc = (t, w, o = {}) => cell(t, w, { bold: true, align: C, vAlign: VerticalAlign.CENTER, shade: 'EDEDED', ...o });
  const sumW = (a, b) => wS.slice(a, b).reduce((x, y) => x + y, 0);
  const allOk = OK_CODES;
  const structRows = [
    ...c.mdk.map(m => { const x = mdkCodes(m); return [codesBlock(x.pk, x.ok, lrFromOk(x.ok)), `${m.section} (${m.code})`, m.T + m.P + (m.K || 0), m.T + m.P + (m.K || 0), m.P, m.K || '—', '—', '—', '—', '—']; }),
    ...(c.up.length ? [[codesBlock(workCodes(c.up), allOk, lrFromOk(allOk)), `Учебная практика ${c.up[0].code}, часов`, upH, '—', '—', '—', upH, '—', '—', '—']] : []),
    ...(c.pp.length ? [[codesBlock(workCodes(c.pp), allOk, lrFromOk(allOk)), `Производственная практика (по профилю специальности) ${c.pp[0].code}, часов`, ppH, '—', '—', '—', '—', ppH, '—', '—']] : []),
  ];
  const struct = table(wS, [
    new TableRow({ tableHeader: true, children: [hc('Коды профессиональных общих компетенций', wS[0], { rowSpan: 3 }), hc('Наименования разделов профессионального модуля', wS[1], { rowSpan: 3 }), hc('Суммарный объем нагрузки, час.', wS[2], { rowSpan: 3 }), hc('Объем профессионального модуля, час.', sumW(3, 9), { colSpan: 6 }), hc('Самостоятельная работа', wS[9], { rowSpan: 3 })] }),
    new TableRow({ tableHeader: true, children: [hc('Обучение по МДК', sumW(3, 6), { colSpan: 3 }), hc('Практики', sumW(6, 8), { colSpan: 2 }), hc('Промежуточная аттестация', wS[8], { rowSpan: 2 })] }),
    new TableRow({ tableHeader: true, children: [hc('Всего', wS[3]), hc('Лабораторных и практических занятий', wS[4]), hc('Курсовых работ (проектов)', wS[5]), hc('Учебная', wS[6]), hc('Производственная', wS[7])] }),
    new TableRow({ tableHeader: true, children: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((t, i) => cell(t, wS[i], { align: C })) }),
    ...structRows.map(r => new TableRow({ children: r.map((v, i) => cell(Array.isArray(v) ? v : String(v), wS[i], { align: i >= 2 ? C : L })) })),
    new TableRow({ children: [cell('', wS[0]), cell('Всего:', wS[1], { bold: true }), ...[total, sumT + sumP + sumK, sumP, sumK || '—', upH, ppH, '—', '—'].map((v, i) => cell(String(v), wS[i + 2], { bold: true, align: C }))] }),
  ]);

  const wC = widths(L_W, [55, 0, 20, 42], 1);
  const span2 = wC[0] + wC[1];
  const fullRow = (text, o = {}) => new TableRow({ children: [cell(text, L_W, { colSpan: 4, ...o })] });
  const ktpHead = () => [hdr(['Наименование разделов профессионального модуля (ПМ), междисциплинарных курсов (МДК) и тем', 'Содержание учебного материала, лабораторные работы и практические занятия, самостоятельная работа обучающихся, курсовая работа (проект), учебная практика', 'Объем часов', 'Коды компетенции, формированию которых способствует элемент программы'], wC),
    new TableRow({ tableHeader: true, children: ['1', '2', '3', '4'].map((t, i) => cell(t, wC[i], { align: C })) })];
  const lineRow = (text, hours, o = {}) => new TableRow({ children: [cell(text, span2, { colSpan: 2, ...o }), cell(hours === undefined ? '' : String(hours), wC[2], { align: C, ...o }), cell(o.codes || '', wC[3])] });
  const ktp = [];
  MB.forEach(({ m, blocks }, mi) => {
    ktp.push(h3(`2.2.${mi + 1}. Календарно-тематический план и содержание междисциплинарного курса ${m.code} «${m.name}»`));
    const rows = ktpHead();
    const mc = mdkCodes(m);
    blocks.forEach((b, bi) => {
      rows.push(fullRow(b.label, { bold: true, align: C, shade: 'F2F2F2' }));
      rows.push(fullRow(`теор ${b.T} ч, п/р ${b.P} ч, с/р 0 ч${b.K ? `, курсовой проект ${b.K} ч` : ''}`, { italics: true }));
      if (bi === 0) rows.push(new TableRow({ children: [cell(m.section, span2, { colSpan: 2, bold: true }), cell(String(m.T + m.P + (m.K || 0)), wC[2], { bold: true, align: C }), cell(codesBlock(mc.pk, mc.ok, lrFromOk(mc.ok)), wC[3])] }));
      b.groups.forEach(g => {
        const th = g.theme;
        const x = themeCodes(th);
        const span = 1 + g.lessons.length;
        rows.push(new TableRow({ children: [
          cell([cp(`${th.num} ${th.name}`, { bold: true })], wC[0], { rowSpan: span }),
          cell([cp(g.cont ? 'Содержание учебного материала (продолжение темы):' : 'Содержание учебного материала (перечень дидактических единиц):', { bold: true }), ...th.content.map(t => cp(t))], wC[1]),
          cell('', wC[2]),
          cell(codesBlock(x.pk, x.ok, lrFromOk(x.ok)), wC[3], { rowSpan: span }),
        ] }));
        g.lessons.forEach(l => rows.push(new TableRow({ children: [cell(`${l.num}. ${l.kind === 'T' ? l.title : practiceLabel(l)}`, wC[1]), cell(String(LESSON), wC[2], { align: C })] })));
      });
      if (b.K && m.course_project) {
        const cpj = m.course_project;
        rows.push(lineRow([cp('Курсовой проект (работа). Тематика:', { bold: true }), ...cpj.topics.map((t, i) => cp(`${i + 1}. ${t}`))], b.K));
      }
      if (bi === blocks.length - 1) rows.push(lineRow('Самостоятельная работа (по разделу, МДК): учебным планом не предусмотрена', '—'));
      if (b.form) rows.push(lineRow(`Промежуточная аттестация в форме ${formGen(b.form)}`, '—', { italics: true }));
    });
    rows.push(lineRow(`Всего по ${m.code}`, m.T + m.P + (m.K || 0), { bold: true }));
    ktp.push(table(wC, rows));
  });
  const practiceKtp = (arr, kind, num) => {
    if (!arr.length) return;
    const title = kind === 'up' ? `Содержание учебной практики ${arr[0].code}` : `Содержание производственной практики ${arr[0].code}`;
    ktp.push(h3(`2.2.${num}. ${title}`));
    const rows = ktpHead();
    let n = 0, v = 0;
    arr.forEach(u => {
      rows.push(fullRow(u.label, { bold: true, align: C, shade: 'F2F2F2' }));
      rows.push(fullRow(kind === 'up' ? `${u.hours} ч (${u.hours / LESSON} занятий по ${LESSON} ч)` : `${u.hours} ч (${u.days} дней по ${PP_DAY} ч)`, { italics: true }));
      u.works.forEach(w => {
        v += 1;
        const lines = [];
        if (kind === 'up') w.tasks.forEach(([t, h]) => { const k = h / LESSON; for (let i = 1; i <= k; i++) lines.push([k > 1 ? `${t} (часть ${i})` : t, LESSON]); });
        else w.days.forEach(d => lines.push([d, PP_DAY]));
        const pk = parseCodes(w.codes).pk;
        rows.push(new TableRow({ children: [
          cell([cp(`Вид работ ${v}. ${cap(w.name)}`, { bold: true })], wC[0], { rowSpan: 1 + lines.length }),
          cell([cp('Содержание работ:', { bold: true })], wC[1]), cell('', wC[2]),
          cell(codesBlock(pk, allOk, lrFromOk(allOk)), wC[3], { rowSpan: 1 + lines.length }),
        ] }));
        lines.forEach(([t, h]) => rows.push(new TableRow({ children: [cell(`${++n}. ${t}`, wC[1]), cell(String(h), wC[2], { align: C })] })));
      });
      if (u.form) rows.push(lineRow(`Промежуточная аттестация в форме ${formGen(u.form)}`, '—', { italics: true }));
      else if (kind === 'pp') rows.push(lineRow('По окончании практики обучающийся оформляет и сдаёт отчёт по практике', '—', { italics: true }));
    });
    rows.push(lineRow(`Всего по ${arr[0].code}`, arr.reduce((a, x) => a + x.hours, 0), { bold: true }));
    ktp.push(table(wC, rows));
  };
  practiceKtp(c.up, 'up', c.mdk.length + 1);
  practiceKtp(c.pp, 'pp', c.mdk.length + 2);
  const sec2 = [
    h1('2. Структура и содержание программы профессионального модуля'),
    h2('2.1. Структура профессионального модуля'), struct,
    h2('2.2. Содержание профессионального модуля'),
    ...ktp,
  ];

  // ---------- раздел 3 ----------
  const cnd = c.program.conditions;
  const eq = cnd.equipment || {};
  const semi = arr => arr.map((e, i, a) => e.replace(/[;.]\s*$/, '') + (i === a.length - 1 ? '.' : ';'));
  const wT6 = widths(P_W, [50, 0], 1);
  const digital = pj.digital_tools || [
    ['Power Point', 'Подготовка к практическим занятиям по МДК. Для проведения занятий используются презентации'],
    ['Видеофильмы', 'Иллюстративные материалы при изучении тем — на платформе https://rutube.ru/'],
    ['Электронная почта', 'Сетевой ресурс, используемый для коммуникации с обучающимися. Кроме того, применяется для осуществления контроля учебного процесса (переписка: ответы на текущие вопросы, проверка отчётов по практическим работам)'],
    ['Сферум', 'Консультирование обучающихся при подготовке к экзаменам по МДК и экзамену по модулю'],
    ['Поисковый Яндекс/Google', 'Организация работы обучающихся при подготовке к занятиям, обеспечивая им доступ к информационным веб-ресурсам по изучаемым темам и документации производителей сетевого оборудования'],
    ['Файлообменник (Яндекс-диск)', 'Используется для обмена файлами разных форматов (текстами, презентациями, файлами конфигураций и захвата трафика) между преподавателем и обучающимися (как резервный канал связи при возникновении проблем на платформе системы дистанционного обучения (СДО) Moodle)'],
    ['Эмуляторы сетей (Cisco Packet Tracer, GNS3, EVE-NG)', 'Моделирование сетей и выполнение практических работ при отсутствии физического оборудования; подготовка к экзамену по модулю'],
    ['Мобильное приложение', 'Используется мессенджер, который позволяет поддерживать коммуникацию с обучающимися как на занятиях, так и вне их (решать возникающие проблемы, в основном организационного характера)'],
    ['Социальная сеть', '«ВКонтакте» для коммуникации с обучающимися'],
    ['Технологии электронной идентификации личности', 'Используется в процессе проведения экзамена в онлайн-режиме'],
    ['Интернет вещей', 'Используются электронная доска для презентаций; мобильные телефоны, интернет-доступ в систему СДО Moodle (https://local.spet.pro)'],
  ];
  const sec3 = [
    h1('3. Условия реализации программы профессионального модуля'),
    h2('3.1. Для реализации программы профессионального модуля должны быть предусмотрены следующие специальные помещения:'),
    ...bullets(semi(pop.rooms)),
    p('Помещение кабинета должно соответствовать требованиям санитарных правил (СП 2.4.3648-20 "Санитарно-эпидемиологические требования к организациям воспитания и обучения, отдыха и оздоровления детей и молодежи"): оснащено типовым оборудованием, в том числе специализированной учебной мебелью и средствами обучения, необходимыми для выполнения требований к уровню подготовки обучающихся.', { before: 120 }),
    p('Оборудование учебного кабинета:', { keepNext: true }),
    ...bullets(semi(eq.cabinet || [])),
    p(`${pop.rooms.filter(r => /Лаборатор|Мастерск/.test(r)).map(r => r.replace(/,?\s*оснащенн.*$/, '')).join(' и ')}, оснащённые необходимым для реализации программы профессионального модуля оборудованием:`, { keepNext: true, before: 120 }),
    ...bullets(semi([...(eq.lab || []), ...(eq.workshop || [])])),
    p('Технические средства обучения:', { keepNext: true, before: 120 }),
    ...bullets(semi(['персональный компьютер с лицензионным программным обеспечением (операционная система, текстовый процессор, программа презентаций, браузер с доступом в Интернет)', 'проектор с экраном', ...(cnd.software || [])])),
    p('Залы:', { keepNext: true, before: 120 }),
    ...bullets(['библиотека, читальный зал с выходом в сеть Интернет.']),
    p(`Цифровые инструменты для достижения результатов обучения по ${c.meta.pm} «${c.meta.pm_name}»`, { before: 200, bold: true, noIndent: true, align: C }),
    p('Таблица 6', { noIndent: true, align: AlignmentType.RIGHT, keepNext: true }),
    simpleTable(wT6, ['Цифровые инструменты', 'Применение цифровых инструментов для достижения результатов профессионального модуля'], digital),
    h2('3.2. Информационное обеспечение реализации программы'),
    p('Информационное обеспечение реализации программы профессионального модуля представляет собой совокупность информационного обеспечения реализации программ междисциплинарных курсов, учебной и производственной практики, которые составляют содержательную часть программы профессионального модуля (п. 2.2 настоящей программы).'),
    p('Основные источники:', { bold: true, keepNext: true, before: 120 }),
    ...olist(pop.literature_main),
    p('Дополнительные источники:', { bold: true, keepNext: true, before: 120 }),
    ...olist(pop.literature_add),
    h2('3.3. Кадровое обеспечение образовательного процесса'),
    p('Требования к квалификации педагогических кадров, обеспечивающих обучение по профессиональному модулю: наличие высшего / среднего профессионального образования, соответствующего профилю преподаваемого профессионального модуля.'),
    p(`Реализация образовательной программы осуществляется педагогическими работниками образовательной организации, а также лицами, привлекаемыми к реализации образовательной программы на условиях гражданско-правового договора, в том числе из числа руководителей и работников организаций, направление деятельности которых соответствует области профессиональной деятельности ${fgos.professional_area}, указанной в ФГОС СПО (имеющих стаж работы в данной профессиональной области не менее 3 лет).`),
    p('Квалификация педагогических работников образовательной организации должна отвечать квалификационным требованиям, указанным в квалификационных справочниках, и (или) профессиональных стандартах (при наличии).'),
    p(`Педагогические работники, привлекаемые к реализации образовательной программы, должны получать дополнительное профессиональное образование по программам повышения квалификации, в том числе в форме стажировки в организациях, направление деятельности которых соответствует области профессиональной деятельности, указанной в ФГОС СПО по специальности ${spec}, не реже 1 раза в 3 года с учетом расширения спектра профессиональных компетенций.`),
    p('Педагогические работники, участвующие в реализации адаптированной образовательной программы, должны быть ознакомлены с психофизическими особенностями обучающихся инвалидов и обучающихся с ограниченными возможностями здоровья и учитывать их при организации образовательного процесса.'),
  ];

  // ---------- раздел 4 ----------
  const worksOf = (m, pk) => m.themes.filter(th => themeCodes(th).pk.includes(pk));
  const w4 = widths(P_W, [38, 0, 42, 45], 1);
  const groupRow = t => new TableRow({ children: [cell(t, P_W, { colSpan: 4, bold: true, shade: 'F2F2F2' })] });
  const scale = ['«5» — действие выполнено полностью и самостоятельно, результат соответствует заданию', '«4» — выполнено полностью, допущены 1–2 несущественные ошибки, исправленные самостоятельно', '«3» — выполнено не менее чем на 60 %, основной результат достигнут с помощью преподавателя', '«2» — выполнено менее чем на 60 % или результат не достигнут'];
  const pkMethodsPop = (crit['ПК 1.1'] || {}).methods || [];
  const popMethods = pkMethodsPop.filter(x => !/курсов/i.test(x) || c.mdk.some(m => m.K));
  const evalRows = [hdr(['Код и наименование ПК, ОК', 'Оцениваемые знания и умения, действия', 'Методы оценки', 'Критерии оценки'], w4)];
  MB.forEach(({ m }) => {
    evalRows.push(groupRow(`${m.section} (${m.code} «${m.name}»)`));
    const formsTxt = m.sems.filter(s => s.form).map(s => `${formNom(s.form)} (${s.label})`).join('; ');
    mdkCodes(m).pk.forEach(k => {
      const ths = worksOf(m, k);
      const wn = ths.flatMap(th => (th.works || []).map(w => w.n));
      evalRows.push(new TableRow({ children: [
        cell(`${k}. ${PK.find(x => x[0] === k)[1]}`, w4[0]),
        cell([`Знания, умения и навыки по ${k} (п. 1.1.3), формируемые в темах ${ths.map(th => th.num.replace(/^Тема\s*/, '').replace(/\.$/, '')).join(', ')}.`, ...(wn.length ? [`Действия: выполнение практических работ № ${ranges(wn)}.`] : [])], w4[1]),
        cell([`Текущий контроль: устный опрос, тестирование, экспертное наблюдение и оценка на практических занятиях, защита отчётов по практическим работам${wn.length ? ` № ${ranges(wn)}` : ''}.`, `Промежуточная аттестация: ${formsTxt || 'не предусмотрена'}.`, `Итоговый контроль: экзамен по модулю (${c.meta.exam_label}).`], w4[2]),
        cell([...((crit[k] || {}).criteria || []).map(x => '– ' + x), 'Оценка — по шкале таблицы 4.1.2.'], w4[3]),
      ] }));
    });
  });
  const practicePk = uniq([...workCodes(c.up), ...workCodes(c.pp)]).sort();
  if (practicePk.length) {
    evalRows.push(groupRow(`Учебная практика ${c.up.length ? c.up[0].code : ''} и производственная практика ${c.pp.length ? c.pp[0].code : ''}`));
    practicePk.forEach(k => {
      const upW = c.up.flatMap(u => u.works).map((w, i) => [w, i + 1]).filter(([w]) => parseCodes(w.codes).pk.includes(k)).map(x => x[1]);
      const ppW = c.pp.flatMap(u => u.works).map((w, i) => [w, i + 1]).filter(([w]) => parseCodes(w.codes).pk.includes(k)).map(x => x[1]);
      evalRows.push(new TableRow({ children: [
        cell(`${k}. ${PK.find(x => x[0] === k)[1]}`, w4[0]),
        cell([`Практический опыт (навыки) по ${k} (п. 1.1.3).`, ...(upW.length ? [`УП: виды работ № ${ranges(upW)}.`] : []), ...(ppW.length ? [`ПП: виды работ № ${ranges(ppW)}.`] : [])], w4[1]),
        cell([...(upW.length ? [`Учебная практика: наблюдение за выполнением работ, проверка результатов, аттестационный лист; ${upForm ? formNom(upForm.form) + ` (${upForm.label})` : 'отчёт по практике'}.`] : []), ...(ppW.length ? [`Производственная практика: аттестационный лист и характеристика руководителя от профильной организации; отчёт по практике${ppForm ? `; ${formNom(ppForm.form)}` : ''}.`] : []), `Итоговый контроль: экзамен по модулю (${c.meta.exam_label}).`], w4[2]),
        cell([...((crit[k] || {}).criteria || []).map(x => '– ' + x), 'Оценка — по шкале таблицы 4.1.2.'], w4[3]),
      ] }));
    });
  }
  evalRows.push(groupRow('Общие компетенции (все разделы модуля, учебная и производственная практика)'));
  OK.forEach(([k, n]) => evalRows.push(new TableRow({ children: [
    cell(`${k}. ${n}`, w4[0]),
    cell(`Знания и умения по ${k} (п. 1.1.3).`, w4[1]),
    cell([...((crit[k] || {}).methods || [])].map(endDot), w4[2]),
    cell(((crit[k] || {}).criteria || []).map(x => '– ' + x), w4[3]),
  ] })));

  const attLines = [
    ...c.mdk.map(m => `Промежуточная аттестация по ${m.code} «${m.name}» осуществляется в форме ${mdkFormsText(m)}.`),
    ...c.up.length ? [upForm ? `Промежуточная аттестация по учебной практике ${c.up[0].code} осуществляется в форме ${formGen(upForm.form)} (${upForm.label}) по результатам выполнения видов работ и отчёта по практике.` : `Промежуточная аттестация по учебной практике ${c.up[0].code} не проводится.`] : [],
    ...c.pp.length ? [ppForm ? `Промежуточная аттестация по производственной практике ${c.pp[0].code} осуществляется в форме ${formGen(ppForm.form)} (${ppForm.label}).` : `Промежуточная аттестация по производственной практике ${c.pp[0].code} не проводится; по окончании практики обучающийся оформляет и сдаёт отчёт по практике.`] : [],
    `Итоговой формой контроля по профессиональному модулю является экзамен по модулю (${c.meta.exam_label}). К экзамену допускаются обучающиеся, освоившие ${c.mdk.map(m => m.code).join(', ')}${c.up.length ? ', ' + c.up[0].code : ''}${c.pp.length ? ' и ' + c.pp[0].code : ''}.`,
  ];
  const lrMeth = c.program.lr_methods || {};
  const w42 = widths(P_W, [22, 0, 70], 1);
  const lrRows = LR_ALL.map(n => {
    const oks = OK_CODES.filter(o => (okLr[o] || []).includes(n));
    const meth = oks.length ? oks.map(o => `${o}: ${lrMeth[o] || ''}`) : [lrMeth.none || ''];
    return new TableRow({ children: [cell('ЛР ' + n, w42[0]), cell(LR[n], w42[1]), cell(meth, w42[2])] });
  });
  const sec4 = [
    h1('4. Контроль и оценка результатов освоения программы профессионального модуля'),
    h2('4.1. Контроль и оценка результатов освоения программы профессионального модуля включает текущий контроль успеваемости и промежуточную аттестацию.'),
    p('Текущий контроль проводится в форме устных опросов по темам, тестирования, выполнения и защиты практических работ. Самостоятельная внеаудиторная работа учебным планом не предусмотрена.'),
    p('В основе текущего контроля используется пятибалльная шкала оценки («5» отлично, «4» хорошо, «3» удовлетворительно, «2» неудовлетворительно).'),
    p('Формы и методы текущего контроля по профессиональному модулю доводятся до сведения обучающихся в начале изучения модуля.'),
    p('По рабочей программе создан фонд оценочных средств (ФОС), который включает в себя педагогические контрольно-оценочные средства, предназначенные для определения соответствия (или несоответствия) персональных образовательных достижений основным показателям результатов подготовки профессионального модуля (раздел 5 настоящей программы: по каждому МДК с разбивкой по семестрам, по учебной и производственной практике, по экзамену по модулю).'),
    ...attLines.map(t => p(t)),
    p('Таблица 4.1.1', { noIndent: true, align: AlignmentType.RIGHT, keepNext: true, before: 120 }),
    table(w4, evalRows),
    p('Таблица 4.1.2. Шкала оценки освоения профессиональных компетенций', { noIndent: true, align: AlignmentType.RIGHT, keepNext: true, before: 200 }),
    simpleTable(widths(P_W, [45, 0], 1), ['Оценка', 'Критерий'], scale.map(x => [x.slice(0, 3).replace(/[«»]/g, '') + ' ' + ({'«5»':'«отлично»','«4»':'«хорошо»','«3»':'«удовлетворительно»','«2»':'«неудовлетворительно»'})[x.slice(0, 3)], cap(x.slice(6))])),
    h2('4.2. Контроль формирования личностных результатов в соответствии с программой воспитания'),
    table(w42, [hdr(['Код ЛР', 'Личностные результаты реализации программы воспитания', 'Методы и формы обучения, способствующие достижению обучающимися ЛР'], w42), ...lrRows]),
  ];

  // ---------- раздел 5: ФОС по элементам модуля (МДК по семестрам, практики, экзамен по модулю) ----------
  const fos = c.fos;
  const me = fos.module_exam;
  const crit5 = rows => simpleTable(widths(P_W, [45, 0], 1), ['Оценка', 'Критерий'], rows);
  const prCrit = crit5([
    ['5 «отлично»', 'Работа выполнена полностью, результат соответствует заданию, отчёт оформлен, на контрольные вопросы даны полные ответы'],
    ['4 «хорошо»', 'Работа выполнена полностью, допущены 1–2 несущественные ошибки, исправленные после замечания'],
    ['3 «удовлетворительно»', 'Работа выполнена не менее чем на 60 %, основной результат достигнут, ответы на вопросы неполные'],
    ['2 «неудовлетворительно»', 'Работа выполнена менее чем на 60 % или результат не достигнут']]);
  const testScale = simpleTable(widths(P_W, [70, 0], 1), ['Доля верных ответов, %', 'Оценка'], [['90–100', '5 «отлично»'], ['75–89', '4 «хорошо»'], ['60–74', '3 «удовлетворительно»'], ['менее 60', '2 «неудовлетворительно»']], { center: [0, 1] });
  const examCrit = crit5([
    ['5 «отлично»', 'Полные ответы на оба теоретических вопроса; практическое задание выполнено полностью'],
    ['4 «хорошо»', 'Ответы с несущественными неточностями; практическое задание выполнено с 1–2 ошибками, исправленными самостоятельно'],
    ['3 «удовлетворительно»', 'Ответ на один вопрос полный, на второй — частичный; практическое задание выполнено не менее чем на 60 %'],
    ['2 «неудовлетворительно»', 'Ответы отсутствуют или содержат грубые ошибки; практическое задание не выполнено']]);
  const cwCrit = crit5([['5 «отлично»', '90–100 % от максимального числа баллов'], ['4 «хорошо»', '75–89 %'], ['3 «удовлетворительно»', '60–74 %'], ['2 «неудовлетворительно»', 'менее 60 %']]);
  const testBlock = T => T.flatMap((q, i) => [p(`${i + 1}. ${q.q}`, { noIndent: true, before: 80, keepNext: true }), p(q.options.map((o, j) => `${LETTERS[j]}) ${o}`).join('    '), { noIndent: true, indent: { left: mm(6) } })]);
  const keyTable = T => {
    const half2 = Math.ceil(T.length / 2); const w = Array(4).fill(Math.floor(P_W / 4));
    const r = [];
    for (let i = 0; i < half2; i++) { const a = T[i], b = T[i + half2]; r.push(new TableRow({ children: [cell(String(i + 1), w[0], { align: C }), cell(LETTERS[a.answer], w[1], { align: C }), cell(b ? String(i + half2 + 1) : '', w[2], { align: C }), cell(b ? LETTERS[b.answer] : '', w[3], { align: C })] })); }
    return table(w, [hdr(['№ вопроса', 'Ответ', '№ вопроса', 'Ответ'], w), ...r]);
  };
  const ticket = (m, label, ex) => table([P_W], [new TableRow({ children: [cell([
    org.short, `${m.code} ${m.name}`, `Специальность ${spec}, группа ${pj.group}, ${label}`, 'ЭКЗАМЕНАЦИОННЫЙ БИЛЕТ № 1',
    `1. ${ex.questions[0]}`, `2. ${ex.questions[Math.floor(ex.questions.length / 2)]}`, `3. Практическое задание: ${ex.tasks[0]}`,
    'Время на подготовку — 30 минут, на выполнение практического задания — 30 минут.',
    'Преподаватель ____________ /____________/        Председатель ПЦК ____________ /____________/',
  ], P_W, { size: 22 })] })]);
  const wPW = widths(P_W, [25, 0, 20], 1);
  const sub = t => p(t, { bold: true, italics: true, noIndent: true, before: 160, after: 80, keepNext: true });
  // номера форм — по порядку появления
  const FN = { up: 1, pp: 2, char: 3, sheet: 4, proto: 5, exam: 6 };

  const f5 = [h1('5. Фонд оценочных средств'),
    p(`Фонд оценочных средств (ФОС) сформирован по элементам профессионального модуля: для каждого МДК — по семестрам (текущий контроль и промежуточная аттестация), затем для учебной и производственной практики и для экзамена по модулю. Самостоятельная внеаудиторная работа учебным планом группы ${pj.group} не предусмотрена.`),
    h2('5.1. Общие критерии оценки'),
    caption('Критерии оценки практической работы'), prCrit,
    p('Тестирование проводится по завершении изучения тем в электронной среде (СДО Moodle) или на бланке; время — 1 минута на вопрос. Каждое задание имеет один правильный ответ и оценивается в 1 балл.', { before: 120 }),
    caption('Шкала оценки тестирования'), testScale,
    caption('Критерии оценки на экзамене по МДК'), examCrit,
    caption('Критерии оценки контрольной работы'), cwCrit];
  let sn = 1;
  MB.forEach(({ m, blocks }) => {
    sn += 1;
    const x = mdkCodes(m);
    f5.push(pageBreak(), h2(`5.${sn}. Фонд оценочных средств по ${m.code} «${m.name}»`),
      p(`Проверяемые результаты: ${okStr(x.ok)}; ${pkStr(x.pk)}; ${lrStr(lrFromOk(x.ok))}. Формы промежуточной аттестации: ${mdkFormsText(m)}.`, { italics: true }));
    // последний семестр, в котором встречается тема — тест по теме проводится в этом семестре
    const themeSem = {};
    blocks.forEach(b => b.groups.forEach(g => { themeSem[g.ti] = b.sem; }));
    blocks.forEach((b, bi) => {
      f5.push(h3(`5.${sn}.${bi + 1}. ${b.label}`));
      const ws = uniq(b.groups.flatMap(g => g.lessons.filter(l => l.kind === 'P').map(l => l.n)));
      const allW = m.themes.flatMap(th => th.works || []);
      f5.push(sub('Текущий контроль. Практические работы'));
      if (ws.length) f5.push(table(wPW, [hdr(['№ практической работы', 'Тема практической работы', 'Часов в семестре'], wPW), ...ws.map(n => { const w = allW.find(y => y.n === n); const h = b.groups.flatMap(g => g.lessons).filter(l => l.kind === 'P' && l.n === n).length * LESSON; return new TableRow({ children: [cell(String(n), wPW[0], { align: C }), cell(w.title.replace(/\.\s*$/, ''), wPW[1]), cell(String(h), wPW[2], { align: C })] }); })]));
      else f5.push(p('Практические работы в семестре не предусмотрены.'));
      const T = (fos.tests[m.code] || []).filter(q => q.t && themeSem[q.t - 1] === b.sem);
      f5.push(sub('Текущий контроль. Тестовые задания'));
      if (T.length) {
        const thNames = uniq(T.map(q => q.t)).sort((a, b2) => a - b2).map(t => `${m.themes[t - 1].num} ${m.themes[t - 1].name}`);
        f5.push(p(`Темы: ${thNames.join('; ')}.`, { italics: true, noIndent: true, after: 80 }), ...testBlock(T),
          p('Ключ', { bold: true, noIndent: true, before: 120, after: 80, keepNext: true }), keyTable(T));
      } else f5.push(p('Тестирование в семестре проводится в форме устного опроса по темам семестра.'));
      f5.push(sub('Промежуточная аттестация'));
      if (!b.form) f5.push(p('Промежуточная аттестация в семестре учебным планом не предусмотрена; оценка за семестр выставляется по результатам текущего контроля.'));
      else if (['ДР', 'КР'].includes(b.form) && fos.control_works[m.code]) {
        const cw = fos.control_works[m.code];
        f5.push(p(`Форма — контрольная работа. Работа выполняется письменно, время — ${cw.minutes || 90} минут; ${cw.variants.length} варианта одинаковой сложности, каждое задание оценивается до 10 баллов. Критерии — п. 5.1.`));
        cw.variants.forEach((v, i) => f5.push(p(`Вариант ${i + 1}`, { bold: true, noIndent: true, before: 160, keepNext: true }), ...v.tasks.map((t, j) => p(`Задание ${j + 1}. ${t}`, { noIndent: true }))));
        f5.push(p('Эталоны ответов', { bold: true, noIndent: true, before: 160, keepNext: true }), ...cw.variants.map((v, i) => p(`Вариант ${i + 1}. ${v.answer}`, { noIndent: true })));
      } else if (fos.exams[m.code]) {
        const ex = fos.exams[m.code];
        f5.push(p(`Форма — ${formNom(b.form)}. Экзамен проводится по билетам: два теоретических вопроса и одно практическое задание. Критерии — п. 5.1.`),
          caption('Вопросы к экзамену'), ...olist(ex.questions),
          caption('Типы практических задач к экзамену'), ...olist(ex.tasks),
          caption('Образец экзаменационного билета'), ticket(m, b.label, ex));
      }
    });
  });

  // учебная практика
  const wUW = widths(P_W, [12, 0, 32, 16], 1);
  const worksTable = (u, kind) => table(wUW, [hdr(['№', 'Вид работ', 'ПК', 'Часов'], wUW), ...u.works.map((w, i) => new TableRow({ children: [cell(String(i + 1), wUW[0], { align: C }), cell(cap(w.name), wUW[1]), cell(pkStr(parseCodes(w.codes).pk), wUW[2]), cell(String(kind === 'up' ? w.tasks.reduce((a, t) => a + t[1], 0) : w.days.length * PP_DAY), wUW[3], { align: C })] }))]);
  const wA = widths(P_W, [10, 0, 30, 40], 1);
  const sig = t => p(t, { noIndent: true, before: 120 });
  const upPK = workCodes(c.up);
  if (c.up.length) {
    sn += 1;
    f5.push(pageBreak(), h2(`5.${sn}. Фонд оценочных средств по учебной практике ${c.up[0].code}`),
      p(`Проверяемые результаты: ${pkStr(upPK)}; ОК 01–09; ${lrStr(lrFromOk(OK_CODES))}. Учебная практика оценивается по результатам выполнения видов работ (наблюдение, проверка результатов) и аттестационному листу (форма ${FN.up}).`));
    c.up.forEach((u, i) => {
      f5.push(h3(`5.${sn}.${i + 1}. ${u.label}`), sub('Виды работ'), worksTable(u, 'up'), sub('Промежуточная аттестация'));
      if (u.form) {
        f5.push(p(`Форма — ${formNom(u.form)}. Проводится по результатам выполнения всех видов работ, аттестационного листа и защиты отчёта по практике; обучающийся отвечает на два вопроса из перечня.`));
        if ((fos.up_questions || []).length) f5.push(caption('Вопросы к дифференцированному зачёту'), ...olist(fos.up_questions));
        f5.push(caption('Критерии оценки'), crit5([['5 «отлично»', 'Все виды работ выполнены качественно, отчёт оформлен полностью, ответы на вопросы полные'], ['4 «хорошо»', 'Все виды работ выполнены, допущены несущественные недочёты в отчёте или ответах'], ['3 «удовлетворительно»', 'Выполнено не менее 60 % видов работ, отчёт неполный, ответы с ошибками'], ['2 «неудовлетворительно»', 'Выполнено менее 60 % видов работ или отчёт не представлен']]));
      } else f5.push(p('Промежуточная аттестация в семестре не предусмотрена.'));
    });
    f5.push(caption(`Форма ${FN.up}. Аттестационный лист по учебной практике ${c.up[0].code}`, { before: 240 }),
      p(`Ф. И. О. обучающегося ______________________________  Группа ${pj.group}`, { noIndent: true }),
      p(`Сроки практики: с «__» ______ 20__ г. по «__» ______ 20__ г.  Место: ${org.short}`, { noIndent: true, after: 120 }),
      table(wA, [hdr(['№', 'Профессиональная компетенция', 'Освоена / не освоена', 'Подпись руководителя'], wA), ...PK.filter(([k]) => upPK.includes(k)).map(([k, n], i) => new TableRow({ children: [cell(String(i + 1), wA[0], { align: C }), cell(`${k}. ${n}`, wA[1]), cell('', wA[2]), cell('', wA[3])] }))]),
      sig(`Итоговая оценка${upForm ? ` (${formNom(upForm.form)})` : ''}: ____________   Руководитель практики ____________ /____________/   «__» ______ 20__ г.`));
  }
  // производственная практика
  if (c.pp.length) {
    sn += 1;
    const ppPK = workCodes(c.pp);
    f5.push(pageBreak(), h2(`5.${sn}. Фонд оценочных средств по производственной практике ${c.pp[0].code}`),
      p(`Проверяемые результаты: ${pkStr(ppPK)}; ОК 01–09; ${lrStr(lrFromOk(OK_CODES))}.`));
    c.pp.forEach((u, i) => {
      f5.push(h3(`5.${sn}.${i + 1}. ${u.label}`), sub('Виды работ'), worksTable(u, 'pp'));
      f5.push(sub('Итоги практики'), p(u.form ? `Промежуточная аттестация — ${formNom(u.form)}.` : 'Промежуточная аттестация (дифференцированный зачёт) по производственной практике не проводится. По окончании практики обучающийся оформляет и сдаёт отчёт по практике; руководитель от профильной организации заполняет аттестационный лист (форма ' + FN.pp + ') и характеристику (форма ' + FN.char + '). Отчёт, аттестационный лист и характеристика предъявляются для допуска к экзамену по модулю.'));
    });
    f5.push(p('Требования к отчёту по практике: титульный лист; характеристика организации и её сетевой инфраструктуры; описание выполненных работ по каждому виду работ; схемы, таблицы адресации, журналы и другие документы, составленные обучающимся; выводы.', { before: 120 }),
      caption(`Форма ${FN.pp}. Аттестационный лист по производственной практике ${c.pp[0].code}`, { before: 240 }),
      p(`Ф. И. О. обучающегося ______________________________  Группа ${pj.group}`, { noIndent: true }),
      p('Организация ________________________________  Сроки: с «__» ______ по «__» ______ 20__ г.', { noIndent: true, after: 120 }),
      table(wA, [hdr(['№', 'Профессиональная компетенция', 'Качество выполнения работ', 'Освоена / не освоена'], wA), ...PK.map(([k, n], i) => new TableRow({ children: [cell(String(i + 1), wA[0], { align: C }), cell(`${k}. ${n}`, wA[1]), cell('', wA[2]), cell('', wA[3])] }))]),
      sig('Отчёт по практике сдан: «__» ______ 20__ г.'),
      sig('Руководитель от организации ____________ /____________/  М. П.'),
      sig('Руководитель от образовательной организации ____________ /____________/'),
      caption(`Форма ${FN.char}. Характеристика обучающегося по итогам производственной практики`, { before: 240 }),
      p(`Ф. И. О. обучающегося ______________________________  Группа ${pj.group}`, { noIndent: true, after: 120 }),
      table(widths(P_W, [22, 60, 0], 2), [hdr(['ОК', 'Личностные результаты', 'Проявлено / частично / не проявлено'], widths(P_W, [22, 60, 0], 2)), ...OK_CODES.map(o => new TableRow({ children: [cell(o, mm(22)), cell(lrStr(okLr[o] || []), mm(60)), cell('', P_W - mm(82))] }))]),
      sig('Дополнительные сведения (дисциплина, ответственность, отношение к работе): ______________________________________________________________'),
      sig('Руководитель от организации ____________ /____________/  М. П.   «__» ______ 20__ г.'));
  }

  // экзамен по модулю
  sn += 1;
  const pkMax = {};
  me.checklist.forEach(([k, , pt]) => { pkMax[k] = (pkMax[k] || 0) + Number(pt); });
  const wE = widths(P_W, [18, 0, 22, 22], 1);
  const wOL = widths(P_W, [22, 55, 0, 40], 2);
  const wPrt = widths(P_W, [10, 0, 45, 35, 25], 1);
  const wPro = widths(P_W, [10, 0, 18, 22, 35, 22], 1);
  const okCritTxt = o => ((crit[o] || {}).criteria || []).join('; ');
  const fixForm = t => t.replace(/\(форма \d+\)/g, `(форма ${FN.proto})`);
  f5.push(pageBreak(), h2(`5.${sn}. Контрольно-оценочные средства для проведения квалификационного экзамена по модулю`),
    p(`Экзамен по модулю ${pmQ} проводится в ${c.meta.exam_label.replace('курс', 'курсе').replace('семестр', 'семестре')} после освоения ${c.mdk.map(m => m.code).join(', ')}${c.up.length ? ', ' + c.up[0].code : ''}${c.pp.length ? ' и ' + c.pp[0].code : ''}. К экзамену допускаются обучающиеся, имеющие положительные оценки по промежуточной аттестации МДК и учебной практики, аттестационные листы по учебной и производственной практике и сданный отчёт по производственной практике. Экзамен принимает комиссия в составе не менее трёх человек с участием представителя работодателя. По итогам экзамена принимается решение «вид деятельности освоен / не освоен» и выставляется оценка по пятибалльной шкале.`),
    p('Экзамен состоит из частей:', { keepNext: true }),
    ...bullets(me.parts.map((x, i, a) => `${x.name} (${x.pk.join(', ')})${x.minutes ? ` — ${x.minutes} минут` : ''}${x.prep_minutes ? `, подготовка ${x.prep_minutes} минут` : ''}${i === a.length - 1 ? '.' : ';'}`)),
    p('Общие компетенции и личностные результаты оцениваются экспертным наблюдением в ходе экзамена.'),
    p(`Условия проведения: ${me.conditions}`),
    caption('Задания для экзамена по модулю'),
    p(`Задания выдаются в ${me.variants.length} вариантах одинакового объёма и сложности.`),
    ...me.variants.flatMap(v => [
      p(v.title, { bold: true, noIndent: true, before: 200, keepNext: true }),
      ...(v.data ? [p(`Исходные данные. ${v.data}`, { noIndent: true })] : []),
      ...olist(v.tasks.map(t => `${t.pk}. ${fixForm(t.text)}`), 22),
      ...(v.examiner_note ? [p(`Для экзаменатора (не выдаётся обучающемуся): ${v.examiner_note}`, { italics: true, noIndent: true, size: 22, before: 80 })] : []),
    ]),
    caption('Критерии итоговой оценки'),
    p(`Баллы суммируются по оценочному листу (форма ${FN.sheet}, максимум 100). Вид деятельности признаётся освоенным, если по каждой ПК набрано не менее 50 % возможных баллов (${Object.entries(pkMax).map(([k, v]) => `${k} — не менее ${Math.ceil(v / 2)}`).join(', ')}) и сумма составляет не менее 60 баллов.`),
    simpleTable(widths(P_W, [60, 0], 1), ['Сумма баллов', 'Оценка'], [['90–100', '5 «отлично», вид деятельности освоен'], ['75–89', '4 «хорошо», вид деятельности освоен'], ['60–74', '3 «удовлетворительно», вид деятельности освоен'], ['менее 60 или не выполнено условие по одной из ПК', '2 «неудовлетворительно», вид деятельности не освоен']], { center: [0] }),
    pageBreak(),
    caption(`Форма ${FN.sheet}. Оценочный лист экзамена по модулю`, { before: 0 }),
    p(`Ф. И. О. обучающегося ________________________   Группа ${pj.group}   Вариант ___`, { noIndent: true, after: 120 }),
    table(wE, [hdr(['ПК', 'Критерий', 'Макс. балл', 'Балл'], wE), ...me.checklist.map(([k, t, pt]) => new TableRow({ children: [cell(k, wE[0]), cell(t, wE[1]), cell(String(pt), wE[2], { align: C }), cell('', wE[3])] })),
      new TableRow({ children: [cell('', wE[0]), cell('Итого', wE[1], { bold: true }), cell('100', wE[2], { bold: true, align: C }), cell('', wE[3])] })]),
    caption('Оценка общих компетенций и личностных результатов', { before: 200 }),
    table(wOL, [hdr(['ОК', 'ЛР', 'Наблюдаемое проявление', 'Проявлено / частично / нет'], wOL), ...OK_CODES.map(o => new TableRow({ children: [cell(o, wOL[0]), cell(lrStr(okLr[o] || []), wOL[1]), cell(okCritTxt(o), wOL[2]), cell('', wOL[3])] }))]),
    sig('Члены комиссии ____________ /____________/   ____________ /____________/'),
    pageBreak(),
    caption(`Форма ${FN.proto}. ${me.protocol_title || 'Протокол проверки результата выполнения задания'}`, { before: 0 }),
    p('Объект проверки: ______________________  Вариант ___  Дата «__» ______ 20__ г.', { noIndent: true, after: 120 }),
    table(wPrt, [hdr(['№', 'Проверка', 'Метод', 'Ожидаемый результат', 'Факт'], wPrt), ...me.protocol_checks.map((r, i) => new TableRow({ children: [cell(String(i + 1), wPrt[0], { align: C }), cell(r[0], wPrt[1]), cell(r[1], wPrt[2]), cell(r[2], wPrt[3]), cell('', wPrt[4])] }))]),
    sig('Вывод: ______________________________________________'),
    sig('Проверку провёл ____________ /____________/'),
    pageBreak(),
    caption(`Форма ${FN.exam}. Протокол экзамена по профессиональному модулю ${pmTitle}`, { before: 0 }),
    p(`Специальность ${spec}, группа ${pj.group}. Дата «__» ______ 20__ г.`, { noIndent: true }),
    p('Состав комиссии: председатель ______________________; члены комиссии ______________________, ______________________ (представитель работодателя).', { noIndent: true, after: 120 }),
    table(wPro, [hdr(['№', 'Ф. И. О. обучающегося', 'Вариант', 'Сумма баллов', 'Вид деятельности освоен / не освоен', 'Оценка'], wPro), ...[1, 2, 3, 4, 5].map(i => new TableRow({ children: wPro.map((w, j) => cell(j ? '' : String(i), w, { align: C })) }))]),
    sig('Председатель комиссии ____________ /____________/'),
    sig('Члены комиссии ____________ /____________/   ____________ /____________/'));

  const footer = () => new Footer({ children: [new Paragraph({ alignment: C, children: [new TextRun({ font: H.FONT, size: 22, children: [PageNumber.CURRENT] })] })] });
  const portrait = { page: { size: { width: 11906, height: 16838 }, margin: P_MARG } };
  const landscape = { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: L_MARG } };
  const doc = new Document({
    creator: org.short, title: `Рабочая программа ${pmTitle}`,
    styles: H.styles(), numbering: H.numberingConfig(),
    sections: [
      { properties: { ...portrait, titlePage: true }, footers: { default: footer(), first: new Footer({ children: [new Paragraph('')] }) }, children: [...titlePage, ...back, ...sec1] },
      { properties: { ...landscape }, footers: { default: footer() }, children: sec2 },
      { properties: { ...portrait }, footers: { default: footer() }, children: [...sec3, pageBreak(), ...sec4, pageBreak(), ...f5] },
    ],
  });
  return { doc };
}

async function build(projectFile, opts = {}) {
  const ctx = loadProject(projectFile);
  if (!ctx.content) throw new Error(`Нет файла наполнения ${ctx.contentPath}. Сначала выполните init и fill.`);
  if (!ctx.pop) throw new Error('В project.json не указан файл ПОП (поле "pop").');
  const v = validate(ctx.content, { pop: ctx.pop });
  v.warnings.forEach(w => console.log('  предупреждение:', w));
  if (v.errors.length && !opts.force) {
    v.errors.forEach(e => console.log('  ОШИБКА:', e));
    throw new Error(`Наполнение не прошло проверку (${v.errors.length} ошибок). Исправьте или запустите с --force.`);
  }
  fs.mkdirSync(path.dirname(ctx.outputPath), { recursive: true });
  const { doc } = buildDocument(ctx);
  fs.writeFileSync(ctx.outputPath, await Packer.toBuffer(doc));
  return { output: ctx.outputPath };
}

module.exports = { build, buildDocument, loadProject };
