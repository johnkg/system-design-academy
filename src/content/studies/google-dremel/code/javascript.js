// A miniature of Dremel from Google's VLDB 2010 paper, in JavaScript (a teaching model, not Google's code):
// nested records are stored column by column with repetition and definition levels (the paper's own two sample records and its
// Name.Language.Code column), the column alone is enough to rebuild the nesting or to count values within each record, and a
// serving tree of a root, intermediate servers and leaves aggregates partial counts, with a dispatcher that re-sends slow
// tablets or returns when a minimum share of tablets has been scanned. Everything is deterministic.

// The paper's records r1 and r2, trimmed to the fields used here.
const records = [
  { DocId: 10, Name: [{ Language: [{ Code: 'en-us' }, { Code: 'en' }] }, {}, { Language: [{ Code: 'en-gb' }] }] },
  { DocId: 20, Name: [{}] },
];

// Column Name.Language.Code: Name and Language repeat, Code is required, so the largest definition level is 2.
function stripe(recs) {
  const column = [];
  for (const rec of recs) {
    if (rec.Name.length === 0) { column.push([null, 0, 0]); continue; }
    rec.Name.forEach((name, n) => {
      const langs = name.Language ?? [];
      if (langs.length === 0) { column.push([null, n === 0 ? 0 : 1, 1]); return; } // a Name without a Language: defined down to Name only
      langs.forEach((lang, l) => column.push([lang.Code, n === 0 && l === 0 ? 0 : l === 0 ? 1 : 2, 2]));
    });
  }
  return column;
}
const column = stripe(records);
console.log('--- the column Name.Language.Code as (value, repetition level, definition level)');
column.forEach(([v, r, d]) => console.log(`${v ?? 'NULL'}  r=${r}  d=${d}`));

// Rebuild the nesting of this one column from the levels alone.
function assemble(col) {
  const out = [];
  for (const [value, r, d] of col) {
    if (r === 0) out.push([]); // a new record starts
    if (d === 0) continue; // the record has no Name at all
    if (r <= 1) out.at(-1).push([]); // a new Name starts
    if (d >= 2) out.at(-1).at(-1).push(value); // a Language with this Code
  }
  return out;
}
console.log('--- rebuilt from the levels alone (one list per Name)');
assemble(column).forEach((rec, i) => console.log(`r${i + 1}: ${JSON.stringify(rec)}`));

// COUNT(Name.Language.Code) within each record, straight from the column: a value with definition level 2 counts, a record starts at r=0.
function countPerRecord(col) {
  const counts = [];
  for (const [, r, d] of col) { if (r === 0) counts.push(0); if (d === 2) counts[counts.length - 1]++; }
  return counts;
}
console.log(`--- within-record counts without assembling any record: ${countPerRecord(column).join(', ')}`);

// A serving tree: root -> 2 intermediate servers -> 4 leaves, 12 tablets. Every tablet takes 100 ms except tablet 7, a straggler.
console.log('--- a query over 12 tablets on a serving tree');
const TABLETS = 12, LEAVES = 4;
const count = (t) => ((t * 7) % 5) + 1; // each tablet's partial COUNT
const NORMAL = 100, THRESHOLD = 3 * NORMAL; // a tablet is a straggler once it has run 3 times the usual time
const time = (t) => (t === 7 ? 1000 : NORMAL);
const sum = (ts) => ts.reduce((s, t) => s + count(t), 0);
const all = Array.from({ length: TABLETS }, (_, t) => t);
const byLeaf = Array.from({ length: LEAVES }, (_, l) => all.filter((t) => t % LEAVES === l));
const intermediate = [byLeaf[0].concat(byLeaf[1]), byLeaf[2].concat(byLeaf[3])];
console.log(`partial counts added up the tree: ${intermediate.map((ts) => sum(ts)).join(' + ')} = ${sum(all)}`);
const finish = new Map();
byLeaf.forEach((ts) => { let t = 0; for (const tablet of ts) { t += time(tablet); finish.set(tablet, t); } });
console.log(`no mitigation: the query waits for the straggler and takes ${Math.max(...finish.values())} ms`);
console.log(`straggler re-sent to an idle leaf after 3 x the usual tablet time (${THRESHOLD} ms): the query takes ${THRESHOLD + NORMAL} ms`);
const sorted = [...finish].sort((a, b) => a[1] - b[1]);
const needed = Math.ceil(0.83 * TABLETS);
const early = sorted.slice(0, needed);
console.log(`return once ${needed} of ${TABLETS} tablets are scanned (${Math.round((100 * needed) / TABLETS)}%): ${early.at(-1)[1]} ms, count ${sum(early.map(([t]) => t))} instead of ${sum(all)}`);
