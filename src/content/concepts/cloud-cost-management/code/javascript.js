// Cloud cost: the same web service priced several ways. Prices are cents per server-hour; everything is integers.
// The prices and discounts are illustrative toy figures, not any provider's real rates.
// LOAD is how many right-sized servers the traffic needs in each hour of a day.
const LOAD = [4, 3, 3, 3, 3, 4, 6, 9, 12, 14, 15, 16, 16, 15, 15, 14, 13, 12, 11, 10, 9, 7, 6, 5];
const ON_DEMAND = 20;     // cents per right-sized server-hour, pay as you go
const COMMITTED = 12;     // 40% off, but paid every hour for the committed servers, used or not
const SPOT = 6;           // 70% off spare capacity that the provider can take back
const RECLAIM_EVERY = 20; // about 1 spot hour in 20 is taken back and rerun at the on-demand price
const TEST_SERVERS = 6;   // a test environment, also billed on demand
const DAYS = 30;

const headroom = (load) => Math.floor((load * 5 + 3) / 4); // run 25% above the load (rounded up), so a spike does not hurt

function price({ large, autoscale, commit, spot, testHours }) {
  const size = large ? 2 : 1; // a large server costs twice as much and is half idle
  const peak = headroom(Math.max(...LOAD));
  let committed = 0, onDemand = 0, spotCost = 0, spotHours = 0, used = 0, paid = 0;
  for (const load of LOAD) {
    const run = autoscale ? headroom(load) : peak;
    committed += commit * COMMITTED * size;
    const extra = Math.max(0, run - commit);
    if (spot) { spotHours += extra; spotCost += extra * SPOT * size; } else onDemand += extra * ON_DEMAND * size;
    used += load;
    paid += Math.max(run, commit) * size;
  }
  onDemand += Math.floor(spotHours / RECLAIM_EVERY) * ON_DEMAND * size;
  const test = TEST_SERVERS * testHours * ON_DEMAND * size;
  const day = committed + onDemand + spotCost + test;
  return { month: day * DAYS, committed: committed * DAYS, onDemand: onDemand * DAYS, spot: spotCost * DAYS, test: test * DAYS, used, paid };
}

const dollars = (cents) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
function show(name, options) {
  const p = price(options);
  console.log(`-- ${name}`);
  console.log(`  month ${dollars(p.month)}: committed ${dollars(p.committed)}, on demand ${dollars(p.onDemand)}, spot ${dollars(p.spot)}, test environment ${dollars(p.test)}`);
  console.log(`  utilization ${Math.floor((p.used * 100) / p.paid)}% (${p.used} of ${p.paid} server-hours a day do work)`);
  if (p.month !== p.committed + p.onDemand + p.spot + p.test) throw new Error('the parts must add up to the bill');
  return p.month;
}

const start = show('large servers, fixed for the peak, all on demand, test always on', { large: true, autoscale: false, commit: 0, spot: false, testHours: 24 });
show('right-sized', { large: false, autoscale: false, commit: 0, spot: false, testHours: 24 });
show('right-sized, autoscaled', { large: false, autoscale: true, commit: 0, spot: false, testHours: 24 });
show('right-sized, autoscaled, commit to 4 servers, burst on spot, test off at night', { large: false, autoscale: true, commit: 4, spot: true, testHours: 12 });
const over = show('the same, but commit to 20 servers', { large: false, autoscale: true, commit: 20, spot: true, testHours: 12 });
if (over >= start) throw new Error('the over-commitment should still be cheaper than the start here');
