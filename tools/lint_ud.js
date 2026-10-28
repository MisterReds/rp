#!/usr/bin/env node
// Проверка качества текстов content.json учебной дисциплины (project.json: "kind": "ud"):
// повторы, заглушки, запрещённые слова, перекос ключей тестов, задания без «Дано … Результат …».
// Использование: node tools/lint_ud.js <project.json | content.json> [--json]
// Код выхода 1, если есть ОШИБКИ. ПРОВЕРЬ — места для человека (сборку не блокируют).
'use strict';
const fs = require('fs');
const path = require('path');
const { BANNED, VAGUE_OPTION, norm, near, dup } = require('./lint_content.js');

function lintUd(c) {
  const errors = [], checks = [];
  const E = m => errors.push(m), C = m => checks.push(m);
  const u = c.ud, f = c.fos || {};
  const own = JSON.stringify({ themes: u.themes.map(t => ({ n: t.name, c: t.content, l: t.lessons.map(l => l.t) })), program: c.program, fos: { tests: f.tests, exams: f.exams, control_works: f.control_works } });
  BANNED.forEach(([re, why]) => { const m = own.match(re); if (m) E(`«${m[0]}»: ${why}`); });
  const marks = own.match(/\[проверить[^\]]*\]/gi);
  if (marks) C(`пометок «[проверить]»: ${marks.length} — реквизиты надо сверить вручную`);

  dup(u.themes.flatMap(t => t.lessons.map(l => l.t))).forEach(x => C(`занятие «${x}» повторяется в КТП (как у преподавателя)`));
  u.themes.forEach(t => { if (norm(t.content.join(' ')) === '') E(`${t.num}: пустое содержание темы`); });

  const T = f.tests || [];
  near(T.map(q => q.q), 0.85).forEach(([a, b]) => E(`вопросы теста почти одинаковые: «${a}» / «${b}»`));
  T.forEach((q, i) => {
    (q.options || []).forEach(o => { if (VAGUE_OPTION.test(o)) E(`тест, вопрос ${i + 1}: вариант «${o}» — без «все ответы верны/нет правильного»`); });
    const a = norm(q.options && q.options[q.answer]);
    if (a && norm(q.q).includes(a) && a.length > 12) C(`тест, вопрос ${i + 1}: правильный ответ дословно содержится в вопросе`);
  });
  const longest = T.filter(q => { const L = (q.options || []).map(o => String(o).length); return L.length === 4 && L[q.answer] === Math.max(...L) && L.filter(x => x === L[q.answer]).length === 1; }).length;
  if (T.length >= 10 && longest / T.length > 0.5) E(`тест: в ${longest} из ${T.length} вопросов правильный вариант самый длинный — выровняй варианты`);
  if (T.length >= 10) {
    const L = T.map(q => (q.options || []).map(o => String(o).length));
    const spread = L.filter(l => l.length === 4 && Math.max(...l) > 2.5 * Math.min(...l) + 10).length;
    if (spread / T.length > 0.3) C(`тест: у ${spread} вопросов длины вариантов сильно различаются`);
  }

  Object.entries(f.exams || {}).forEach(([k, e]) => {
    near(e.questions || [], 0.8).forEach(([a, b]) => E(`экзамен ${k}: вопросы почти одинаковые: «${a}» / «${b}»`));
    near(e.tasks || [], 2).forEach(([a]) => E(`экзамен ${k}: задание повторяется дословно: «${a}»`));
    near(e.tasks || [], 0.9).forEach(([a, b]) => C(`экзамен ${k}: задания почти одинаковые по словам (допустимо, если исходные данные разные): «${a}» / «${b}»`));
    (e.tasks || []).forEach((t, i) => {
      if (!/дано/i.test(t) || !/результат/i.test(t)) E(`экзамен ${k}, задание ${i + 1}: нет «Дано» и/или «Результат»`);
      if (String(t).length > 700) C(`экзамен ${k}, задание ${i + 1}: слишком длинное (${String(t).length} знаков)`);
    });
  });
  const lm = Object.entries((c.program || {}).lr_methods || {});
  near(lm.map(x => x[1]), 0.9).forEach(([a]) => C(`методы формирования ЛР повторяются для разных ОК: «${String(a).slice(0, 80)}…»`));
  return { errors, checks };
}

function load(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (j.ud) return j;
  return JSON.parse(fs.readFileSync(path.join(path.dirname(file), j.content || 'content.json'), 'utf8'));
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.log('Использование: node tools/lint_ud.js <project.json | content.json>'); process.exit(2); }
  const r = lintUd(load(file));
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1)); else {
    r.errors.forEach(e => console.log('ОШИБКА: ' + e));
    r.checks.forEach(e => console.log('ПРОВЕРЬ: ' + e));
    console.log(`Ошибок: ${r.errors.length}; мест для проверки человеком: ${r.checks.length}`);
  }
  process.exitCode = r.errors.length ? 1 : 0;
}
module.exports = { lintUd };
