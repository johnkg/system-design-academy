// Error budget and burn rate in JavaScript. The numbers are passed in, so the output is deterministic.

const MINUTES_PER_DAY = 24 * 60;
const WINDOW_DAYS = 30; // the SLO is measured over a rolling 30-day window
const PAGE_BURN_RATE = 14; // burning this fast for an hour spends 2% of a 30-day budget: page a human

// How much downtime does an SLO allow over a window?
function errorBudgetMinutes(slo, windowDays) {
  return (1 - slo) * windowDays * MINUTES_PER_DAY;
}

// Burn rate: how fast the budget is being spent compared with spending it evenly over the window.
// 1.0 spends exactly the whole budget by the end of the window; 14 would spend it in about two days.
function burnRate(errorRatio, slo) {
  return errorRatio / (1 - slo);
}

for (const slo of [0.99, 0.999, 0.9999]) {
  console.log(`SLO ${(slo * 100).toFixed(2)}% over 30 days allows ${errorBudgetMinutes(slo, WINDOW_DAYS).toFixed(1)} minutes of downtime`);
}

const slo = 0.999;
const incidents = [
  { name: "bad deploy", minutes: 20 },
  { name: "provider blip", minutes: 5 },
  { name: "slow day", minutes: 12 },
];
const budget = errorBudgetMinutes(slo, WINDOW_DAYS);
let spent = 0;
for (const incident of incidents) {
  spent += incident.minutes;
  console.log(`after ${incident.name}: ${(budget - spent).toFixed(1)} minutes left (${Math.max(0, ((budget - spent) / budget) * 100).toFixed(0)}%)`);
}
console.log(spent > budget ? "budget spent: freeze feature releases, fix reliability" : "budget remains: keep shipping");

// A 2% error rate for an hour, against a 99.9% SLO
const rate = burnRate(0.02, slo);
console.log(`burn rate at 2% errors: ${rate.toFixed(0)}x${rate >= PAGE_BURN_RATE ? " -> page someone now" : ""}`);
console.log(`burn rate at 0.05% errors: ${burnRate(0.0005, slo).toFixed(1)}x (well within budget)`);
