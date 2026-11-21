// Property-Based Testing and Fuzzing: a run-length encoder with a bug that only appears for runs of 10 or more equal characters.
// Look for: hand-written examples all pass; generated inputs find the bug only if the generator can produce long runs;
// a weak property never fails; and shrinking turns a failing input of 13 to 19 characters into the smallest one that still fails.
function encode(s) { // "aaab" -> "3a1b". BUG: a run of 10 or more is written as run % 10, so 10 a's become "0a"
  let out = '', i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += ((j - i) % 10) + s[i];
    i = j;
  }
  return out;
}
function decode(e) {
  let out = '', i = 0;
  while (i < e.length) {
    let n = 0;
    while (e[i] >= '0' && e[i] <= '9') { n = n * 10 + (e.charCodeAt(i) - 48); i++; }
    for (let k = 0; k < n; k++) out += e[i];
    i++;
  }
  return out;
}
const EXAMPLES = ['', 'a', 'aaabcc', 'abab', 'zzzzzzzzz']; // the longest run is 9: the bug is out of sight
const PROPERTIES = [
  ['round trip: decode(encode(s)) equals s', (s) => decode(encode(s)) === s],
  ['weak: encode(s) is not empty when s is not', (s) => s.length === 0 || encode(s).length > 0],
];
const ALPHABETS = ['abcdefghijklmnopqrstuvwxyz', 'ab'];
const GENERATORS = [ // [name, makes one random string from a random-number function]
  ['letters a to z, uniform', (rand) => { let s = ''; for (let n = rand(21); n > 0; n--) s += ALPHABETS[0][rand(26)]; return s; }],
  ['letters a and b, uniform', (rand) => { let s = ''; for (let n = rand(21); n > 0; n--) s += ALPHABETS[1][rand(2)]; return s; }],
  ['biased toward repeats', (rand) => { let s = ''; for (let n = rand(21); n > 0; n--) s += s.length > 0 && rand(10) < 8 ? s[s.length - 1] : 'abc'[rand(3)]; return s; }],
];

function seeded(seed) { // MINSTD generator: integers only, the product fits in 53 bits
  let s = seed;
  return (n) => { s = (s * 48271) % 2147483647; return s % n; };
}
function shrink(s, prop) { // keep deleting one character while the property still fails
  let steps = 0, again = true;
  while (again) {
    again = false;
    for (let i = 0; i < s.length; i++) {
      const smaller = s.slice(0, i) + s.slice(i + 1);
      if (!prop(smaller)) { s = smaller; steps++; again = true; break; }
    }
  }
  return [s, steps];
}
function search(gen, prop, seed, cases) {
  const rand = seeded(seed);
  for (let c = 1; c <= cases; c++) {
    const s = gen(rand);
    if (!prop(s)) { const [small, steps] = shrink(s, prop); return { found: c, size: s.length, small, steps }; }
  }
  return null;
}

console.log(`examples passing: ${EXAMPLES.filter((s) => PROPERTIES[0][1](s)).length}/${EXAMPLES.length}`);
for (const [pname, prop] of PROPERTIES) {
  for (const [gname, gen] of GENERATORS) {
    for (const seed of [101, 202, 303]) {
      const r = search(gen, prop, seed, 1000);
      console.log(`${pname} | ${gname} | seed ${seed}: ${r ? `failed at case ${r.found} (${r.size} chars), shrunk to ${r.small.length} chars "${r.small}" in ${r.steps} steps` : 'no failure in 1000 cases'}`);
    }
  }
}
const first = search(GENERATORS[2][1], PROPERTIES[0][1], 101, 1000), again = search(GENERATORS[2][1], PROPERTIES[0][1], 101, 1000);
console.log(`replay seed 101: same failing case again: ${first.found === again.found && first.small === again.small}`);
