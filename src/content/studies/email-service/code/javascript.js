// An outbound mail scheduler in JavaScript:
// one shared queue versus a queue per receiving domain, with retries, suppression of hard bounces and a sender reputation.

const DOMAINS = [ // share of the list, messages the domain accepts per minute, percent of addresses that do not exist, percent of attempts deferred
  { name: 'gmail.com', weight: 50, limit: 30, hard: 3, soft: 5 },
  { name: 'yahoo.com', weight: 25, limit: 20, hard: 4, soft: 5 },
  { name: 'corp.example', weight: 15, limit: 5, hard: 2, soft: 10 },
  { name: 'tiny.org', weight: 10, limit: 3, hard: 5, soft: 5 },
];
const mix = (id) => Math.imul(id, 2654435761) >>> 16;
const domainOf = (id) => { let r = mix(id) % 100; for (let d = 0; d < DOMAINS.length; d++) { if (r < DOMAINS[d].weight) return d; r -= DOMAINS[d].weight; } return 0; };
const exists = (id) => (mix(id + 7919) % 100) >= DOMAINS[domainOf(id)].hard; // fixed per address, so a bad address always bounces

function run(mode, ids, suppressed, startRep = 1000) {
  let seed = 99;
  const roll = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % 100; };
  const msgs = ids.filter((id) => !suppressed.has(id)).map((id) => ({ id, d: domainOf(id), tries: 0, next: 0, done: false }));
  const s = { sent: msgs.length, skipped: ids.length - msgs.length, delivered: 0, hard: 0, expired: 0, throttled: 0, blocked: 0, deferred: 0, minutes: 0, overLimit: 0 };
  let rep = startRep; // reputation in tenths of a point; it falls fast and recovers slowly, so inside one send it only falls
  let pending = msgs.length;
  const fail = (m, minute) => { m.tries++; if (m.tries >= 5) { m.done = true; pending--; s.expired++; } else m.next = minute + (1 << m.tries); }; // wait 2, 4, 8, 16 minutes
  for (let minute = 0; pending > 0 && minute < 400; minute++) {
    s.minutes = minute + 1;
    const used = DOMAINS.map(() => 0);
    let budget = Math.min(60, 12 + minute); // the new IP is warmed up: its minute budget grows every minute
    const attempt = (m) => {
      used[m.d]++;
      if (used[m.d] > DOMAINS[m.d].limit) { s.throttled++; rep -= 10; fail(m, minute); } // 421: slow down
      else if (rep < 600) { s.blocked++; fail(m, minute); }                               // 550: we are on a blocklist
      else if (!exists(m.id)) { s.hard++; rep -= 10; suppressed.add(m.id); m.done = true; pending--; }
      else if (roll() < DOMAINS[m.d].soft) { s.deferred++; fail(m, minute); }             // 451: try again later
      else { s.delivered++; m.done = true; pending--; }
    };
    const ready = msgs.filter((m) => !m.done && m.next <= minute);
    if (mode === 'shared') {
      for (const m of ready) { if (budget-- <= 0) break; attempt(m); }
    } else {
      const queues = DOMAINS.map((_, d) => ready.filter((m) => m.d === d));
      for (let progress = true; budget > 0 && progress;) {
        progress = false;
        for (let d = 0; d < DOMAINS.length && budget > 0; d++) {
          if (used[d] < DOMAINS[d].limit && queues[d].length) { attempt(queues[d].shift()); budget--; progress = true; }
        }
      }
    }
    DOMAINS.forEach((dm, d) => { if (mode === 'perDomain' && used[d] > dm.limit) s.overLimit++; });
  }
  return { ...s, reputation: rep / 10 };
}

const ids = Array.from({ length: 600 }, (_, i) => i);
const show = (label, r) => console.log(`${label}: delivered ${r.delivered}, hard bounces ${r.hard}, gave up ${r.expired}, 421 throttled ${r.throttled}, 550 blocked ${r.blocked}, 451 deferred ${r.deferred}, skipped ${r.skipped}, reputation ${r.reputation}, ${r.minutes} min`);
const shared = run('shared', ids, new Set());
const per = run('perDomain', ids, new Set());
show('shared queue    ', shared);
show('queue per domain', per);

const list = new Set();
const first = run('perDomain', ids, list); // the hard bounces of this send fill the suppression list, and the second send starts with this send's reputation
const again = run('perDomain', ids, new Set(list), first.reputation * 10);
const noList = run('perDomain', ids, new Set(), first.reputation * 10);
show('second send with suppression', again);
show('second send without it      ', noList);

const total = (r) => r.delivered + r.hard + r.expired;
const ok = total(shared) + shared.skipped === 600 && total(per) + per.skipped === 600 && per.throttled === 0 && per.overLimit === 0 && shared.throttled > 0
  && again.hard === 0 && again.skipped === first.hard && noList.blocked > 0 && again.delivered > noList.delivered && again.reputation > noList.reputation && per.reputation > shared.reputation;
console.log(`invariants hold: ${ok}`);
if (!ok) process.exit(1);
