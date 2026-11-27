// A code assistant's two core pieces in JavaScript: debouncing with cancellation, and a context ranker.
// Times are in milliseconds and the model's delay is fixed, so the output is the same on every run.
const KEYS = [0, 100, 200, 300, 700, 1500]; // when the developer presses a key
const DEBOUNCE = 250, LATENCY = 400;        // wait for a pause this long, then the model needs this long

const events = [];
KEYS.forEach((t, i) => {
  const nextKey = i + 1 < KEYS.length ? KEYS[i + 1] : Infinity;
  const fire = t + DEBOUNCE;
  if (nextKey < fire) return; // typing went on before the pause was long enough: no request
  events.push([fire, `request fired (after key at ${t})`]);
  const done = fire + LATENCY;
  if (nextKey < done) events.push([nextKey, "key: request cancelled"]); // a newer key cancels the request in flight
  else events.push([done, "answer shown"]);
});
for (const [time, text] of events.sort((a, b) => a[0] - b[0])) console.log(`t=${time} ${text}`);

// Context: take pieces in priority order, skip any that do not fit in the token budget.
const BUDGET = 1000;
const PIECES = [ // [name, tokens, priority]
  ["current file, before cursor", 400, 100],
  ["current file, after cursor", 150, 90],
  ["symbol definition: parse_order", 120, 80],
  ["recent edit: models.py", 250, 70],
  ["open tab: utils.py", 300, 60],
  ["similar code: legacy/orders.py", 500, 40],
  ["README.md", 600, 10],
];
console.log(`budget ${BUDGET} tokens`);
let used = 0;
for (const [name, tokens] of [...PIECES].sort((a, b) => b[2] - a[2])) {
  if (used + tokens <= BUDGET) {
    used += tokens;
    console.log(`+ ${name} (${tokens})`);
  } else {
    console.log(`- skipped ${name} (${tokens}), over budget`);
  }
}
console.log(`used ${used} of ${BUDGET} tokens`);
