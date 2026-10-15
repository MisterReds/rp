#!/usr/bin/env node
// Самопроверка цепочки для любого проекта: init → ответы «нейросети» по каждому этапу (берутся из готового
// content.json примера) → проверка ответа функцией этапа → запись → validate → build.
// Так проверяется, что этапы, промпты и проверки работают для новых модулей без ручных правок.
// Использование: node tools/selftest.js [examples/PM05_OP-2301is ...]   (по умолчанию — все examples/*)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const root = path.join(__dirname, '..');
const { loadProject, buildDocument } = require('../src/build.js');
const { buildSkeleton } = require('../src/skeleton.js');
const { listStages } = require('../src/stages.js');
const { validate } = require('../src/validate.js');
const { Packer } = require('docx');

// ответ этапа, который дала бы нейросеть, — из эталонного наполнения
function answer(id, ref) {
  const [kind, code0, part] = id.split(':');
  const k = Number(part) || 1, P = 20, sl = a => (a || []).slice((k - 1) * P, k * P);
  const [code, sem] = code0 ? code0.split('@') : [];
  const m = code && ref.mdk.find(x => x.code === code);
  switch (kind) {
    case 'themes': return { themes: m.themes.map(t => ({ num: t.num, theory: t.theory, codes: t.codes })) };
    case 'course': return { topics: m.course_project.topics.length ? m.course_project.topics : ref.mdk.find(x => x.course_project && x.course_project.topics.length).course_project.topics, stages: m.course_project.stages };
    case 'up': return { works: ref.up[Number(code) - 1].works };
    case 'pp': return { works: ref.pp[Number(code) - 1].works };
    case 'program': return { equipment: ref.program.conditions.equipment, software: ref.program.conditions.software, lr_methods: ref.program.lr_methods };
    case 'tests': return { tests: sl(ref.fos.tests[code]) };
    case 'exam': {
      const m = ref.mdk.find(x => x.code === code);
      const key = sem ? `${code}|${m.sems.find(b => String(b.sem) === sem).label}` : code;
      return { questions: sl(ref.fos.exams[key].questions), tasks: sl(ref.fos.exams[key].tasks) };
    }
    case 'cw': return ref.fos.control_works[code];
    case 'upq': return { questions: ref.fos.up_questions };
    case 'module_exam': return ref.fos.module_exam;
    default: throw new Error('неизвестный этап ' + id);
  }
}

async function run(dir) {
  const pjFile = path.join(dir, 'project.json');
  const ctx = loadProject(pjFile);
  const ref = ctx.content;
  const { skeleton, errors } = buildSkeleton(ctx.plan, ctx.project, ctx.fgos, ctx.pop);
  if (errors.length) console.log('  замечания init:', errors.join('; '));
  ctx.content = skeleton;
  // МДК, перенесённые из готовых программ (custom), этапами не генерируются — переносятся как есть
  skeleton.mdk.forEach((m, i) => { if (ref.mdk[i].custom) skeleton.mdk[i] = ref.mdk[i]; });
  // распределение пар по темам преподаватель может поправить вручную после init — берём его из эталона,
  // как и ручные дополнения (subtitles, этапы курсового по МДК)
  skeleton.mdk.forEach((m, i) => {
    if (m.custom) return;
    m.themes.forEach((t, j) => { const r = ref.mdk[i].themes[j]; if (!r) return; t.theory_count = r.theory.length; t.works = JSON.parse(JSON.stringify(r.works)); });
  });
  const fails = [];
  // практики, перенесённые из готовых программ практик (_practice_source), этапами не генерируются — переносятся как есть
  if (ref._practice_source) { ctx.content.up = ref.up; ctx.content.pp = ref.pp; ctx.content._practice_source = ref._practice_source; }
  for (const st of listStages(ctx)) {
    if (ref._practice_source && /^(up|pp):/.test(st.id)) continue;
    const fresh = listStages(ctx).find(s => s.id === st.id);
    const data = JSON.parse(JSON.stringify(answer(st.id, ref)));
    fresh.prompt(); // промпт должен собираться без ошибок
    const e = fresh.check(data);
    if (e.length) { fails.push(`${st.id}: ${e.slice(0, 3).join('; ')}`); continue; }
    fresh.apply(data);
  }
  const v = validate(ctx.content, { pop: ctx.pop });
  const L = require('./lint_content.js').lint(ctx.content);
  L.errors.forEach(e => v.errors.push('lint: ' + e));
  const doc = buildDocument(ctx).doc;
  const buf = await Packer.toBuffer(doc);
  const out = path.join(os.tmpdir(), `selftest_${path.basename(dir)}.docx`);
  fs.writeFileSync(out, buf);
  console.log(`${path.basename(dir)}: этапов ${listStages(ctx).length}, отклонено ответов ${fails.length}, ошибок проверки ${v.errors.length}, документ ${Math.round(buf.length / 1024)} КБ`);
  fails.forEach(f => console.log('  ответ отклонён:', f));
  v.errors.slice(0, 10).forEach(e => console.log('  ошибка:', e));
  return !fails.length && !v.errors.length;
}

(async () => {
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'examples')).map(d => path.join(root, 'examples', d));
  let ok = true;
  for (const d of dirs) ok = (await run(d)) && ok;
  console.log(ok ? 'Самопроверка пройдена.' : 'Самопроверка НЕ пройдена.');
  process.exitCode = ok ? 0 : 1;
})();
