// A tiny pipeline orchestrator in JavaScript: a DAG of tasks run once per day (the data interval),
// a sensor that waits for a file, retries with backoff, and a backfill that is safe to repeat.

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };

// Tasks in dependency order: [name, upstream tasks].
const TASKS = [['wait_file', []], ['extract', ['wait_file']], ['clean', ['extract']], ['by_region', ['clean']], ['by_product', ['clean']], ['report', ['by_region', 'by_product']]];
const POKE = 10, TIMEOUT = 30, MAX_ATTEMPTS = 3; // sensor checks every 10 minutes and gives up after 30
const FLAKY_ONE_IN = 5; // one task-day in 5 is flaky
const BACKOFF_MIN = 30; // retry backoff in minutes: 30, then 60
const flaky = (task, day) => hash(`${task}:${day}`) % FLAKY_ONE_IN === 0; // fails its first two attempts, then works

class Orchestrator {
  constructor() { this.state = new Map(); this.output = new Map(); this.stats = {}; }

  runTask(task, deps, day, arrival) {
    const key = `${task}/${day}`, s = this.stats;
    if (task === 'wait_file') { // sensor: poke until the file has landed or the timeout passes
      const late = arrival[day] > TIMEOUT;
      s.pokes += late ? TIMEOUT / POKE : Math.max(1, Math.ceil(arrival[day] / POKE));
      if (late) return 'timeout';
      this.output.set(key, hash(`file:${day}`));
      return 'success';
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (flaky(task, day) && attempt < MAX_ATTEMPTS) { s.retries++; s.backoff += BACKOFF_MIN * 2 ** (attempt - 1); continue; }
      const inputs = deps.map((d) => this.output.get(`${d}/${day}`));
      this.output.set(key, hash(`${task}:${day}:${inputs.join(',')}`)); // overwrite the partition, never append
      return 'success';
    }
    return 'failed';
  }

  backfill(days, arrival) {
    this.stats = { ran: 0, skipped: 0, failed: 0, blocked: 0, retries: 0, backoff: 0, pokes: 0 };
    for (const day of days) {
      for (const [task, deps] of TASKS) {
        const key = `${task}/${day}`;
        if (this.state.get(key) === 'success') { this.stats.skipped++; continue; }
        if (deps.some((d) => this.state.get(`${d}/${day}`) !== 'success')) { this.state.set(key, 'upstream_failed'); this.stats.blocked++; continue; }
        const result = this.runTask(task, deps, day, arrival);
        this.state.set(key, result); this.stats.ran++;
        if (result !== 'success') this.stats.failed++;
      }
    }
    const x = this.stats;
    return `ran ${x.ran}, skipped ${x.skipped}, failed ${x.failed}, blocked ${x.blocked}, retries ${x.retries}, backoff ${x.backoff}s, pokes ${x.pokes}`;
  }

  checksum() { return [...this.output].sort(([a], [b]) => (a < b ? -1 : 1)).reduce((acc, [k, v]) => hash(`${acc}:${k}=${v}`), 0); }
}

const days = [1, 2, 3, 4, 5, 6];
const arrival = { 1: 5, 2: 12, 3: 28, 4: 45, 5: 8, 6: 20 }; // minutes after midnight that each day's file lands
const run = new Orchestrator();
console.log('backfill 1:', run.backfill(days, arrival));
console.log('day 4 is', run.state.get('wait_file/4'), 'and report/4 is', run.state.get('report/4'));
arrival[4] = 3; // the late file has now landed
console.log('backfill 2:', run.backfill(days, arrival));
const sum = run.checksum();
console.log('backfill 3:', run.backfill(days, arrival));
for (const t of ['clean', 'by_region', 'by_product', 'report']) run.state.delete(`${t}/2`); // clear day 2 from clean onward
console.log('rerun day 2:', run.backfill(days, arrival));
console.log(`checksum ${sum}, unchanged after reruns: ${run.checksum() === sum}`);

const fresh = new Orchestrator();
fresh.backfill(days, arrival);
console.log(`a fresh run from scratch gives the same checksum: ${fresh.checksum() === sum}`);
if (run.checksum() !== sum || fresh.checksum() !== sum || run.stats.ran !== 4 || fresh.stats.failed !== 0) process.exit(1);
