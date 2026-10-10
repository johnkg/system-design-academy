// Merging two people's simultaneous edits with operational transformation, in JavaScript:
// each edit is rewritten to account for the other one, so both copies of the text end up identical.

// An operation changes one character: { type: 'ins', pos, ch, site } or { type: 'del', pos, site }. null means "nothing to do".
function apply(text, op) {
  if (!op) return text;
  if (op.type === 'ins') return text.slice(0, op.pos) + op.ch + text.slice(op.pos);
  return text.slice(0, op.pos) + text.slice(op.pos + 1);
}

// Rewrite `a` so it makes the same change after `b` has already been applied.
function transform(a, b) {
  if (!a || !b) return a;
  if (a.type === 'ins' && b.type === 'ins') {
    if (a.pos < b.pos || (a.pos === b.pos && a.site < b.site)) return a; // same spot: the lower site number goes first, so both sides agree
    return { ...a, pos: a.pos + 1 };
  }
  if (a.type === 'ins' && b.type === 'del') return a.pos <= b.pos ? a : { ...a, pos: a.pos - 1 };
  if (a.type === 'del' && b.type === 'ins') return a.pos < b.pos ? a : { ...a, pos: a.pos + 1 };
  if (a.pos < b.pos) return a;       // both delete: before the other one's position, nothing changes
  if (a.pos > b.pos) return { ...a, pos: a.pos - 1 };
  return null;                        // the same character was already deleted by the other edit
}

// A worked example: both people start with "CAT". Alice types X at the very start while Bob deletes the final T.
const start = 'CAT';
const alice = { type: 'ins', pos: 0, ch: 'X', site: 1 };
const bob = { type: 'del', pos: 2, site: 2 };
const aliceSees = apply(apply(start, alice), transform(bob, alice));
const bobSees = apply(apply(start, bob), transform(alice, bob));
const aliceNaive = apply(apply(start, alice), bob); // Bob's edit applied as written: position 2 is no longer the T
const bobNaive = apply(apply(start, bob), alice);
console.log(`start "${start}": Alice types X at the start, Bob deletes the last letter, at the same time`);
console.log(`with transformation: Alice sees "${aliceSees}", Bob sees "${bobSees}"`);
console.log(`without it: Alice sees "${aliceNaive}", Bob sees "${bobNaive}"`);
if (aliceSees !== 'XCA' || bobSees !== 'XCA' || aliceNaive === bobNaive) process.exit(1);

// Try it on 5,000 random pairs of simultaneous edits.
let seed = 99;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const makeOp = (text, site) => (text.length > 0 && random(2) === 0)
  ? { type: 'del', pos: random(text.length), site }
  : { type: 'ins', pos: random(text.length + 1), ch: 'abcdefgh'[random(8)], site };

let converged = 0, diverged = 0;
const TRIALS = 5000;
for (let i = 0; i < TRIALS; i++) {
  const text = Array.from({ length: random(9) }, () => 'ABCDEFGH'[random(8)]).join('');
  const a = makeOp(text, 1), b = makeOp(text, 2);
  const left = apply(apply(text, a), transform(b, a));
  const right = apply(apply(text, b), transform(a, b));
  if (left === right) converged++;
  if (apply(apply(text, a), b) !== apply(apply(text, b), a)) diverged++; // the same edits applied without any rewriting
}
console.log(`with transformation: ${converged} of ${TRIALS} pairs ended with identical text`);
console.log(`without it: ${diverged} of ${TRIALS} pairs ended with different text`);
if (converged !== TRIALS || diverged === 0) process.exit(1);
