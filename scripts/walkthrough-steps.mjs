// The pure half of the walkthrough check (scripts/check-walkthroughs.mjs): no browser, so tests/walkthrough-steps.test.ts can run it.
//
// claims() finds the numbers a "how to try it" step quotes and shown() says whether the simulation displayed one of them.
// parseSteps() reads every step as an ordered script, the way a reader follows it: press a button (by its label, "twice" or
// "3 times"), choose an option, set a slider or box to the number written after its label ("Raise the limit to 400",
// "8 shards", "Lower the share to 50%"), tick a box, type into a text box ("set Query to red apple juice"). Only the
// part of a sentence before its colon is read as instructions; what follows the colon is the result, from which only
// an option named by its full text is taken ("compare intervals: every 1 min ..., every 15 min ...").
//
// The page describes its controls and buttons as plain data (see 'describe' in the check's drive function):
//   controls: [{ kind: 'select' | 'range' | 'number' | 'checkbox' | 'radio' | 'text', label, min, max, step, options: [{ value, text }] }]
//   buttons:  [{ text }]
// min, max and step are the attribute strings ('' when absent). Actions refer to both lists by position:
//   { type: 'press', b, times }   { type: 'set', c, value }

export const MIN_PLAIN = 10; // whole numbers below this are counts in prose ("3 copies", "step 2"), not claims
export const APPROX_TOLERANCE = 0.05; // "about 300" may match 290 to 315
const APPROX_WORDS = /(about|around|roughly|nearly|almost|over|under|above|below|up to|at least|at most|more than|less than|~)\s*$/i;
export const MIN_LABEL_WORD = 4; // a step names a control when it uses the label or any word of it this long

// The numbers a step quotes.
export function claims(text) {
  const out = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (/[A-Za-z/_-]/.test(before)) continue; // part of a name such as p99, HTTP2 or v2
    const raw = m[0].replace(/,/g, '');
    const value = Number(raw);
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    if (!Number.isFinite(value) || (!decimals && value < MIN_PLAIN)) continue;
    if (!decimals && value >= 1990 && value <= 2100) continue; // a year
    out.push({ raw: m[0].replace(/,$/, ''), value, decimals, approx: APPROX_WORDS.test(text.slice(Math.max(0, m.index - 14), m.index)), at: m.index });
  }
  return out;
}
// Did the simulation show this claim? `numbers` is every number it displayed.
export const shown = (c, numbers) => numbers.some((o) => c.decimals
  ? Math.abs(Math.round(o * 10 ** c.decimals) / 10 ** c.decimals - c.value) < 1e-9
  : o === c.value || (c.approx && Math.abs(o - c.value) <= APPROX_TOLERANCE * c.value));
// The claims of a how-to list that the simulation never showed, each with its step (from 1) and the step's text.
export const missingClaims = (steps, numbers) => steps.flatMap((text, i) => claims(text).filter((c) => !shown(c, numbers)).map((c) => ({ step: i + 1, c, text })));

const norm = (s) => (s || '').toLowerCase().replace(/[“”"]/g, '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const UNIT = String.raw`(%|(?:ms|s|secs?|seconds?|mins?|minutes?|h|hours?|days?|km|kb|mb|gb|tb|gbps|mbps|x|thousands?|millions?)(?![a-z]))?`;
const toNum = (s) => Number(s.replace(/,/g, ''));
const STOP = new Set(['that', 'this', 'with', 'from', 'when', 'what', 'than', 'then', 'only', 'each', 'into', 'over', 'under', 'after', 'before', 'first', 'every', 'other', 'still', 'there', 'their', 'which', 'where', 'while', 'never', 'always', 'without', 'more', 'less', 'most', 'some', 'have', 'been', 'were', 'they', 'also', 'same', 'once', 'none', 'both', 'second', 'seconds', 'minute', 'minutes', 'hours', 'percent', 'times', 'million', 'thousand']);
const edge = (s, at, len) => !/[a-z0-9]/.test(s[at - 1] ?? '') && !/[a-z0-9]/.test(s[at + len] ?? '');
const occurrences = (s, needle, prefix = false) => {
  const out = [];
  if (!needle) return out;
  for (let at = s.indexOf(needle); at >= 0; at = s.indexOf(needle, at + 1)) {
    if (prefix ? !/[a-z0-9]/.test(s[at - 1] ?? '') : edge(s, at, needle.length)) out.push(at);
  }
  return out;
};
const wordsOf = (s) => s.split(/[^a-z0-9'-]+/).map((w) => w.replace(/^[-']+|[-']+$/g, '')).filter(Boolean);
const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const fits = (c, v) => {
  const min = c.min === '' ? -Infinity : Number(c.min), max = c.max === '' ? Infinity : Number(c.max);
  const step = c.step === '' || c.step === 'any' ? 0 : Number(c.step);
  const off = step ? Math.abs((v - (Number.isFinite(min) ? min : 0)) / step - Math.round((v - (Number.isFinite(min) ? min : 0)) / step)) : 0;
  return v >= min && v <= max && off < 1e-6;
};
const numeric = (c) => c.kind === 'range' || c.kind === 'number';
const unitMatch = (u, list) => !!u && list.some((x) => x === u || (u.length >= 2 && x.length >= 2 && (x.startsWith(u) || u.startsWith(x))));
// A select's option named by a number ("shards to 8", "a 10 s wait", "5,000"): the option whose first number it is, with the unit if given.
const numberOption = (c, v, unit) => {
  const hits = c.options.filter((o) => o.num === v);
  return (unit && hits.find((o) => unitMatch(unit, [o.unit]))) || hits[0] || null;
};
const RESULT = /^(is|are|was|were|be|been|break|breaks|broke|fail|fails|failed|go|goes|went|get|gets|got|finish|finishes|finished|stay|stays|remain|remains|drop|drops|fall|falls|rise|rises|end|ends|wait|waits|give|gives|sit|sits|become|becomes|arrive|arrives|match|matches|hold|holds|run|runs|ones|now|still|already|lost|left|served|refused|rejected|dropped|blocked|kept|found|missed|missing)$/;
// "up to 30 s" and "from 15.4 to 18.6" quote results, not settings.
const APPROX = /(\bup|\d%?)\s+(to|at)$/;
// "Lower the threshold to 3": the verb, then at most three words, then "to".
const VERB_TO = /\b(set|raise|lower|push|cut|change|increase|decrease|reduce|move|put|bring|drag|slide|turn)(?:\s+[a-z'-]+){0,3}\s*$/;

// Every step as a list of sentences, each a list of actions. `typed` lists the numbers and text the scripts put into a
// slider or box: a claim of the same number counts as shown once typed, since the control then displays it.
export function parseSteps(steps, controls, buttons, minLabelWord = MIN_LABEL_WORD) {
  const all = controls.map((el) => {
    const kind = el.kind;
    const label = norm(el.label);
    const base = label.replace(/\([^)]*\)/g, ' ').replace(/\s+\d[\d.,]*\s*[a-z%]*$/, '').replace(/\s+/g, ' ').trim(); // drop "(ms)" and a shown value after the label
    const units = [...label.matchAll(/\(([^)]*)\)/g)].flatMap((m) => wordsOf(m[1])).concat(label.includes('%') ? ['%'] : []);
    const words = [...new Set(wordsOf(base).filter((w) => w.length >= minLabelWord && !STOP.has(w) && !/^\d/.test(w)))];
    const options = kind === 'select' ? (el.options ?? []).map((o) => {
      const full = norm(o.text);
      const n = full.match(new RegExp(`(${NUM})\\s*(%|[a-z]+)?`));
      return { value: o.value, full, head: full.split(/,|\s\(|:/)[0].trim(), num: n ? toNum(n[1]) : null, unit: n?.[2] ?? '', words: new Set(wordsOf(full).filter((w) => w.length >= 5 && !STOP.has(w))) };
    }) : [];
    return { min: el.min ?? '', max: el.max ?? '', step: el.step ?? '', kind, label, base, units, words, all: new Set(wordsOf(base)), options };
  });
  const buttonInfo = buttons.map((b, i) => ({ i, raw: norm(b.text) })).filter((b) => b.raw.length >= 3);
  const resets = buttonInfo.filter((b) => /^reset\b/.test(b.raw));
  const isReset = (a) => resets.some((r) => r.i === a.b);
  // Actions for one clause. `result` is the text after a colon: only options named in full are taken from it.
  const parseClause = (s, result) => {
    const found = []; // { at, end, act }
    const covered = (at, end) => found.some((f) => f.act.type === 'press' && at < f.end && end > f.at);
    const used = []; // spans of numbers already bound to a control
    const take = (at, end) => used.push([at, end]);
    const free = (at) => !used.some(([a, b]) => at >= a && at < b);
    // A word that names a control ("8 partitions", "consumers") does not also pick an option of another select by that word.
    const labelled = (at, end) => all.some((c) => [...c.words].some((w) => occurrences(s, stem(w), true).some((x) => /^s?(?![a-z0-9])/.test(s.slice(x + stem(w).length)) && at < x + stem(w).length && end > x)));
    for (const b of buttonInfo) for (const at of occurrences(s, b.raw)) {
      if (/without (pressing |clicking )?$/.test(s.slice(Math.max(0, at - 20), at))) continue;
      const m = s.slice(at + b.raw.length).match(/^\s*(twice|(\d+|two|three|four|five) times)/);
      const times = !m ? 1 : m[1] === 'twice' ? 2 : ({ two: 2, three: 3, four: 4, five: 5 })[m[2]] ?? Number(m[2]);
      found.push({ at, end: at + b.raw.length, act: { type: 'press', b: b.i, times } });
    }
    if (resets.length) for (const at of occurrences(s, 'reset')) {
      if (covered(at, at + 5) || /without (pressing |clicking )?$/.test(s.slice(Math.max(0, at - 20), at))) continue;
      const r = resets.find((b) => b.raw === 'reset') ?? (resets.length === 1 ? resets[0] : null);
      if (r) found.push({ at, end: at + 5, act: { type: 'press', b: r.i, times: 1 } });
    }
    all.forEach((c, ci) => {
      if (c.kind !== 'select') return;
      const hits = [];
      c.options.forEach((o, oi) => {
        if (/[a-z]{2}/.test(o.full)) for (const at of occurrences(s, o.full)) hits.push({ at, end: at + o.full.length, prio: 3, oi }); // not a bare number
        if (result) return;
        if (o.head.length >= 4 && o.head !== o.full && !/^\d/.test(o.head)) for (const at of occurrences(s, o.head)) hits.push({ at, end: at + o.head.length, prio: 2, oi });
      });
      if (!result) {
        // A word only some options share, outside the label: the most specific option that has it ("lockout", "backfill").
        const labelWords = new Set(wordsOf(c.label));
        const vocab = new Set(c.options.flatMap((o) => [...o.words]));
        for (const w of vocab) {
          if (labelWords.has(w)) continue;
          const holders = c.options.map((o, oi) => ({ o, oi })).filter(({ o }) => o.words.has(w));
          if (holders.length === c.options.length) continue;
          const fewest = Math.min(...holders.map(({ o }) => o.words.size));
          const smallest = holders.filter(({ o }) => o.words.size === fewest);
          if (smallest.length !== 1) continue;
          const pick = smallest[0];
          for (const at of occurrences(s, stem(w), true)) if (/^s?(?![a-z0-9])/.test(s.slice(at + stem(w).length)) && !labelled(at, at + stem(w).length)) hits.push({ at, end: at + stem(w).length, prio: 1, oi: pick.oi });
        }
      }
      hits.sort((x, y) => y.prio - x.prio || (y.end - y.at) - (x.end - x.at));
      const kept = [];
      for (const h of hits) if (!kept.some((k) => h.at < k.end && h.end > k.at) && !covered(h.at, h.end)) kept.push(h);
      for (const h of kept) found.push({ at: h.at, end: h.end, act: { type: 'set', c: ci, value: c.options[h.oi].value } });
    });
    const wholes = all.flatMap((c) => (c.base.length >= 3 ? occurrences(s, c.base).map((at) => [at, at + c.base.length]) : []));
    if (!result) all.forEach((c, ci) => {
      const spans = [];
      if (c.base.length >= 3) for (const at of occurrences(s, c.base)) spans.push([at, at + c.base.length, true]);
      for (const w of c.words) for (const at of occurrences(s, stem(w), true)) spans.push([at, at + stem(w).length, false]);
      for (const [at, end, whole] of spans) {
        if (covered(at, end)) continue;
        if (c.kind === 'checkbox') {
          // The whole label, or a word of it right after "tick" ("tick only the classifier"). A word inside a whole label
          // found here belongs to that label's box ("tick Liveness checks the database" is not also "Readiness checks the database").
          if (!whole && wholes.some(([a, e]) => at >= a && end <= e)) continue;
          const verb = s.slice(0, at).match(/\b(tick|untick|check|uncheck)\s+((?:[a-z]+\s+){0,2})$/);
          if (!whole && !verb) continue;
          // "Untick state and PKCE still stops it" unticks only the first.
          const off = (!whole && /^un/.test(verb[1]) && !/\band\b/.test(verb[2])) || /\b(untick|uncheck|clear|turn off)\s+(the\s+)?$/.test(s.slice(Math.max(0, at - 16), at)) || /^\s+off\b/.test(s.slice(end));
          found.push({ at, end, act: { type: 'set', c: ci, value: !off } });
          continue;
        }
        found.push({ at, end, act: { type: 'mention', c: ci } });
        // Past the rest of the word and the label's other words ("Machines lost at once to 3").
        let restAt = end + s.slice(end).match(/^[a-z'-]*/)[0].length;
        for (let m; (m = s.slice(restAt).match(/^,?\s+([a-z'-]+)/)) && c.all.has(m[1]);) restAt += m[0].length;
        const gap = s.slice(restAt).match(/^\s*(?:\([^)]*\)\s*)?(?:(?:is|are|was)\s+)?(?:(?:set|back)\s+)?(to|at|on|=|every|:)?\s*/);
        const vAt = restAt + gap[0].length, rest = s.slice(vAt);
        if (c.kind === 'text') {
          const t = gap[1] === 'to' && rest.match(/^([^,;:.]+?)(?=\s+and\s|\s+then\s|\s+with\s|,|;|:|\.|$)/);
          if (t) found.push({ at, end, act: { type: 'set', c: ci, value: t[1].trim() } });
          continue;
        }
        if (c.kind === 'select') {
          // The option right after the label and its "to", or right after the label when the option itself starts with "on".
          const lenIn = (r) => (x) => (r.startsWith(x.full) && edge(r, 0, x.full.length) ? x.full.length : x.head.length >= 2 && r.startsWith(x.head) && edge(r, 0, x.head.length) ? x.head.length : 0);
          const bare = s.slice(restAt).match(/^\s*/)[0].length + restAt;
          let o = null, oAt = vAt, best = 0;
          for (const [r, rAt] of [[rest, vAt], [s.slice(bare), bare]]) for (const x of c.options) if (lenIn(r)(x) > best) { best = lenIn(r)(x); o = x; oAt = rAt; }
          if (o) { take(oAt, oAt + best); found.push({ at, end, act: { type: 'set', c: ci, value: o.value } }); continue; }
        }
        const n = rest.match(new RegExp(`^\\$?(${NUM})(?![\\d]|:\\d)\\s*${UNIT}`)); // not a clock time such as 14:00
        // Only with a word that sets it ("limit to 400", "batch every 1 minute"): "scores 66" quotes a result.
        if (n && free(vAt) && gap[1] && gap[1] !== 'on') {
          const v = toNum(n[1].replace(/,$/, ''));
          if (numeric(c) && fits(c, v)) { take(vAt, vAt + n[0].length); found.push({ at, end, act: { type: 'set', c: ci, value: v } }); continue; }
          const o = c.kind === 'select' && numberOption(c, v, n[2]);
          if (o) { take(vAt, vAt + n[0].length); found.push({ at, end, act: { type: 'set', c: ci, value: o.value } }); continue; }
        }
        // A number written just before the label: "12 agents", "a 10 s wait", "20 per second".
        // Not when the label is followed by what happens to them ("0 connections break", "40 healthy ones are dropped").
        // Nor after "from", "in", "of"...: "drops from 400 to 300 requests", "104 hits in 200 requests" quote results.
        const before = s.slice(0, at).match(new RegExp(`(^|[^a-z0-9$.,]\\s*|\\b[a-z]+\\s+)\\$?(${NUM})\\s*${UNIT}\\s+(?:per\\s+)?$`));
        if (before && (/^(from|in|of|than|by|about|around|nearly|over|under|only|all|and)\s+$/.test(before[1]) || (/^to\s+$/.test(before[1]) && /\d%?\s*$/.test(s.slice(0, at - before[0].length))))) continue;
        const next = s.slice(restAt).match(/^\s*(?:\([^)]*\)\s*)?([a-z']+)?/)[1] ?? '';
        if (before && free(at - before[0].length + before[1].length) && !RESULT.test(next)) {
          const v = toNum(before[2].replace(/,$/, ''));
          const bAt = at - before[0].length + before[1].length;
          if (numeric(c) && fits(c, v)) { take(bAt, at); found.push({ at: bAt, end, act: { type: 'set', c: ci, value: v } }); continue; }
          const o = c.kind === 'select' && numberOption(c, v, before[3]);
          if (o) { take(bAt, at); found.push({ at: bAt, end, act: { type: 'set', c: ci, value: o.value } }); }
        }
      }
    });
    if (!result) {
      // A number no label claimed: "to 500 ms" or "at 8 km" sets the one slider measured in that unit; "Lower the threshold
      // to 3" sets the slider the step last named, or the only slider there is; so does "At 75" at the start of a clause.
      const sliders = all.map((c, ci) => ({ c, ci })).filter(({ c }) => numeric(c));
      for (const m of s.matchAll(new RegExp(`(?:^|\\b)(to|at) \\$?(${NUM})(?![\\d]|:\\d)\\s*${UNIT}`, 'g'))) {
        const vAt = m.index + m[0].indexOf(m[2]);
        if (!free(vAt) || APPROX.test(s.slice(Math.max(0, m.index - 14), m.index + m[1].length))) continue;
        const v = toNum(m[2].replace(/,$/, ''));
        let pick = null;
        const byUnit = sliders.filter(({ c }) => unitMatch(m[3], c.units) && fits(c, v));
        if (byUnit.length === 1) pick = byUnit[0];
        else if (m[3] && !sliders.some(({ c }) => unitMatch(m[3], c.units))) continue; // "At 25%" with no slider in % is a result
        else if ((m[1] === 'to' && VERB_TO.test(s.slice(0, m.index))) || (m[1] === 'at' && m.index === 0)) {
          const last = found.filter((f) => f.at < m.index && (f.act.type === 'mention' || f.act.type === 'set') && numeric(all[f.act.c]) && fits(all[f.act.c], v)).sort((x, y) => y.at - x.at)[0];
          const fitting = sliders.filter(({ c }) => fits(c, v));
          pick = last ? { ci: last.act.c } : fitting.length === 1 && sliders.length === 1 ? fitting[0] : null;
        }
        if (pick) { take(vAt, vAt + m[2].length); found.push({ at: m.index, end: vAt, act: { type: 'set', c: pick.ci, value: v } }); }
      }
      // An order typed into a form right after an option: "buy 200 at 10.10" fills the number boxes the values fit.
      const boxes = all.map((c, ci) => ({ c, ci })).filter(({ c }) => c.kind === 'number');
      for (const f of found.filter((x) => x.act.type === 'set' && all[x.act.c].kind === 'select')) {
        const m = s.slice(f.end).match(new RegExp(`^\\s+(${NUM})(?:\\s+(?:at|for|@)\\s+(${NUM}))?`));
        if (!m) continue;
        for (const raw of [m[1], m[2]].filter(Boolean)) {
          const v = toNum(raw), fit = boxes.filter(({ c }) => fits(c, v));
          if (fit.length === 1) found.push({ at: f.end + 1, end: f.end + 1, act: { type: 'set', c: fit[0].ci, value: v } });
        }
      }
    }
    return found.sort((x, y) => x.at - y.at).map((f) => f.act);
  };
  // Sentences, each split at its first colon outside brackets into instructions and result.
  const sentencesOf = (text) => text.split(/(?<=[.;!?])\s+(?=[A-Z0-9"“(])|;\s+/).map((sentence) => {
    const s = norm(sentence);
    let depth = 0, cut = -1;
    for (let i = 0; i < s.length && cut < 0; i++) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; else if (s[i] === ':' && depth <= 0) cut = i; }
    const head = cut < 0 ? s : s.slice(0, cut), tail = cut < 0 ? '' : s.slice(cut + 1);
    let acts = [...parseClause(head, false), ...parseClause(tail, true)];
    if (/\brepeat\b/.test(head)) acts = [...acts.filter((a) => a.type === 'press' && isReset(a)), ...acts.filter((a) => a.type !== 'press'), { type: 'repeat' }];
    return acts;
  });
  const readSteps = () => {
    const parsed = steps.map(sentencesOf);
    let fallback = [];
    return parsed.map((sentences) => {
      // "Repeat from Reset with ..." presses again what the step pressed before it, Reset aside.
      const pressed = [];
      sentences = sentences.map((acts) => acts.flatMap((a) => {
        if (a.type !== 'repeat') { if (a.type === 'press' && !isReset(a)) pressed.push(a); return [a]; }
        return pressed.slice();
      }));
      const own = sentences.flat().filter((a) => a.type === 'press' && !isReset(a));
      // A step that names no button continues with the last one that did ("Set max unavailable to 2" after "Press Run").
      if (sentences.flat().some((a) => a.type === 'press')) fallback = own.length ? own.map((a) => ({ ...a, times: 1 })) : fallback;
      else sentences = sentences.map((acts) => (acts.some((a) => a.type === 'set') ? [...acts, ...fallback] : acts));
      return sentences.map((acts) => acts.filter((a) => a.type !== 'mention').filter((a, i, list) => !(i && JSON.stringify(a) === JSON.stringify(list[i - 1]))));
    });
  };
  const parsed = readSteps();
  const typed = parsed.flatMap((sentences, k) => sentences.flat().filter((a) => a.type === 'set' && (numeric(all[a.c]) || all[a.c].kind === 'text')).map((a) => ({ step: k, value: a.value, label: all[a.c].label })));
  return { parsed, typed };
}
