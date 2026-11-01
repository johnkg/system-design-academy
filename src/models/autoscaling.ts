// The autoscaling simulation, kept apart from the page so plain Node can import it in unit tests.
// One step is one simulated minute. The playground draws the series this returns.
import { mulberry32 } from '../playground.ts';

export type Policy = 'target' | 'step' | 'scheduled';
export interface Params { policy: Policy; metric: 'cpu' | 'rps'; target: number; warmup: number; cooldown: number; patient: boolean; min: number; max: number }
/** One value per simulated minute: what the tier looked like at the end of each step. */
export interface Result { ready: number[]; total: number[]; util: number[]; dropped: number[]; over: number[]; actions: number[]; flaps: number[] }

export const REQUESTS_PER_INSTANCE = 100; // requests per second one ready instance serves
export const SIMULATED_MINUTES = 120;
export const TRAFFIC_SEED = 7;
const SECONDS_PER_MINUTE = 60;
export const FLAP_WINDOW_MIN = 12; // a reversal this soon counts as a flap

const TRAFFIC = { quiet: 200, rampFrom: 24, peakFrom: 34, peak: 1200, declineFrom: 50, declineEnd: 300, nightFrom: 72, night: 80, noiseMin: 0.92, noiseSpan: 0.16 }; // req/s by minute; noise is +-8%
const START_INSTANCES = 4;
const NO_PREVIOUS_ACTION_MINUTE = -99;
const EPSILON = 1e-9; // keeps ceil() from rounding an exact ratio up
const STEP = { bigGap: 0.2, bigAdd: 3, inGap: 0.3 }; // step policy: +3 when 20 points over target, -1 when 30 under
const SCHEDULE = { from: 28, to: 64, instances: 12 }; // scheduled policy: 12 instances for minutes 28..63
const PATIENT_CALM_MIN = 5; // minutes of low demand before a patient scale-in

/** A quiet baseline, a sharp spike, a noisy decline, then a quiet night. Integers, seeded. */
export function makeTraffic(seed: number): number[] {
  const rnd = mulberry32(seed); const out: number[] = [];
  for (let t = 0; t < SIMULATED_MINUTES; t++) {
    const T = TRAFFIC; let base = T.quiet;
    if (t >= T.rampFrom && t < T.peakFrom) base = T.quiet + ((T.peak - T.quiet) * (t - T.rampFrom)) / (T.peakFrom - T.rampFrom);
    else if (t >= T.peakFrom && t < T.declineFrom) base = T.peak;
    else if (t >= T.declineFrom && t < T.nightFrom) base = T.peak - ((T.peak - T.declineEnd) * (t - T.declineFrom)) / (T.nightFrom - T.declineFrom);
    else if (t >= T.nightFrom) base = T.night;
    out.push(Math.round(base * (T.noiseMin + T.noiseSpan * rnd())));
  }
  return out;
}

export function simulate(p: Params, traffic: number[]): Result {
  const lo = Math.min(p.min, p.max); const hi = Math.max(p.min, p.max);
  let ready = Math.max(lo, Math.min(hi, START_INSTANCES)); let pending: number[] = [];
  let cool = 0; let calm = 0; let lastDir = 0; let lastAt = NO_PREVIOUS_ACTION_MINUTE; let actions = 0; let flaps = 0;
  const r: Result = { ready: [], total: [], util: [], dropped: [], over: [], actions: [], flaps: [] };
  for (let t = 0; t < traffic.length; t++) {
    ready += pending.filter((x) => x <= t).length; pending = pending.filter((x) => x > t);
    const load = traffic[t]; const total = ready + pending.length; const cap = ready * REQUESTS_PER_INSTANCE;
    const raw = load / cap; const drop = load - Math.min(load, cap);
    r.ready.push(ready); r.total.push(total); r.util.push(raw); r.dropped.push(drop); r.over.push(raw > 1 ? 1 : 0);
    const T = p.target / 100; const util = p.metric === 'cpu' ? Math.min(1, raw) : raw;
    let want = total;
    if (p.policy === 'target') want = p.metric === 'cpu' ? Math.ceil((ready * util) / T - EPSILON) : Math.ceil(load / (REQUESTS_PER_INSTANCE * T) - EPSILON);
    else if (p.policy === 'step') want = util > T + STEP.bigGap ? total + STEP.bigAdd : util > T ? total + 1 : util < T - STEP.inGap ? total - 1 : total;
    else want = t >= SCHEDULE.from && t < SCHEDULE.to ? SCHEDULE.instances : lo;
    want = Math.max(lo, Math.min(hi, want));
    if (want < total) calm++; else calm = 0;
    if (cool > 0) cool--;
    else {
      let next = total;
      if (want > total) next = want;
      else if (want < total && (!p.patient || calm >= PATIENT_CALM_MIN)) next = p.patient ? total - 1 : want;
      if (next !== total) {
        const dir = next > total ? 1 : -1;
        if (dir > 0) for (let i = 0; i < next - total; i++) pending.push(t + 1 + p.warmup);
        else { let k = total - next; while (k > 0 && pending.length > 0) { pending.pop(); k--; } ready -= k; }
        if (lastDir !== 0 && dir !== lastDir && t - lastAt <= FLAP_WINDOW_MIN) flaps++;
        lastDir = dir; lastAt = t; actions++; cool = p.cooldown;
      }
    }
    r.actions.push(actions); r.flaps.push(flaps);
  }
  return r;
}

/** Totals over the first `minutes` minutes: requests dropped or slow, instance-minutes paid for, minutes spent overloaded. */
export function summarize(result: Result, minutes: number): { dropped: number; cost: number; overloadedMinutes: number } {
  let dropped = 0; let cost = 0; let overloadedMinutes = 0;
  for (let i = 0; i < minutes; i++) {
    dropped += result.dropped[i] * SECONDS_PER_MINUTE; cost += result.total[i]; overloadedMinutes += result.over[i];
  }
  return { dropped, cost, overloadedMinutes };
}
