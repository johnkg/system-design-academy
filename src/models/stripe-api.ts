// A teaching model of the ideas in Stripe's two posts on API safety (rate limiters, and idempotency keys). It is not Stripe's
// code or data: the numbers are round figures chosen so the effects are easy to see. A fluid model, one step per second.
// Kept apart from the page so plain Node can import it in unit tests.

export type RetryPolicy = 'none' | 'immediate' | 'backoff';
export type Incident = 'runawayScript' | 'slowWorkers';
export interface Params { incident: Incident; limiter: boolean; shedder: boolean; retry: RetryPolicy; idempotency: boolean }
export interface Result {
  /** Share of customers' requests that ended in an error they could see after all retries, 0 to 1. */
  failedShare: number;
  /** The same, counting only charge requests (the critical ones). */
  criticalFailedShare: number;
  /** The busiest second's requests arriving at the workers, as a multiple of what they can finish at that moment. */
  peakLoad: number;
  /** Seconds in which more requests reached the workers than they can finish. */
  overloadedSeconds: number;
  /** Charges made twice because a client retried a request whose first attempt had already worked. */
  duplicateCharges: number;
  /** Requests reaching the workers each second, as a multiple of what they can finish that second. */
  loadBySecond: number[];
}

export const RUN_SECONDS = 60;
export const INCIDENT_START = 10;
export const INCIDENT_END = 40; // the runaway script stops here, or the workers recover
export const WORKER_CAPACITY = 1000; // requests per second the workers can finish
export const SLOW_WORKER_CAPACITY = 400; // what they can finish while slowed down
export const NORMAL_RPS = 600; // requests per second from everyone else
export const CRITICAL_SHARE = 0.3; // of normal traffic: creating charges. The rest is non-critical, such as listing charges
export const RUNAWAY_RPS = 5000; // one user's out-of-control script, all non-critical
export const BUCKET_REFILL_PER_SECOND = 100; // the runaway user's token bucket
export const BUCKET_SIZE = 500; // tokens a bucket holds, so a user may burst this far above the refill rate
export const NON_CRITICAL_CAPACITY_SHARE = 0.5; // the load shedder lets non-critical traffic use this share of capacity; the rest is reserved for critical
export const LOST_RESPONSE_SHARE = 0.02; // of finished charges, the share whose answer never reaches the client
export const MAX_ATTEMPTS = 3; // first try plus two retries

type PerClass = { critical: number; nonCritical: number };
const zeroed = (): number[] => new Array(RUN_SECONDS + 2 ** MAX_ATTEMPTS + 1).fill(0);

/** Seconds to wait before a retry, as equal shares: everyone at once, or spread over 1 to 2^n seconds (backoff with jitter). */
const retryDelays = (policy: RetryPolicy, failedAttempts: number): number[] =>
  policy === 'immediate' ? [1] : Array.from({ length: 2 ** failedAttempts }, (_, i) => i + 1);

export function simulate(p: Params): Result {
  // arrivals[attempt][second]: requests on their 1st, 2nd or 3rd attempt. "ambiguous" are retries of a charge that already worked.
  const arrivals = { critical: [zeroed(), zeroed(), zeroed()], nonCritical: [zeroed(), zeroed(), zeroed()], ambiguous: [zeroed(), zeroed(), zeroed()] };
  const loadBySecond: number[] = []; let tokens = BUCKET_SIZE; let peak = 0; let overloaded = 0; let newRequests = 0; let newCritical = 0; let finalFailures = 0; let criticalFailures = 0; let duplicates = 0;

  for (let t = 0; t < RUN_SECONDS; t++) {
    const incident = t >= INCIDENT_START && t < INCIDENT_END;
    arrivals.critical[0][t] += NORMAL_RPS * CRITICAL_SHARE;
    arrivals.nonCritical[0][t] += NORMAL_RPS * (1 - CRITICAL_SHARE);
    newRequests += NORMAL_RPS; newCritical += NORMAL_RPS * CRITICAL_SHARE;

    const capacity = incident && p.incident === 'slowWorkers' ? SLOW_WORKER_CAPACITY : WORKER_CAPACITY;
    let runaway = incident && p.incident === 'runawayScript' ? RUNAWAY_RPS : 0;
    if (p.limiter) { // token bucket: refill, then let through only as many requests as there are tokens
      tokens = Math.min(BUCKET_SIZE, tokens + BUCKET_REFILL_PER_SECOND);
      const allowed = Math.min(runaway, tokens);
      tokens -= allowed; runaway = allowed;
    }

    const attempts = [0, 1, 2];
    const offered: PerClass = { critical: 0, nonCritical: runaway };
    for (const a of attempts) { offered.critical += arrivals.critical[a][t]; offered.nonCritical += arrivals.nonCritical[a][t]; }
    const ambiguousRetries = attempts.reduce((sum, a) => sum + arrivals.ambiguous[a][t], 0);
    // With idempotency keys a retry of a finished charge is answered from the saved result and costs the workers nothing.
    const ambiguousLoad = p.idempotency ? 0 : ambiguousRetries;

    let admittedNonCritical = offered.nonCritical;
    if (p.shedder) admittedNonCritical = Math.min(offered.nonCritical, NON_CRITICAL_CAPACITY_SHARE * capacity);
    const admittedShare = offered.nonCritical > 0 ? admittedNonCritical / offered.nonCritical : 1;
    const load = offered.critical + ambiguousLoad + admittedNonCritical;
    loadBySecond.push(load / capacity);
    peak = Math.max(peak, load / capacity);
    if (load > capacity) overloaded++;
    const servedShare = load > 0 ? Math.min(1, capacity / load) : 1;

    const fail = (kind: 'critical' | 'nonCritical' | 'ambiguous', attempt: number, amount: number) => {
      if (amount <= 0) return;
      if (p.retry === 'none' || attempt + 1 >= MAX_ATTEMPTS) { if (kind !== 'ambiguous') { finalFailures += amount; if (kind === 'critical') criticalFailures += amount; } return; }
      const delays = retryDelays(p.retry, attempt + 1);
      for (const d of delays) arrivals[kind][attempt + 1][t + d] += amount / delays.length;
    };

    for (const a of attempts) {
      for (const kind of ['critical', 'nonCritical'] as const) {
        const here = arrivals[kind][a][t];
        const reached = kind === 'nonCritical' ? here * admittedShare : here;
        const served = reached * servedShare;
        fail(kind, a, here - served);
        if (kind === 'critical') { // some finished charges never answer; the client treats them as failures and may retry
          const lost = served * LOST_RESPONSE_SHARE;
          fail('ambiguous', a, lost);
        }
      }
      // retries of a charge that already worked
      const retried = arrivals.ambiguous[a][t];
      if (p.idempotency) continue; // answered from the saved result, no second charge
      const served = retried * servedShare;
      duplicates += served;
      fail('ambiguous', a, retried - served);
    }
  }
  return { failedShare: finalFailures / newRequests, criticalFailedShare: criticalFailures / newCritical, peakLoad: peak, overloadedSeconds: overloaded, duplicateCharges: duplicates, loadBySecond };
}
