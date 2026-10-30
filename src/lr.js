'use strict';
// ЛР документа — только соответствующие ОК модуля/дисциплины (Таблица 3 программы воспитания, ключ ok_lr):
// объединение ok_lr по ОК, по возрастанию. project.json → ok_lr_override приоритетнее данных программы воспитания.
const okLrOf = (vosp, pj) => ({ ...(vosp.ok_lr || {}), ...((pj && pj.ok_lr_override) || {}) });
const lrSet = (okCodes, okLr, LR) => [...new Set(okCodes.flatMap(o => okLr[o] || []))].filter(n => LR[n]).sort((a, b) => a - b);
// ОК документа: ПМ — content.meta.ok, иначе все ОК ФГОС; ud — всегда meta.ok
const okCodesOf = (ctx) => { const m = ctx.content.meta || {}; return (m.ok && m.ok.length) ? ctx.fgos.ok.map(x => x[0]).filter(k => m.ok.includes(k)) : ctx.fgos.ok.map(x => x[0]); };
const moduleLr = ctx => lrSet(okCodesOf(ctx), okLrOf(ctx.vosp, ctx.project), ctx.vosp.lr);
module.exports = { okLrOf, lrSet, okCodesOf, moduleLr };
