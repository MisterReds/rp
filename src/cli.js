#!/usr/bin/env node
// rpgen — генератор рабочих программ ПМ с ФОС в одном .docx
'use strict';
const fs = require('fs');
const path = require('path');
const { loadProject, build } = require('./build.js');
const { buildSkeleton } = require('./skeleton.js');
const { validate } = require('./validate.js');
const { listStages } = require('./stages.js');
const { llmConfig, askValidated, extractJson } = require('./llm.js');
const { buildSkeletonUd } = require('./skeleton_ud.js');
const { validateUd } = require('./validate_ud.js');
const { listStagesUd } = require('./stages_ud.js');


const HELP = `
rpgen — рабочая программа профессионального модуля + ФОС одним файлом .docx

Команды (project.json — паспорт документа):
  new <папка> --plan план.tsv --pm ПМ.02 --pop ПОП.json [--group ОА-2401] [--vd "название ВД"] [--fgos путь] [--vosp путь]
                                   создать новый проект на основе примера
  new <папка> --kind ud --plan план.tsv --ud ОП.04 --pop ПОП-УД.json --ktp КТП.json [--group ОА-2501] [--fgos путь] [--vosp путь]
                                   создать проект учебной дисциплины (ОП, ОГСЭ, ЕН, ОД): занятия — из КТП, результаты — из ПОП
  init <project.json> [--force]    разобрать учебный план и создать каркас content.json (часы, семестры, формы)
  stages <project.json>            список этапов наполнения и их статус
  fill <project.json> [--only ID] [--redo] [--attempts N]
                                   наполнить этапы через API нейросети (см. llm в project.json)
  next <project.json> [--only ID]  ручной режим: записать промпт следующего этапа в файл для вставки в чат
  import <project.json> <ответ.json> [--stage ID]
                                   ручной режим: проверить ответ нейросети и записать его в content.json
  validate <project.json>          проверить наполнение (часы, ПОП, коды, формы)
  lint <project.json>              проверить качество текстов (повторы, заглушки, «части», ключи тестов)
  build <project.json> [--force]   собрать .docx по шаблону СПЭТ
`;

function args() {
  const a = process.argv.slice(2); const pos = [], opt = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; opt[k] = v; } else pos.push(a[i]);
  }
  return { cmd: pos[0], pos: pos.slice(1), opt };
}
const saveContent = ctx => fs.writeFileSync(ctx.contentPath, JSON.stringify(ctx.content, null, 1));
const done = ctx => new Set(ctx.content._done || []);
const isUd = ctx => ctx.project.kind === 'ud';
const stagesOf = ctx => (isUd(ctx) ? listStagesUd(ctx) : listStages(ctx));
// системный промпт: для ПМ — prompts/system.md, для учебной дисциплины — prompts/system_ud.md
function systemPrompt(ctx) {
  const m = ctx.content.meta;
  const file = isUd(ctx) ? 'system_ud.md' : 'system.md';
  return fs.readFileSync(path.join(__dirname, '..', 'prompts', file), 'utf8').replace('{{specialty}}', `${ctx.fgos.code} ${ctx.fgos.name}`).replace('{{pm}}', m.pm || m.code).replace('{{pm_name}}', m.pm_name || m.name);
}
const markDone = (ctx, id) => { ctx.content._done = [...new Set([...(ctx.content._done || []), id])]; };
function pickStages(ctx, opt) {
  let S = stagesOf(ctx);
  if (opt.only) S = S.filter(s => s.id === opt.only || s.id.startsWith(opt.only));
  if (!opt.redo) S = S.filter(s => !done(ctx).has(s.id));
  return S;
}
function needContent(ctx) { if (!ctx.content) { console.error(`Нет ${ctx.contentPath}. Сначала: rpgen init <project.json>`); process.exit(1); } }

async function main() {
  const { cmd, pos, opt } = args();
  if (!cmd || cmd === 'help' || opt.help) { console.log(HELP); return; }

  if (cmd === 'new' && (opt.kind === 'ud' || opt.ud)) {
    const dir = pos[0]; if (!dir || !opt.plan || !opt.ud || !opt.pop || !opt.ktp) throw new Error('Нужно: new <папка> --kind ud --plan <файл> --ud ОП.04 --pop <ПОП-УД.json> --ktp <КТП.json>');
    const root = path.join(__dirname, '..');
    const ex = JSON.parse(fs.readFileSync(path.join(root, 'examples/PM01_OA-2401/project.json'), 'utf8'));
    fs.mkdirSync(dir, { recursive: true });
    const rel = f => path.relative(path.resolve(dir), path.resolve(f)).split(path.sep).join('/');
    const proj = {
      kind: 'ud', fgos: rel(opt.fgos || path.join(root, 'data/fgos/09.02.06.json')), vospitanie: rel(opt.vosp || path.join(root, 'data/vospitanie/spet_2026-2027.json')),
      plan: rel(opt.plan), pop: rel(opt.pop), ktp: rel(opt.ktp), ud: opt.ud, group: opt.group || ex.group, form: ex.form, year: ex.year, course_offset: 0,
      org: ex.org, people: ex.people, pcc: ex.pcc, competence: ex.competence, content: 'content.json', output: `РП_${opt.ud}_${opt.group || ex.group}_с_ФОС.docx`,
      hints: { general: '' }, llm: { provider: 'openai', base_url: 'https://api.openai.com/v1', model: '', api_key_env: 'LLM_API_KEY', temperature: 0.4, json_mode: true },
    };
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(proj, null, 2));
    console.log(`Создан ${path.join(dir, 'project.json')}. Проверьте реквизиты (org, people, year, pcc, competence), затем: init`);
    return;
  }

  if (cmd === 'new') {
    const dir = pos[0]; if (!dir || !opt.plan || !opt.pm) throw new Error('Нужно: new <папка> --plan <файл> --pm ПМ.0N');
    const root = path.join(__dirname, '..');
    const ex = JSON.parse(fs.readFileSync(path.join(root, 'examples/PM01_OA-2401/project.json'), 'utf8'));
    fs.mkdirSync(dir, { recursive: true });
    const rel = f => path.relative(path.resolve(dir), path.resolve(f)).split(path.sep).join('/');
    Object.assign(ex, {
      fgos: rel(opt.fgos || path.join(root, 'data/fgos/09.02.06.json')),
      vospitanie: rel(opt.vosp || path.join(root, 'data/vospitanie/spet_2026-2027.json')),
      plan: rel(opt.plan), pop: opt.pop ? rel(opt.pop) : undefined, forms_override: { [`ПП.${opt.pm.replace(/^ПМ\./, '')}`]: null }, pm: opt.pm, vd_name: opt.vd || undefined, group: opt.group || ex.group,
      content: 'content.json', output: `РП_${opt.pm}_${opt.group || ex.group}_с_ФОС.docx`,
      hints: { general: '', mdk: {}, up: '' },
      llm: { provider: 'openai', base_url: 'https://api.openai.com/v1', model: '', api_key_env: 'LLM_API_KEY', temperature: 0.4, json_mode: true },
    });
    if (!opt.vd) delete ex.vd_name;
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(ex, null, 2));
    console.log(`Создан ${path.join(dir, 'project.json')}. Проверьте реквизиты (org, people, year), затем: init`);
    return;
  }

  const projectFile = pos[0]; if (!projectFile) throw new Error('Укажите путь к project.json');
  const ctx = loadProject(projectFile);

  if (cmd === 'init' && isUd(ctx)) {
    if (ctx.content && !opt.force) throw new Error(`${ctx.contentPath} уже существует. Перезаписать: --force (всё наполнение будет потеряно)`);
    const { skeleton, errors } = buildSkeletonUd(ctx.plan, ctx.project, ctx.fgos, ctx.pop, ctx.ktp);
    ctx.content = skeleton; saveContent(ctx);
    const u = skeleton.ud;
    console.log(`Каркас: ${ctx.contentPath}`);
    console.log(`  ${u.code} «${u.name}»: ${skeleton.meta.total_hours} ч по плану (теория ${u.T} ч, практика ${u.P} ч); семестры: ` + u.sems.map(s => `${s.label} — ${s.hours} ч${s.form ? ` (${s.form})` : ''}`).join(', '));
    u.themes.forEach(t => console.log(`     ${t.num} ${t.name}: занятий ${t.lessons.length} (${t.lessons.reduce((a, l) => a + l.h, 0)} ч)`));
    console.log(`  ОК из ПОП: ${skeleton.meta.ok.join(', ')}; ПК: ${skeleton.meta.pk.map(x => x[0]).join(', ') || 'нет'}`);
    if (ctx.ktp && ctx.ktp._generated) console.log('  ! КТП преподавателя отсутствует — занятия составлены нами по ПОП и плану; заменить при получении КТП (отметить в COMPLETENESS.md)');
    if (errors.length) { console.log('\nЗамечания:'); errors.forEach(e => console.log('  ! ' + e)); }
    console.log(`\nДалее: rpgen next ${projectFile}   (этапы: codes, program, tests, exam)`);
    return;
  }

  if (cmd === 'init') {
    if (ctx.content && !opt.force) throw new Error(`${ctx.contentPath} уже существует. Перезаписать: --force (всё наполнение будет потеряно)`);
    const { skeleton, errors } = buildSkeleton(ctx.plan, ctx.project, ctx.fgos, ctx.pop);
    ctx.content = skeleton; saveContent(ctx);
    console.log(`Каркас: ${ctx.contentPath}`);
    skeleton.mdk.forEach(m => {
      console.log(`  ${m.code} «${m.name}»: теория ${m.T} ч (${m.T / 2} пар), практика ${m.P} ч (${m.P / 2} пар)${m.K ? `, курсовой ${m.K} ч` : ''}; семестры: ` + m.sems.map(s => `${s.label} — ${s.hours} ч${s.form ? ` (${s.form})` : ''}`).join(', '));
      m.themes.forEach(t => console.log(`     ${t.num} ${t.name}: теоретических занятий ${t.theory_count}, практических работ ${t.works.length} (${t.works.reduce((a, w) => a + w.pairs, 0)} пар)`));
    });
    skeleton.up.forEach(u => console.log(`  ${u.code}: ${u.label} — ${u.hours} ч (${u.hours / 2} пар)`));
    skeleton.pp.forEach(u => console.log(`  ${u.code}: ${u.label} — ${u.hours} ч (${u.days} дн. по 6 ч)`));
    if (errors.length) { console.log('\nЗамечания к учебному плану:'); errors.forEach(e => console.log('  ! ' + e)); }
    console.log(`\nДалее: rpgen fill ${projectFile}   (или ручной режим: rpgen next ${projectFile})`);
    return;
  }

  needContent(ctx);
  if (cmd === 'stages') {
    const d = done(ctx);
    stagesOf(ctx).forEach((s, i) => console.log(`${d.has(s.id) ? '[x]' : '[ ]'} ${String(i + 1).padStart(2)}. ${s.id.padEnd(28)} ${s.title}`));
    return;
  }

  if (cmd === 'fill') {
    const cfg = llmConfig(ctx.project);
    const system = stagesOf(ctx)[0] && systemPrompt(ctx);
    let S = pickStages(ctx, opt);
    console.log(`Модель: ${cfg.model} (${cfg.provider}, ${cfg.baseUrl}). Этапов к выполнению: ${S.length}`);
    for (const st of S) {
      // пересобираем список, чтобы промпт видел результаты предыдущих этапов
      const fresh = stagesOf(ctx).find(x => x.id === st.id);
      console.log(`→ ${fresh.id}: ${fresh.title}`);
      const data = await askValidated(cfg, system, fresh.prompt(), fresh.check, { attempts: Number(opt.attempts) || 4 });
      fresh.apply(data); markDone(ctx, fresh.id); saveContent(ctx);
      console.log('   готово');
    }
    const v = isUd(ctx) ? validateUd(ctx.content, { pop: ctx.pop, plan: ctx.plan, fgos: ctx.fgos }) : validate(ctx.content, { pop: ctx.pop, plan: ctx.plan });
    console.log(v.errors.length ? `\nПроверка: ${v.errors.length} ошибок — rpgen validate` : '\nВсе этапы выполнены, проверка пройдена. Далее: rpgen build');
    return;
  }

  if (cmd === 'next') {
    const S = pickStages(ctx, opt);
    if (!S.length) { console.log('Все этапы выполнены. Далее: rpgen build'); return; }
    const st = S[0];
    const system = systemPrompt(ctx);
    const out = path.join(ctx.dir, 'prompt_next.md');
    fs.writeFileSync(out, `${system}\n\n---\n\n${st.prompt()}\n`);
    console.log(`Этап ${st.id}: ${st.title}\nПромпт записан в ${out}.\n1) Вставьте его целиком в чат нейросети.\n2) Сохраните ответ (JSON) в файл, например answer.json.\n3) rpgen import ${projectFile} answer.json`);
    return;
  }

  if (cmd === 'import') {
    const file = pos[1]; if (!file) throw new Error('Укажите файл с ответом нейросети');
    const S = stagesOf(ctx);
    const st = opt.stage ? S.find(s => s.id === opt.stage) : S.find(s => !done(ctx).has(s.id));
    if (!st) throw new Error('Не найден этап для импорта');
    const data = extractJson(fs.readFileSync(file, 'utf8'));
    const errs = st.check(data);
    if (errs.length) {
      console.log(`Ответ для этапа ${st.id} не прошёл проверку. Отправьте нейросети это сообщение:\n`);
      console.log(`Ответ не прошёл проверку. Исправь ВСЕ замечания и верни полный исправленный JSON целиком:\n- ${errs.join('\n- ')}`);
      process.exitCode = 2; return;
    }
    st.apply(data); markDone(ctx, st.id); saveContent(ctx);
    console.log(`Этап ${st.id} записан. Следующий: rpgen next ${projectFile}`);
    return;
  }

  if (cmd === 'validate') {
    const v = isUd(ctx) ? validateUd(ctx.content, { pop: ctx.pop, plan: ctx.plan, fgos: ctx.fgos }) : validate(ctx.content, { pop: ctx.pop, plan: ctx.plan });
    v.errors.forEach(e => console.log('ОШИБКА: ' + e));
    v.warnings.forEach(w => console.log('предупреждение: ' + w));
    const lrs = require('./lr.js').moduleLr(ctx);
    ctx.content.mdk && ctx.content.mdk.forEach(m => { const x = (m.lr || []).filter(n => !lrs.includes(n)); if (x.length) console.log(`предупреждение: ${m.code}: lr ${x.join(', ')} не соответствуют ОК модуля — в документ не выводятся`); });
    console.log(`ЛР документа (${lrs.length}, по ОК модуля): ${lrs.join(', ')}`);
    console.log(v.errors.length ? `Итого ошибок: ${v.errors.length}` : 'Ошибок нет.');
    process.exitCode = v.errors.length ? 1 : 0;
    return;
  }

  if (cmd === 'lint') {
    const r = isUd(ctx) ? require('../tools/lint_ud.js').lintUd(ctx.content) : require('../tools/lint_content.js').lint(ctx.content);
    r.errors.forEach(e => console.log('ОШИБКА: ' + e));
    r.checks.forEach(e => console.log('ПРОВЕРЬ: ' + e));
    console.log(`Ошибок: ${r.errors.length}; мест для проверки человеком: ${r.checks.length}`);
    process.exitCode = r.errors.length ? 1 : 0;
    return;
  }

  if (cmd === 'build') {
    const r = await build(projectFile, { force: !!opt.force });
    console.log(`Готово: ${r.output}`);
    return;
  }
  console.log(HELP);
}

main().catch(e => { console.error('Ошибка:', e.message); process.exit(1); });
