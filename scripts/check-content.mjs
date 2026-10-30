// Fast content checks that run before the build (no browser, no dependencies): links between pages, quiz sanity,
// and that every page ships the pieces readers expect. Errors fail the run; warnings only print.
// Usage: node scripts/check-content.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const slugs = (c) => readdirSync(join(root, 'content', c)).filter((s) => existsSync(join(root, 'content', c, s, 'meta.json'))).sort();
const kinds = { concepts: slugs('concepts'), patterns: slugs('patterns'), studies: slugs('studies') };
const meta = {};
for (const [kind, list] of Object.entries(kinds)) for (const s of list) meta[`${kind}/${s}`] = read(join(root, 'content', kind, s, 'meta.json'));

const errors = [], warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const has = (kind, slug) => kinds[kind].includes(slug);
// Language files every code/ folder must have, read from the language config (a missing one leaves that language's readers with no code).
const langFiles = [...readFileSync(join(root, 'languages.config.ts'), 'utf8').matchAll(/id: '([a-z]+)'.*?ext: '([a-z]+)'/g)].map((m) => `${m[1]}.${m[2]}`);

// 1. Links between pages.
for (const s of kinds.concepts) for (const r of meta[`concepts/${s}`].related ?? []) {
  const kind = r.kind === 'pattern' ? 'patterns' : 'concepts';
  if (!has(kind, r.slug)) err(`concepts/${s}`, `related ${r.kind} "${r.slug}" does not exist`);
}
for (const s of kinds.patterns) for (const r of meta[`patterns/${s}`].related ?? []) {
  if (!has('patterns', r)) err(`patterns/${s}`, `related pattern "${r}" does not exist`);
}
for (const s of kinds.studies) {
  const m = meta[`studies/${s}`];
  const refs = [...m.steps.flatMap((x) => x.concepts), ...m.failures.flatMap((x) => x.concepts)];
  for (const r of refs) if (!has(r.kind === 'pattern' ? 'patterns' : 'concepts', r.slug)) err(`studies/${s}`, `references unknown ${r.kind ?? 'concept'} "${r.slug}"`);
  const ids = new Set(m.nodes.map((n) => n.id));
  for (const e of m.edges) if (!ids.has(e.from) || !ids.has(e.to)) err(`studies/${s}`, `edge ${e.from} -> ${e.to} uses an unknown node`);
  // The diagram shows a node or edge at steps at <= step < until. An arrow must never be visible while one of its ends is not.
  const span = (x) => [x.at, x.until ?? Infinity], byId = new Map(m.nodes.map((n) => [n.id, n]));
  for (const e of m.edges) {
    const [a, b] = span(e);
    for (const end of [e.from, e.to]) {
      const n = byId.get(end); if (!n) continue;
      const [na, nb] = span(n);
      if (a < na || b > nb) err(`studies/${s}`, `edge ${e.from} -> ${e.to} (steps ${a} to ${b === Infinity ? 'end' : b - 1}) is shown while node "${end}" is not`);
    }
  }
}

// 2. Every page ships what readers expect.
const playgroundFiles = readdirSync(join(root, 'playgrounds')).map((f) => f.toLowerCase());
for (const kind of ['concepts', 'patterns']) for (const s of kinds[kind]) {
  // The page finds a playground by name, ignoring case and punctuation (playgroundFor in src/lib.ts).
  const want = `${meta[`${kind}/${s}`].name.replace(/[^a-z0-9]+/gi, '')}playground.astro`.toLowerCase();
  if (!playgroundFiles.includes(want)) warn(`${kind}/${s}`, `no playground file named like ${want}`);
}
for (const [kind, list] of Object.entries(kinds)) for (const s of list) for (const dir of ['code', 'before']) {
  // Some concepts teach without code; a page that has samples must have them in every language.
  if (!existsSync(join(root, 'content', kind, s, dir))) { if (kind === 'studies' && dir === 'code') err(`studies/${s}`, 'no code/ folder'); continue; }
  for (const f of langFiles) if (!existsSync(join(root, 'content', kind, s, dir, f))) err(`${kind}/${s}`, `no ${dir}/${f}`);
}
for (const s of kinds.concepts) {
  if (!existsSync(join(root, 'content/concepts', s, 'visuals/steps.json'))) err(`concepts/${s}`, 'missing visuals/steps.json');
  if (!meta[`concepts/${s}`].quiz) err(`concepts/${s}`, 'no quiz');
  // Meters under the animation: every reading names a defined meter and stays within 0..max.
  const stepsPath = join(root, 'content/concepts', s, 'visuals/steps.json');
  if (existsSync(stepsPath)) {
    const st = read(stepsPath), defs = new Map((st.meters ?? []).map((m) => [m.id, m]));
    if (defs.size !== (st.meters ?? []).length) err(`concepts/${s}`, 'two meters share an id');
    st.frames.forEach((fr, i) => Object.entries(fr.meters ?? {}).forEach(([id, v]) => {
      const m = defs.get(id);
      if (!m) err(`concepts/${s}`, `frame ${i + 1} sets unknown meter "${id}"`);
      else if (typeof v !== 'number' || v < 0 || v > m.max) err(`concepts/${s}`, `frame ${i + 1} meter "${id}" is ${v}, outside 0 to ${m.max}`);
    }));
  }
}
for (const s of kinds.studies) {
  const d = join(root, 'content/studies', s);
  if (!existsSync(join(d, 'visuals/final.json'))) warn(`studies/${s}`, 'no visuals/final.json');
  if (!existsSync(join(root, 'studies', s, 'Estimator.astro'))) warn(`studies/${s}`, 'no Estimator.astro');
  if (!meta[`studies/${s}`].quiz) err(`studies/${s}`, 'no quiz');
  for (const src of meta[`studies/${s}`].sources ?? []) if (!/^https:\/\//.test(src.url)) err(`studies/${s}`, `source "${src.title}" must use an https link`);
}
for (const s of kinds.patterns) if (!meta[`patterns/${s}`].quiz) err(`patterns/${s}`, 'no quiz');

// 3. Quiz sanity (the schema already checks shapes: this is about meaning and style).
const OPTIONS = 4; // per question, as in src/content.config.ts
const MAX_LONGEST_SHARE = 35; // % of questions whose correct option may be the single longest (chance is 100 / OPTIONS)
const positional = /\b([Oo]ption|[Aa]nswer|[Cc]hoice) [A-D]\b|\b[Tt]he (first|second|third|fourth|last|top|bottom) (option|choice)\b|\([A-D]\)/;
const dist = { positions: Array(OPTIONS).fill(0), longest: 0, total: 0 };
for (const [id, m] of Object.entries(meta)) {
  (m.quiz ?? []).forEach((q, i) => {
    const w = `${id} quiz #${i + 1}`;
    if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== OPTIONS) err(w, 'two options are identical');
    if (!q.question.trim().endsWith('?')) warn(w, 'question does not end with a question mark');
    if (positional.test([q.question, q.explanation, ...q.options].join(" || "))) err(w, 'refers to an option by position, but options are shown shuffled');
    if (/[—–]/.test(`${q.question} ${q.explanation} ${q.options.join(' ')}`)) warn(w, 'contains a dash character (house style prefers commas or full stops)');
    const lens = q.options.map((o) => o.length), top = Math.max(...lens);
    dist.total++; dist.positions[q.answer]++;
    if (lens[q.answer] === top && lens.filter((l) => l === top).length === 1) dist.longest++;
  });
}
const share = dist.total ? Math.round((100 * dist.longest) / dist.total) : 0;
if (share > MAX_LONGEST_SHARE) err('quizzes', `the correct option is the single longest in ${share}% of questions (limit ${MAX_LONGEST_SHARE}%, chance is ${100 / OPTIONS}%)`);


// 4. The what's-new page: every link in the changelog must point at a real page.
{
  const text = readFileSync(join(root, 'data/changelog.ts'), 'utf8');
  const pages = new Set(readdirSync(join(root, 'pages')).map((f) => f.replace(/\.astro$/, '').replace(/\.(ts|js)$/, '')));
  const areaIds = new Set([...readFileSync(join(root, 'data/areas.ts'), 'utf8').matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]));
  for (const m of text.matchAll(/href: '([^']+)'/g)) {
    const [first, second] = m[1].replace(/\/$/, '').split('/');
    const detail = { concepts: kinds.concepts, patterns: kinds.patterns, 'case-studies': kinds.studies, cheatsheets: [...areaIds] }[first];
    if (!pages.has(first)) err('data/changelog.ts', `link "${m[1]}" does not match a page`);
    else if (second && (!detail || !detail.includes(second))) err('data/changelog.ts', `link "${m[1]}" names a page that does not exist`);
  }
  const dates = [...text.matchAll(/date: '(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]);
  if (dates.some((d, i) => i > 0 && d >= dates[i - 1])) err('data/changelog.ts', 'entries must be newest first with distinct dates');
}

// 5. Search aliases: each group needs at least two entries, all lowercase, none repeated, and at least one one-word trigger.
{
  const text = readFileSync(join(root, 'data/searchAliases.ts'), 'utf8');
  const MIN_GROUP = 2;
  for (const line of text.split('\n').filter((l) => /^\s*\[('.*',?\s*)+\],?$/.test(l))) {
    const words = [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const where = `data/searchAliases.ts [${words[0]}]`;
    if (words.length < MIN_GROUP) err(where, 'a group needs at least two entries');
    if (new Set(words).size !== words.length) err(where, 'repeats an entry');
    if (words.some((x) => x !== x.toLowerCase())) err(where, 'entries must be lowercase');
    if (!words.some((x) => !x.includes(' '))) err(where, 'needs at least one one-word entry to act as a trigger');
  }
}

// 6. Interview questions: ids unique, 4 to 6 covers, at least 2 follow-ups, at least 1 pitfall, and every read link points at a real page.
{
  const text = readFileSync(join(root, 'data/interviewQuestions.ts'), 'utf8');
  const start = text.indexOf('export const interviewQuestions');
  const blocks = text.slice(start).split(/\n  \{\n    id: /).slice(1);
  const seen = new Set();
  const list = (b, key) => { const m = b.match(new RegExp(`\\n    ${key}: \\[\\n([\\s\\S]*?)\\n    \\],`)); return m ? m[1].split('\n').filter((l) => l.trim()) : []; };
  if (blocks.length < 20) err('data/interviewQuestions.ts', `only ${blocks.length} questions found`);
  for (const b of blocks) {
    const id = b.match(/^'([^']+)'/)?.[1] ?? '(no id)';
    const w = `data/interviewQuestions.ts [${id}]`;
    if (seen.has(id)) err(w, 'duplicate id'); seen.add(id);
    if (!/kind: '(concept|design|tradeoff)'/.test(b)) err(w, 'kind must be concept, design or tradeoff');
    if (!/level: '(beginner|intermediate|advanced)'/.test(b)) err(w, 'level must be beginner, intermediate or advanced');
    const covers = list(b, 'covers'), follow = list(b, 'followUps'), pit = list(b, 'pitfalls');
    if (covers.length < 4 || covers.length > 6) err(w, `covers has ${covers.length} points (needs 4 to 6)`);
    if (follow.length < 2 || follow.length > 3) err(w, `followUps has ${follow.length} (needs 2 or 3)`);
    if (pit.length < 1 || pit.length > 2) err(w, `pitfalls has ${pit.length} (needs 1 or 2)`);
    if (/[—–]/.test(b)) warn(w, 'contains a dash character (house style prefers commas or full stops)');
    const reads = [...b.matchAll(/\{ kind: '(concept|study)', slug: '([^']+)' \}/g)];
    if (!reads.length) err(w, 'no read links');
    for (const [, k, slug] of reads) if (!has(k === 'concept' ? 'concepts' : 'studies', slug)) err(w, `read ${k} "${slug}" does not exist`);
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
console.log(`checked ${Object.keys(meta).length} pages and ${dist.total} quiz questions (correct option longest in ${share}%): ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
