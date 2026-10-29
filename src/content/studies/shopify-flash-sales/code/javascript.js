// A miniature of three ideas from Shopify's flash-sale posts, in JavaScript (a teaching model, not Shopify's code or data):
// 1. pods: every request goes to exactly one pod, so one broken pod does not break the other shops,
// 2. a fair checkout queue: a threshold on arrival order that is corrected each tick by the unused room in the bucket,
// 3. protecting a slow dependency: a limit on workers waiting on it, and a circuit breaker.
// Everything is deterministic and uses whole numbers, so every run prints the same thing.

// ---- 1. Pods ----
const podOf = { 'shop-a': 1, 'shop-b': 1, 'shop-c': 2, 'shop-d': 2, 'shop-e': 3 }; // the "Sorting Hat" rules, as a table
const podsDown = new Set([2]);

console.log('== Pods: pod 2 loses its database ==');
for (const shop of Object.keys(podOf)) {
  const pod = podOf[shop];
  console.log(`${shop} -> pod ${pod}: ${podsDown.has(pod) ? 'unavailable' : 'ok'}`);
}
const shops = Object.keys(podOf);
const served = shops.filter((s) => !podsDown.has(podOf[s])).length;
console.log(`shops served: ${served} of ${shops.length}`);
// Without pods, an action that visits every shard fails for everyone as soon as one shard is down.
console.log(`an action that needs every pod: ${podsDown.size === 0 ? shops.length : 0} of ${shops.length}`);

// ---- 2. A fair checkout queue ----
// Buyers 1..10 arrive in that order. Each tick the bucket lets LIMIT buyers through. The threshold is an arrival
// number: only buyers at or below it may try the bucket. Each tick it moves by the room left, a proportional-only correction.
console.log('== Fair queue: limit 3 per tick ==');
const LIMIT = 3;
let waiting = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
let threshold = 0;
const admitted = [];
for (let tick = 1; tick <= 4; tick++) {
  if (tick === 2) waiting = waiting.filter((n) => n !== 4 && n !== 7); // buyers 4 and 7 give up and stop polling
  const eligible = waiting.filter((n) => n <= threshold).length;
  threshold += LIMIT - eligible;
  const letIn = waiting.filter((n) => n <= threshold).slice(0, LIMIT);
  waiting = waiting.filter((n) => !letIn.includes(n));
  admitted.push(...letIn);
  console.log(`tick ${tick}: threshold ${threshold}, let in ${letIn.join(',')}, still waiting ${waiting.length}`);
}
const fair = admitted.every((n, i) => i === 0 || admitted[i - 1] < n);

// ---- 3. A slow dependency ----
const TIMEOUT = 10; // time units a worker is stuck on a call that never answers
console.log('== Slow session store: 8 workers call it at once ==');
const WORKERS = 8, PERMITS = 2;
const unguarded = WORKERS * TIMEOUT;
const guarded = PERMITS * TIMEOUT; // the rest are refused at once and use the guest fallback
console.log(`no limit: ${unguarded} worker time lost`);
console.log(`limit of ${PERMITS} at a time: ${guarded} worker time lost, ${WORKERS - PERMITS} served at once as guests`);

console.log('== Circuit breaker: 6 calls in a row to a dead store ==');
const OPEN_AFTER = 2;
let failures = 0, lost = 0;
for (let call = 1; call <= 6; call++) {
  if (failures >= OPEN_AFTER) { console.log(`call ${call}: circuit open, refused at once`); continue; }
  failures++; lost += TIMEOUT;
  console.log(`call ${call}: waited ${TIMEOUT}, failed`);
}
console.log(`time lost: ${lost} instead of ${6 * TIMEOUT}`);

const ok = served === 3 && fair && admitted.length === 8 && guarded === 20 && lost === 20;
console.log(`checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
