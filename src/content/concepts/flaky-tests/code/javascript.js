// Flaky Tests: a 32-test suite run 200 times with a seeded generator, under four ways of dealing with flakiness.
// Look for: how many red builds are false alarms, and how many times the one REAL intermittent bug was hidden by a retry or a quarantine.
// Five suspicious tests: "reader" fails if a "writer" test left shared state just before it (order), "clock" fails near a
// minute boundary, two "sleep" tests wait a fixed time for a job that takes a variable time, and "race" is a genuine bug
// in the code under test that shows up on about 1 attempt in 20. From the outside they all look the same: they fail now and then.
const TESTS = 32, RUNS = 200, WAIT = 18; // WAIT: ticks a fixed sleep waits; a job takes 1 to 20 ticks
const POLICIES = [
  ['No retries, nothing fixed', { retries: 0, quarantine: false, fix: [false, false, false] }],
  ['Retry up to 2 times', { retries: 2, quarantine: false, fix: [false, false, false] }],
  ['Quarantine the flaky tests', { retries: 0, quarantine: true, fix: [false, false, false] }],
  ['Fix the causes, no retries', { retries: 0, quarantine: false, fix: [true, true, true] }],
];

function seeded(seed) { // MINSTD generator: integers only, the product fits in 53 bits
  let s = seed;
  return (n) => { s = (s * 48271) % 2147483647; return s % n; };
}

function simulate(p) {
  const rand = seeded(7), again = seeded(99); // `again` supplies the draws for retries, so the first attempts match across policies
  const [fixState, fixClock, fixPoll] = p.fix;
  const r = { red: 0, falseAlarm: 0, showed: 0, reported: 0, hidden: 0, cost: 0 };
  for (let run = 0; run < RUNS; run++) {
    const w = rand(TESTS), rd0 = rand(TESTS - 1), rd = rd0 >= w ? rd0 + 1 : rd0;
    const jobs = [1 + rand(20), 1 + rand(20)];
    // first attempt of each test; the draws happen whatever the policy, so policies see the same runs
    let order = !fixState && rd > w && rd - w <= 3;
    const tick = rand(60);
    let clock = !fixClock && tick >= 58;
    const sleep = jobs.map((d) => !fixPoll && d > WAIT);
    let race = rand(20) === 0;
    r.cost += TESTS + jobs.reduce((sum, d) => sum + (fixPoll ? d : WAIT), 0);
    if (race) r.showed++;
    for (let attempt = 0; attempt < p.retries; attempt++) { // only failing tests are run again
      if (order) { order = false; r.cost += 1; }             // run alone, the state it tripped on is gone
      if (clock) { clock = !fixClock && again(60) >= 58; r.cost += 1; }
      for (let i = 0; i < 2; i++) if (sleep[i]) { const d = 1 + again(20); sleep[i] = d > WAIT; r.cost += 1 + WAIT; }
      if (race) { race = again(20) === 0; r.cost += 1; }
    }
    if (p.quarantine) { order = false; clock = false; sleep[0] = false; sleep[1] = false; race = false; }
    const failed = order || clock || sleep[0] || sleep[1] || race;
    if (failed) { r.red++; if (!race) r.falseAlarm++; }
    if (race) r.reported++;
  }
  r.hidden = r.showed - r.reported;
  return r;
}

for (const [name, p] of POLICIES) {
  const r = simulate(p);
  console.log(`${name}: red ${r.red}/${RUNS}, false alarms ${r.falseAlarm}, real bug showed ${r.showed}, reported ${r.reported}, hidden ${r.hidden}, cost ${r.cost}`);
}
