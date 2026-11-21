// A host application that calls third-party plugins while it serves requests, with and without isolation. Time moves in
// ticks of 100 ms for 300 seconds. 20 requests arrive each second, and each one is handled by the host and then by one
// of 5 plugins in turn. At 60 s an update makes plugin 3 misbehave. Everything is integers and nothing is random, so
// the output never changes. Plugin calls run either inside the host's own workers or in a sandbox per plugin.
const TICKS = 3000, ARRIVE_UNTIL = 2900, ARRIVE = 2;   // 2 requests a tick = 20 a second; the last 10 s is for finishing
const WORKERS = 40;            // host workers, shared by everything in the host process
const HOST = 2;                // ticks of the host's own work on each request
const PLUGINS = 5, BAD = 3, BAD_AT = 600; // plugin 3 misbehaves from tick 600
const NORMAL = 3, SLOW = 15, SLOW_EVERY = 25; // a plugin call takes 300 ms, and every 25th one (a big document) takes 1,500 ms
const POOL = 4;                // sandbox: calls to one plugin that may run at once (its resource limit)
const BREAK_AFTER = 5, BREAK_FOR = 600; // sandbox: 5 failures in a row switch a plugin off for 60 s
const RESTART = 300;           // in-process: a crash takes the whole host down for 30 s
const SNOOP = 50;              // records a snooping plugin reads outside its grant on every call
const PATIENCE = 100;          // a user gives up after waiting 10 s in the queue
const HANG = 1000000, CRASH = -1;

function run(name, { sandbox, bad, timeout }) {
  let nextId = 0, downUntil = 0, restarts = 0, leaked = 0, denied = 0, badFailed = 0;
  let queue = [], running = [];
  const calls = Array(PLUGINS).fill(0), used = Array(PLUGINS).fill(0), streak = Array(PLUGINS).fill(0), offUntil = Array(PLUGINS).fill(0);
  const latency = new Map(); // ticks from arrival to answer -> requests
  let served = 0, fast = 0, healthyTotal = 0, healthyFailed = 0;

  // One request is finished: answered (maybe without its plugin) or dropped.
  function finish(r, t, pluginOk, dropped) {
    if (r.plugin !== BAD) { healthyTotal++; if (dropped || !pluginOk) healthyFailed++; }
    if (dropped) return;
    served++;
    const d = t - r.arrived;
    latency.set(d, (latency.get(d) ?? 0) + 1);
    if (d <= 10) fast++;
  }
  // How long this call to a plugin takes: the update at BAD_AT makes plugin 3 hang, crash or snoop.
  function callTicks(plugin, t) {
    const n = calls[plugin]++;
    if (plugin === BAD && bad !== 'none' && t >= BAD_AT) {
      if (bad === 'hang') return HANG;
      if (bad === 'crash') return CRASH;
      if (sandbox) denied += SNOOP; else leaked += SNOOP; // snoop: works normally, and reads what it should not
      return NORMAL;
    }
    return n % SLOW_EVERY === SLOW_EVERY - 1 ? SLOW : NORMAL;
  }
  function failed(plugin, t) {
    if (plugin === BAD) badFailed++;
    if (++streak[plugin] >= BREAK_AFTER) offUntil[plugin] = t + BREAK_FOR;
  }

  for (let t = 0; t < TICKS; t++) {
    const arrivals = t < ARRIVE_UNTIL ? ARRIVE : 0;
    if (!sandbox && t < downUntil) { // the host is restarting: nobody is served
      for (let i = 0; i < arrivals; i++) finish({ plugin: nextId++ % PLUGINS, arrived: t }, t, false, true);
      continue;
    }
    const due = running.filter((x) => x.end === t);
    running = running.filter((x) => x.end !== t);
    for (const x of due) {
      const p = x.r.plugin;
      if (!sandbox) finish(x.r, t, x.ok, false);
      else if (x.stage === 'plugin') { // the sandboxed call is over
        used[p]--;
        if (x.ok) streak[p] = 0; else failed(p, t);
        finish(x.r, t, x.ok, false);
      } else if (t < offUntil[p] || used[p] >= POOL) { // switched off or at its limit: the host goes on without it
        if (p === BAD) badFailed++;
        finish(x.r, t, false, false);
      } else {
        const d = callTicks(p, t);
        if (d === CRASH) { failed(p, t); finish(x.r, t, false, false); } // only the sandbox dies, and restarts
        else { used[p]++; running.push({ r: x.r, end: t + Math.min(d, timeout), stage: 'plugin', ok: d <= timeout }); }
      }
    }
    for (let i = 0; i < arrivals; i++) queue.push({ plugin: nextId++ % PLUGINS, arrived: t });
    while (queue.length > 0 && t - queue[0].arrived > PATIENCE) finish(queue.shift(), t, false, true);
    let busy = running.filter((x) => x.stage !== 'plugin').length;
    while (queue.length > 0 && busy < WORKERS) {
      const r = queue.shift();
      busy++;
      if (sandbox) { running.push({ r, end: t + HOST, stage: 'host' }); continue; }
      const d = callTicks(r.plugin, t);
      if (d === CRASH) { // the plugin brings the whole host process down, and everything in flight with it
        restarts++; downUntil = t + RESTART;
        finish(r, t, false, true);
        for (const x of running) finish(x.r, t, false, true);
        running = [];
        for (const q of queue) finish(q, t, false, true);
        queue = [];
        break;
      }
      if (r.plugin === BAD && d > timeout) badFailed++;
      running.push({ r, end: t + HOST + Math.min(d, timeout), ok: d <= timeout });
    }
  }
  for (const r of queue) finish(r, TICKS, false, true);   // never reached by the end
  for (const x of running) finish(x.r, TICKS, false, true);

  const total = ARRIVE_UNTIL * ARRIVE;
  let seen = 0, p95 = 0;
  for (const d of [...latency.keys()].sort((a, b) => a - b)) {
    seen += latency.get(d);
    if (seen * 100 >= served * 95) { p95 = d * 100; break; }
  }
  console.log(`-- ${name}`);
  console.log(`  requests served ${Math.floor((served * 100) / total)}%, answered within 1 s ${Math.floor((fast * 100) / total)}%, p95 latency ${p95} ms`);
  console.log(`  requests for the 4 healthy plugins: ${healthyFailed} of ${healthyTotal} dropped or without their plugin; the misbehaving plugin: ${badFailed} calls failed or refused`);
  console.log(`  host restarts ${restarts}; records read outside the grant ${leaked}, blocked ${denied}`);
  if (served > total) throw new Error('more answers than requests');
}

const base = { sandbox: false, bad: 'none', timeout: 20 };
run('in the host process, all plugins healthy, 2 s timeout', base);
run('in the host process, plugin hangs, 2 s timeout', { ...base, bad: 'hang' });
run('in the host process, plugin hangs, 60 s timeout', { ...base, bad: 'hang', timeout: 600 });
run('in the host process, plugin crashes', { ...base, bad: 'crash' });
run('in the host process, plugin snoops', { ...base, bad: 'snoop' });
run('sandbox per plugin, plugin hangs, 60 s timeout', { ...base, sandbox: true, bad: 'hang', timeout: 600 });
run('sandbox per plugin, plugin crashes', { ...base, sandbox: true, bad: 'crash' });
run('sandbox per plugin, plugin snoops', { ...base, sandbox: true, bad: 'snoop' });
run('sandbox per plugin, all healthy, 1 s timeout', { ...base, sandbox: true, timeout: 10 });
