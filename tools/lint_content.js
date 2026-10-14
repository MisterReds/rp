#!/usr/bin/env node
// Проверка качества текстов content.json — то, что не ловят проверки этапов и validate:
// повторы, заглушки, запрещённые слова, «части» в названиях занятий, перекос ключей тестов, одинаковые варианты.
// Использование: node tools/lint_content.js <project.json | content.json> [--json]
// Код выхода 1, если есть ОШИБКИ. ПРОВЕРЬ — места для человека или проверяющего агента (сборку не блокируют).
'use strict';
const fs = require('fs');
const path = require('path');

const BANNED = [
  [/портфолио/i, 'портфолио не используется'],
  [/world\s*skills|ворлд\s*скилл|молодые профессионалы/i, 'WorldSkills не упоминается — только «Профессионалы»'],
  [/цифровые инструменты/i, 'таблица «Цифровые инструменты» не включается'],
  [/lorem|ipsum|TODO|TBD|XXX|\?\?\?/, 'заглушка вместо текста'],
  [/как языковая модель|как ИИ|я не могу|к сожалению/i, 'служебная фраза нейросети в тексте документа'],
  [/и т\.\s?[дп]\.|\.\.\.|…/, '«и т. д.», «…» — перечисли конкретно'],
];
const LESSON_BAD = /^(часть|продолжение|повторение|занятие\s*\d|лекция\s*\d|урок\s*\d)|\(часть\s*\d\)|^тема\s*\d/i;
const VAGUE_OPTION = /^(все (ответы|варианты|перечисленн)|ни один из|нет правильного|оба варианта)/i;

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const words = s => new Set(norm(s).split(' ').filter(w => w.length > 2));
function jaccard(a, b) { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let i = 0; A.forEach(w => { if (B.has(w)) i++; }); return i / (A.size + B.size - i); }

function lint(c) {
  const errors = [], checks = [];
  const E = m => errors.push(m), C = m => checks.push(m);

  // 1. запрещённое и заглушки — по всему наполнению, кроме данных ПОП (они дословные)
  const own = JSON.stringify({ mdk: c.mdk.map(m => ({ th: m.themes.map(t => ({ theory: t.theory, lessons: t.lessons })), cp: m.course_project })), up: c.up, pp: c.pp, program: c.program, fos: c.fos });
  BANNED.forEach(([re, why]) => { const m = own.match(re); if (m) E(`«${m[0]}»: ${why}`); });
  const marks = own.match(/\[проверить[^\]]*\]/gi);
  if (marks) C(`пометок «[проверить]»: ${marks.length} — реквизиты надо сверить вручную`);

  // 2. названия теоретических занятий
  c.mdk.forEach(m => {
    const seen = new Map();
    m.themes.forEach(t => {
      const titles = t.lessons ? t.lessons.map(l => l.t) : (t.theory || []);
      titles.forEach(x => {
        const w = `${m.code} ${t.num || ''}`.trim();
        if (!m.custom && LESSON_BAD.test(String(x).trim())) E(`${w}: «${x}» — название занятия без «Часть/Продолжение/Лекция N»: деление на части делает программа`);
        if (!m.custom && t.name && norm(x) === norm(t.name)) E(`${w}: занятие «${x}» повторяет название темы — назови дидактическую единицу`);
        const k = norm(x); if (!m.custom && k && seen.has(k)) E(`${m.code}: занятие «${x}» повторяется (${seen.get(k)} и ${t.num})`); seen.set(k, t.num);
        if (String(x).length > 220) C(`${w}: слишком длинное название занятия (${String(x).length} знаков)`);
        if (!m.custom && norm(x).split(' ').length < 2) C(`${w}: слишком короткое название занятия «${x}»`);
      });
    });
  });

  // 3. практики: повторы заданий и дней
  c.up.forEach(u => {
    const all = (u.works || []).flatMap(w => (w.tasks || []).map(t => t[0]));
    dup(all).forEach(x => E(`${u.code} ${u.label}: задание «${x}» повторяется — каждое задание своё`));
  });
  c.pp.forEach(u => {
    const all = (u.works || []).flatMap(w => w.days || []);
    dup(all).forEach(x => E(`${u.code} ${u.label}: день «${x}» повторяется`));
    if (!u.form && /зач[её]т|аттестаци/i.test(all.join(' '))) E(`${u.code}: в днях производственной практики упомянут зачёт/аттестация — она не проводится`);
  });

  // 4. тесты
  Object.entries(c.fos.tests || {}).forEach(([code, T]) => {
    const m = c.mdk.find(x => x.code === code);
    near(T.map(q => q.q), 0.85).forEach(([a, b]) => E(`${code}: вопросы теста почти одинаковые: «${a}» / «${b}»`));
    T.forEach((q, i) => {
      (q.options || []).forEach(o => { if (VAGUE_OPTION.test(o)) E(`${code} вопрос ${i + 1}: вариант «${o}» — без «все ответы верны/нет правильного»`); });
      if (norm(q.options && q.options[q.answer]) && norm(q.q).includes(norm(q.options[q.answer])) && norm(q.options[q.answer]).length > 12) C(`${code} вопрос ${i + 1}: правильный ответ дословно содержится в вопросе`);
    });
    const longest = T.filter(q => { const L = (q.options || []).map(o => String(o).length); return L.length === 4 && L[q.answer] === Math.max(...L) && L.filter(x => x === L[q.answer]).length === 1; }).length;
    if (T.length >= 10 && longest / T.length > 0.6) E(`${code}: в ${longest} из ${T.length} вопросов правильный вариант самый длинный — ответ угадывается по длине, выровняй варианты`);
    if (m && !m.custom && T.every(q => q.t)) {
      const covered = new Set(T.map(q => q.t));
      m.themes.forEach((t, i) => { if (!covered.has(i + 1)) C(`${code}: по теме ${t.num} ${t.name} нет ни одного вопроса теста`); });
    }
  });

  // 5. экзамены и контрольные
  Object.entries(c.fos.exams || {}).forEach(([k, e]) => {
    near(e.questions || [], 0.8).forEach(([a, b]) => E(`экзамен ${k}: вопросы почти одинаковые: «${a}» / «${b}»`));
    near(e.tasks || [], 0.9).forEach(([a, b]) => E(`экзамен ${k}: задания почти одинаковые: «${a}» / «${b}»`));
  });
  Object.entries(c.fos.control_works || {}).forEach(([k, w]) => {
    const V = (w.variants || []).map(v => (v.tasks || []).join(' '));
    near(V, 2).forEach(() => E(`контрольная ${k}: варианты полностью совпадают — нужны разные исходные данные`));
  });
  near(c.fos.up_questions || [], 0.85).forEach(([a, b]) => E(`вопросы к зачёту по УП почти одинаковые: «${a}» / «${b}»`));

  // 6. экзамен по модулю
  const me = c.fos.module_exam || {};
  // варианты одного объёма с разными исходными данными — норма; ошибка — полное совпадение
  near((me.variants || []).map(v => (v.data || '') + ' ' + (v.tasks || []).map(t => t.text).join(' ')), 2).forEach(([a]) => E(`экзамен по модулю: варианты полностью совпадают — нужны разные исходные данные («${a.slice(0, 60)}…»)`));

  // 7. методы формирования ЛР
  const lm = Object.entries((c.program || {}).lr_methods || {});
  near(lm.map(x => x[1]), 0.9).forEach(([a]) => C(`методы формирования ЛР повторяются для разных ОК: «${String(a).slice(0, 80)}…»`));

  return { errors, checks };
}

function dup(arr) { const s = new Map(); const out = []; arr.forEach(x => { const k = norm(x); if (!k) return; if (s.has(k) && !out.includes(x)) out.push(x); s.set(k, 1); }); return out; }
function near(arr, thr) { const out = []; for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) { if (norm(arr[i]) === norm(arr[j]) || jaccard(arr[i], arr[j]) >= thr) out.push([String(arr[i]).slice(0, 90), String(arr[j]).slice(0, 90)]); } return out; }

function load(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (j.mdk) return j;
  return JSON.parse(fs.readFileSync(path.join(path.dirname(file), j.content || 'content.json'), 'utf8'));
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.log('Использование: node tools/lint_content.js <project.json | content.json>'); process.exit(2); }
  const r = lint(load(file));
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); } else {
    r.errors.forEach(e => console.log('ОШИБКА: ' + e));
    r.checks.forEach(e => console.log('ПРОВЕРЬ: ' + e));
    console.log(`Ошибок: ${r.errors.length}; мест для проверки человеком: ${r.checks.length}`);
  }
  process.exitCode = r.errors.length ? 1 : 0;
}
// запрещённое в ответе этапа (поля name — дословные виды работ ПОП — не проверяются)
function bannedIn(d) {
  const txt = JSON.stringify(d, (k, v) => (k === 'name' ? undefined : v));
  return BANNED.filter(([re]) => re.test(txt)).map(([re, why]) => `«${txt.match(re)[0]}»: ${why} — убери из ответа`);
}
module.exports = { lint, bannedIn, norm, near, dup, LESSON_BAD, VAGUE_OPTION };
