// A durable agent loop, in JavaScript:
// every step is recorded in a log, tool calls carry an idempotency key, risky tools wait for approval, and budgets stop runaway runs.

const TOOLS = {
  search: { risky: false, cost: 120 },
  calc: { risky: false, cost: 60 },
  deploy: { risky: true, cost: 200 },
};

// The outside world: it counts how many times each tool really ran, and remembers the keys it has seen.
class World {
  constructor() { this.effects = { search: 0, calc: 0, deploy: 0 }; this.seen = new Map(); }
  call(act, key) {
    if (key !== null && this.seen.has(key)) return this.seen.get(key); // a repeat of the same call: return the saved result, do nothing
    this.effects[act.tool]++;
    const result = `${act.tool}(${act.arg}) ok`;
    if (key !== null) this.seen.set(key, result);
    return result;
  }
}

// A stand-in for the model: it decides the next action from the step number. The real action is saved in the log.
const POLICIES = {
  good: (i) => [{ tool: 'search', arg: 'pricing' }, { tool: 'search', arg: 'volume' }, { tool: 'calc', arg: '40+2' }, { tool: 'deploy', arg: 'v7' }, { tool: 'finish', arg: '' }][i],
  stuck: () => ({ tool: 'search', arg: 'pricing' }),
  long: (i) => ({ tool: 'search', arg: `q${i}` }),
};

const tokensUsed = (log) => log.reduce((sum, r) => sum + r.cost, 0);

function runAgent(o) {
  for (let i = 0; ; i++) {
    if (tokensUsed(o.log) >= o.budget) return 'budget';
    if (i >= o.maxSteps) return 'max-steps';
    const rec = o.log[i];
    if (rec) { if (rec.act.tool === 'finish') return 'done'; continue; } // already done before a crash: skip it, do not run it again
    const act = POLICIES[o.policy](i);
    if (act.tool === 'finish') { o.log.push({ act, result: 'done', cost: 50 }); return 'done'; }
    const n = o.log.length;
    if (n >= 2 && [o.log[n - 1], o.log[n - 2]].every((r) => r.act.tool === act.tool && r.act.arg === act.arg)) return 'loop';
    if (TOOLS[act.tool].risky && !o.approve(act)) return 'denied';
    const result = o.world.call(act, o.useKeys ? `${o.name}:${i}` : null);
    if (o.crashAt === i) throw new Error('crash'); // the tool ran, but the step was not yet written to the log
    o.log.push({ act, result, cost: TOOLS[act.tool].cost });
  }
}

function scenario(name, opts) {
  const world = new World(), log = [];
  const o = { name, world, log, maxSteps: 10, budget: 1000, approve: () => true, useKeys: true, crashAt: -1, ...opts };
  let status, resumed = 'no';
  try { status = runAgent(o); }
  catch (e) { resumed = 'yes'; status = runAgent({ ...o, crashAt: -1 }); } // a new worker picks up the same log
  const w = world.effects;
  console.log(`${name}: ${status}, steps ${log.length}, tokens ${tokensUsed(log)}, resumed ${resumed}, ran search ${w.search} calc ${w.calc} deploy ${w.deploy}`);
  return { status, log, w };
}

const a = scenario('crash-with-keys', { policy: 'good', crashAt: 3 });
const b = scenario('crash-no-keys', { policy: 'good', crashAt: 3, useKeys: false });
const c = scenario('denied', { policy: 'good', approve: () => false });
const d = scenario('stuck', { policy: 'stuck' });
const e = scenario('long', { policy: 'long', budget: 500 });

const ok = a.status === 'done' && a.w.deploy === 1 && a.log.length === 5 && b.w.deploy === 2
  && c.status === 'denied' && c.w.deploy === 0 && d.status === 'loop' && d.log.length === 2 && e.status === 'budget' && e.log.length === 5;
console.log(`invariants hold: ${ok}`);
if (!ok) process.exit(1);
