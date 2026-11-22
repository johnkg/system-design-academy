// Fail fast and error handling strategies. Part 1 parses the same five inputs with three error styles (an exception, a result value
// the caller must look at, and an error code the caller can forget). Part 2 runs a batch job over 100 records under five
// strategies: swallow and continue, fail fast, retry then fail fast, dead-letter and continue, and retry everything blindly.
// Some records are permanently bad (data errors), some fail a few times and then work (transient errors); in the last scenario
// each record builds on the one before, so continuing past a failure poisons what follows. Look for: the error
// code giving a wrong sum without a sound, which strategies leave wrong data behind, and how much work blind retry wastes.
const INPUTS = ["12", "7", "x9", "", "40"];
const isNumber = (t) => /^[0-9]+$/.test(t);

class ParseError extends Error {}

const parseExc = (text) => { // style 1: raise
  if (!isNumber(text)) throw new ParseError(`bad number '${text}'`);
  return parseInt(text, 10);
};
const parseResult = (text) => // style 2: return [ok, value or message]; the caller has to open it
  isNumber(text) ? [true, parseInt(text, 10)] : [false, `bad number '${text}'`];
const parseCode = (text) => (isNumber(text) ? parseInt(text, 10) : -1); // style 3: -1 means failure, and nothing makes the caller check

let total = 0, k = 0;
try {
  for (k = 1; k <= INPUTS.length; k++) total += parseExc(INPUTS[k - 1]);
} catch (e) {
  console.log(`exception: stopped at item ${k}: ${e.message}, partial sum ${total}`);
}
let oks = 0;
const errs = [];
INPUTS.forEach((t, i) => {
  const [ok, v] = parseResult(t);
  if (ok) oks += v; else errs.push(i + 1);
});
console.log(`result values: sum ${oks}, errors at items ${errs.join(", ")}`);
console.log(`error codes, never checked: sum ${INPUTS.reduce((a, t) => a + parseCode(t), 0)}, nothing flagged`);

// Part 2. 100 records. Record i is permanently bad if (i*37) % 100 < bad%, else it fails its first f attempts (f = 1 + i*7 % 3)
// if (i*53 + 11) % 100 < transient%, and works after that. 37 and 53 are coprime with 100, so the shares are exact.
class Bad extends Error {}
class Transient extends Error {}

function work(i, attempt, bad, trans) {
  if ((i * 37) % 100 < bad) throw new Bad();
  if ((i * 53 + 11) % 100 < trans && attempt <= 1 + ((i * 7) % 3)) throw new Transient();
}

function run(strategy, bad, trans, retries, dependent) {
  let attempts = 0, correct = 0, wrong = 0, parked = 0, unprocessed = 0, noticed = 0;
  let aborted = false, broken = false;
  const allowed = ["retry", "deadletter", "blind"].includes(strategy) ? retries : 0;
  for (let i = 1; i <= 100; i++) {
    if (aborted) { unprocessed++; continue; }
    let failed = true, attempt = 1;
    while (attempt <= 1 + allowed) {
      attempts++;
      try {
        work(i, attempt, bad, trans);
        failed = false;
        break;
      } catch (e) {
        if (e instanceof Bad && strategy !== "blind") break; // a data error will not fix itself: only blind retry tries again
      }
      attempt++;
    }
    if (!failed) {
      if (dependent && broken) wrong++; // computed on top of a record that was skipped or faked
      else correct++;
    } else if (strategy === "swallow") {
      wrong++; // caught, ignored, a default value saved
      broken = true;
    } else if (strategy === "failfast" || strategy === "retry") {
      aborted = true; unprocessed++; noticed = i;
    } else {
      parked++;
      broken = true;
      noticed = noticed || i;
    }
  }
  return [correct, wrong, parked, unprocessed, attempts, noticed];
}

const STRATEGIES = [["swallow", "swallow and continue"], ["failfast", "fail fast"], ["retry", "retry, then fail fast"],
  ["deadletter", "dead-letter and continue"], ["blind", "retry everything"]];
for (const [bad, trans, retries, dep] of [[0, 20, 3, false], [10, 0, 3, false], [10, 10, 3, false], [10, 10, 3, true]]) {
  console.log(`bad ${bad}%, transient ${trans}%, retries ${retries}, later records depend on earlier ones: ${dep}`);
  for (const [key, label] of STRATEGIES) {
    const [c, w, p, u, a, nt] = run(key, bad, trans, retries, dep);
    console.log(`  ${label}: correct ${c}, wrong ${w}, parked ${p}, not processed ${u}, attempts ${a}, noticed at ${nt ? nt : "never"}`);
  }
}
