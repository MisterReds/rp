// Общие функции оформления: шрифт, поля, абзацы, таблицы. Оформление по ГОСТ Р 7.0.97-2016:
// Times New Roman 12 пт (в таблицах 11 пт), поля 30/15/20/20 мм, абзацный отступ 12,5 мм.
'use strict';
const D = require('docx');
const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, VerticalAlign, HeadingLevel,
  LevelFormat, PageBreak, ShadingType, BorderStyle } = D;

const FONT = 'Times New Roman';
const mm = v => Math.round(v * 56.7);
const P_MARG = { top: mm(20), bottom: mm(20), left: mm(30), right: mm(15) };
const P_W = 11906 - P_MARG.left - P_MARG.right;
const L_MARG = { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) };
const L_W = 16838 - L_MARG.left - L_MARG.right;
const TS = 22; // размер шрифта в таблицах (11 пт)
const C = AlignmentType.CENTER;

// Реестр нумерованных списков: каждый новый список начинается с 1
const numRefs = [];
function newListRef() { const r = 'list' + numRefs.length; numRefs.push(r); return r; }

function run(text, o = {}) {
  return new TextRun({ text: String(text), font: FONT, size: o.size || 24, bold: o.bold, italics: o.italics, allCaps: o.caps });
}
function p(text, o = {}) {
  const runs = Array.isArray(text) ? text : [run(text, o)];
  return new Paragraph({
    children: runs, alignment: o.align || AlignmentType.JUSTIFIED,
    indent: o.noIndent ? undefined : (o.indent !== undefined ? o.indent : { firstLine: mm(12.5) }),
    spacing: { before: o.before || 0, after: o.after !== undefined ? o.after : 0, line: o.line || 276 },
    keepNext: o.keepNext,
  });
}
const center = (text, o = {}) => p(text, { ...o, align: C, noIndent: true });
const caption = (text, o = {}) => p(text, { bold: true, noIndent: true, align: C, before: 160, after: 80, keepNext: true, ...o });
function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(text, { bold: true, caps: true })], alignment: C, spacing: { before: 0, after: 240 }, keepNext: true });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(text, { bold: true })], alignment: AlignmentType.LEFT, indent: { firstLine: mm(12.5) }, spacing: { before: 200, after: 120 }, keepNext: true });
}
function h3(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(text, { bold: true })], alignment: AlignmentType.LEFT, indent: { firstLine: mm(12.5) }, spacing: { before: 120, after: 120 }, keepNext: true });
}
function bullets(items) {
  return items.map(t => new Paragraph({ numbering: { reference: 'dash', level: 0 }, children: [run(t)], alignment: AlignmentType.JUSTIFIED, spacing: { line: 252 } }));
}
function olist(items, size = 24) {
  const ref = newListRef();
  return items.map(t => new Paragraph({ numbering: { reference: ref, level: 0 }, children: [run(t, { size })], alignment: AlignmentType.JUSTIFIED, spacing: { line: 276 } }));
}
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function cp(text, o = {}) {
  return new Paragraph({ children: [run(text, { size: o.size || TS, bold: o.bold, italics: o.italics })], alignment: o.align || AlignmentType.LEFT, spacing: { line: 240 } });
}
function cell(content, w, o = {}) {
  let children;
  if (Array.isArray(content)) children = content.map(x => (typeof x === 'string' ? cp(x, o) : x));
  else children = [cp(content === undefined || content === null ? '' : String(content), o)];
  if (!children.length) children = [cp('')];
  return new TableCell({
    children, width: { size: w, type: WidthType.DXA }, columnSpan: o.colSpan, rowSpan: o.rowSpan,
    verticalAlign: o.vAlign || VerticalAlign.TOP,
    shading: o.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: o.shade } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
  });
}
function cellBullets(items, w) {
  return new TableCell({
    children: items.map(t => new Paragraph({ numbering: { reference: 'cdash', level: 0 }, children: [run(t, { size: TS })], spacing: { line: 240 } })),
    width: { size: w, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 80, right: 80 },
  });
}
function table(widths, rows, o = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows, borders: o.borders });
}
function hdr(texts, widths) {
  return new TableRow({ tableHeader: true, children: texts.map((t, i) => cell(t, widths[i], { bold: true, align: C, vAlign: VerticalAlign.CENTER, shade: 'EDEDED' })) });
}
function simpleTable(widths, head, rows, o = {}) {
  return table(widths, [hdr(head, widths), ...rows.map(r => new TableRow({ children: r.map((v, i) => cell(Array.isArray(v) ? v : String(v), widths[i], { align: (o.center || []).includes(i) ? C : AlignmentType.LEFT })) }))]);
}
// ширины столбцов: фиксированные в мм, один столбец (index) растягивается до полной ширины
function widths(totalW, fixedMm, stretch) {
  const w = fixedMm.map(x => (x ? mm(x) : 0));
  w[stretch] = totalW - w.reduce((a, b) => a + b, 0);
  return w;
}
const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

function numberingConfig() {
  const dash = (ref, l, h) => ({ reference: ref, levels: [{ level: 0, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: l, hanging: h } }, run: { font: FONT } } }] });
  const num = ref => ({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: mm(12.5), hanging: mm(6) } } } }] });
  return { config: [dash('dash', mm(17.5), mm(5)), dash('cdash', mm(4), mm(4)), ...numRefs.map(num)] };
}
function styles() {
  const hs = (id, name, lvl, extra = {}) => ({ id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 24, bold: true, color: '000000', ...extra.run }, paragraph: { outlineLevel: lvl, ...extra.paragraph } });
  return {
    default: { document: { run: { font: FONT, size: 24 } } },
    paragraphStyles: [hs('Heading1', 'Heading 1', 0, { run: { allCaps: true }, paragraph: { alignment: C } }), hs('Heading2', 'Heading 2', 1), hs('Heading3', 'Heading 3', 2)],
  };
}

module.exports = { D, FONT, mm, P_MARG, P_W, L_MARG, L_W, TS, C, run, p, center, caption, h1, h2, h3, bullets, olist, pageBreak, cp, cell, cellBullets, table, hdr, simpleTable, widths, noBorders, numberingConfig, styles, newListRef };
