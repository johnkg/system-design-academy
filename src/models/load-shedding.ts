// The load-shedding simulation, kept apart from the page so plain Node can import it in unit tests.
// One step is 100 ms; the playground draws the per-second series this returns.

export type Policy = 'fifo' | 'bounded' | 'adaptive' | 'lifo' | 'priority';
export type Retry = 'none' | 'naive' | 'backoff';
export interface Params { policy: Policy; mult: number; spikeLen: number; timeoutSec: number; retry: Retry; deadline: boolean; limit: number; rejectPct: number }
interface Sec { offered: number; good: number; rejected: number; wasted: number; served: number; latSum: number; crit: number; critOffered: number; queue: number }
interface Attempt { lid: number; cls: number; tries: number; start: number; state: string }
interface Retried { lid: number; cls: number; tries: number }
export interface Sim { S: Sec[]; rec: number | null; skipped: number }
const STEP_MS = 100; // one simulation step
const PER_SEC = 10; // steps per second
const CAP_MU = 1000; // work units the server completes per second
const REQ_MU = 100; // work units one request costs
export const N_SEC = 120; // simulated seconds
export const SPIKE_AT = 10; // second the traffic spike starts
export const BASE = 60; // requests per second in normal times
export const CAPACITY = 100; // requests per second the server can really finish
const AD_TARGET_MS = 300; const AD_START = 100;
const AD = { min: 5, cut: 0.7, max: 1000, step: 2 }; // adaptive limit: multiply by 0.7 on a latency breach, add 2 under pressure, within 5..1000
const MAX_TRIES = 3; // first attempt plus two retries
const BACKOFF = { firstSec: 0.5, jitterMin: 0.5 }; // exponential backoff from 0.5 s, times a jitter of 0.5..1.5
const JITTER_SLOTS = 1000;
const EPS = 1e-9; // keeps floor() from losing an arrival to rounding
const CRITICAL_EVERY = 5; // one request in five is critical
const RECOVERED = 0.95; // good throughput back at 95% of normal

export function simulate(p: Params): Sim {
  const T = Math.round(p.timeoutSec * PER_SEC); const steps = N_SEC * PER_SEC;
  const spikeStart = SPIKE_AT * PER_SEC; const spikeEnd = (SPIKE_AT + p.spikeLen) * PER_SEC;
  const rejectMu = Math.round((REQ_MU * p.rejectPct) / 100);
  const maxTries = p.retry === 'none' ? 1 : MAX_TRIES;
  const qs = [{ a: [] as Attempt[], h: 0 }, { a: [] as Attempt[], h: 0 }]; // 0 critical, 1 everyone else
  const len = (k: number) => qs[k].a.length - qs[k].h; const total = () => len(0) + len(1);
  const due = new Map<number, Retried[]>(); const dl = new Map<number, Attempt[]>();
  const add = <V,>(m: Map<number, V[]>, k: number, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  let acc = 0; let nextId = 0; let debt = 0; let adLimit = AD_START; let winBreach = false; let winPressure = false; let skipped = 0;
  const S: Sec[] = Array.from({ length: N_SEC }, () => ({ offered: 0, good: 0, rejected: 0, wasted: 0, served: 0, latSum: 0, crit: 0, critOffered: 0, queue: 0 }));
  const fail = (a: Attempt, i: number, why: string) => { // the client learns at step i that this attempt failed
    a.state = why;
    if (a.tries < maxTries) {
      const jit = (((a.lid * 2654435761) >>> 0) % JITTER_SLOTS) / JITTER_SLOTS; // Knuth multiplicative hash of the request id
      const d = p.retry === 'naive' ? 1 : Math.max(1, Math.round(PER_SEC * BACKOFF.firstSec * 2 ** (a.tries - 1) * (BACKOFF.jitterMin + jit)));
      add(due, i + d, { lid: a.lid, cls: a.cls, tries: a.tries + 1 });
    }
  };
  for (let i = 0; i < steps; i++) {
    const s = S[Math.floor(i / PER_SEC)];
    for (const a of dl.get(i) ?? []) if (a.state === 'wait') fail(a, i, 'timeout');
    dl.delete(i);
    const rate = i >= spikeStart && i < spikeEnd ? CAPACITY * p.mult : BASE;
    acc += rate / PER_SEC; const n = Math.floor(acc + EPS); acc -= n;
    const arr: Retried[] = [];
    for (let k = 0; k < n; k++) { const lid = nextId++; arr.push({ lid, cls: lid % CRITICAL_EVERY === 0 ? 0 : 1, tries: 1 }); }
    for (const r of due.get(i) ?? []) arr.push(r);
    due.delete(i);
    let budget = CAP_MU + debt;
    for (const r of arr) {
      const a: Attempt = { lid: r.lid, cls: r.cls, tries: r.tries, start: i, state: 'wait' };
      s.offered++; if (a.cls === 0) s.critOffered++;
      const qlen = total(); let admit = true;
      if (p.policy === 'bounded') admit = qlen < p.limit;
      else if (p.policy === 'adaptive') admit = qlen < adLimit;
      else if (p.policy === 'priority') admit = a.cls === 0 ? qlen < p.limit : qlen < Math.floor(p.limit / 2);
      else if (p.policy === 'lifo' && qlen >= p.limit) { // full: drop the oldest, who is least likely to still be waiting
        const q = qs[1]; const old = q.a[q.h++];
        if (old.state === 'wait') { s.rejected++; budget -= rejectMu; fail(old, i, 'rejected'); }
      }
      if (!admit) { s.rejected++; budget -= rejectMu; fail(a, i, 'rejected'); winPressure = true; }
      else { qs[p.policy === 'priority' ? a.cls : 1].a.push(a); add(dl, i + T, a); }
    }
    while (budget >= REQ_MU) {
      const q = p.policy === 'priority' && len(0) > 0 ? qs[0] : len(1) > 0 ? qs[1] : null;
      if (!q) break;
      const a = (p.policy === 'lifo' ? q.a.pop() : q.a[q.h++]) as Attempt; // LIFO serves the newest
      if (p.deadline && i - a.start >= T) { skipped++; continue; } // caller gone: skip at no cost
      budget -= REQ_MU; s.served++;
      const lat = i - a.start + 1; if ((lat - 1) * STEP_MS > AD_TARGET_MS) winBreach = true;
      if (lat <= T && a.state === 'wait') { a.state = 'ok'; s.good++; s.latSum += lat * STEP_MS; if (a.cls === 0) s.crit++; }
      else s.wasted++; // done for a caller that already timed out
    }
    debt = Math.min(0, budget);
    if (p.policy === 'adaptive' && (i + 1) % PER_SEC === 0) {
      if (winBreach) adLimit = Math.max(AD.min, Math.floor(Math.min(adLimit, total() + 1) * AD.cut));
      else if (winPressure || total() > adLimit / 2) adLimit = Math.min(AD.max, adLimit + AD.step);
      winBreach = false; winPressure = false;
    }
    if ((i + 1) % PER_SEC === 0) s.queue = total();
  }
  let rec: number | null = null; const end = SPIKE_AT + p.spikeLen;
  for (let t = end; t + 2 < N_SEC; t++) if (S[t].good >= BASE * RECOVERED && S[t + 1].good >= BASE * RECOVERED && S[t + 2].good >= BASE * RECOVERED) { /* three good seconds in a row */ rec = t - end; break; }
  return { S, rec, skipped };
}

// Totals over the first `upto` seconds; the spike window is clipped to what has been shown.
export function summarise(r: Sim, p: Params, upto: number) {
  const a = SPIKE_AT; const b = Math.min(upto, SPIKE_AT + p.spikeLen); const span = Math.max(0, b - a);
  let good = 0; let lat = 0; let offered = 0; let spikeServed = 0; let spikeRej = 0; let wasted = 0; let rejected = 0; let served = 0; let crit = 0; let critOff = 0; let peakQ = 0;
  for (let t = 0; t < upto; t++) {
    const s = r.S[t]; wasted += s.wasted; rejected += s.rejected; served += s.served; peakQ = Math.max(peakQ, s.queue);
    if (t >= a && t < b) { crit += s.crit; critOff += s.critOffered; good += s.good; lat += s.latSum; offered += s.offered; spikeServed += s.served; spikeRej += s.rejected; }
  }
  const rejectMu = (REQ_MU * p.rejectPct) / 100;
  const busy = span > 0 ? Math.min(1, (spikeServed * REQ_MU + spikeRej * rejectMu) / (span * CAP_MU)) : 0;
  return { span, goodRate: span ? good / span : 0, latMs: good ? lat / good : 0, offeredRate: span ? offered / span : 0, wasted, rejected, served, wastedShare: served ? wasted / served : 0, critShare: critOff ? crit / critOff : 0, peakQ, busy, good };
}
