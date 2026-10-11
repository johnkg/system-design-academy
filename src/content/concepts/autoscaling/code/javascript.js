// A target-tracking autoscaler with warm-up, cooldown and min/max bounds, run over a fixed traffic series.
// One step is one minute. Everything is integers, so the output is identical in every language.

const CAPACITY = 100; // requests per second one warm instance can serve
const config = { targetPercent: 60, warmup: 2, cooldown: 2, min: 2, max: 12 };

// Requests per second: quiet, a sharp spike, then a quiet night.
const traffic = [150, 160, 150, 170, 400, 800, 1000, 1000, 1000, 900, 700, 500, 300, 200, 150,
  140, 150, 160, 150, 140, 80, 70, 80, 70, 80, 70, 80, 70, 80, 70];

function desiredInstances(load, cfg) {
  // Enough instances that each one runs at the target utilisation: ceil(load / (capacity * target)).
  const perInstance = CAPACITY * cfg.targetPercent;
  return Math.floor((load * 100 + perInstance - 1) / perInstance);
}

function run(series, cfg) {
  let ready = cfg.min; // warm instances that serve traffic
  let warming = []; // minute at which each launched instance becomes ready
  let cooldownLeft = 0;
  let instanceMinutes = 0, droppedRequests = 0, overloadedMinutes = 0, actions = 0, peak = ready;

  series.forEach((load, minute) => {
    ready += warming.filter((at) => at <= minute).length;
    warming = warming.filter((at) => at > minute);
    const total = ready + warming.length;

    const served = Math.min(load, ready * CAPACITY);
    droppedRequests += (load - served) * 60;
    if (load > ready * CAPACITY) overloadedMinutes++;
    instanceMinutes += total; // you pay for instances while they warm up
    peak = Math.max(peak, total);
    const readyNow = ready;
    const util = Math.floor((load * 100) / (ready * CAPACITY));

    // Decide: clamp to the bounds, and stay quiet during the cooldown.
    const desired = Math.max(cfg.min, Math.min(cfg.max, desiredInstances(load, cfg)));
    let action = "hold";
    if (cooldownLeft > 0) {
      cooldownLeft--;
    } else if (desired > total) {
      for (let i = 0; i < desired - total; i++) warming.push(minute + 1 + cfg.warmup);
      action = `out +${desired - total}`;
      cooldownLeft = cfg.cooldown;
    } else if (desired < total) {
      let remove = total - desired;
      while (remove > 0 && warming.length > 0) { warming.pop(); remove--; } // drop the newest first
      ready -= remove;
      action = `in -${total - desired}`;
      cooldownLeft = cfg.cooldown;
    }
    if (action !== "hold") actions++;
    console.log(`min ${String(minute).padStart(2)} load ${String(load).padStart(4)} ready ${String(readyNow).padStart(2)} total ${String(total).padStart(2)} util ${String(util).padStart(3)}% ${action}`);
  });
  return { instanceMinutes, droppedRequests, overloadedMinutes, actions, peak };
}

const r = run(traffic, config);
console.log(`instance-minutes ${r.instanceMinutes}, dropped or slow requests ${r.droppedRequests}`);
console.log(`overloaded minutes ${r.overloadedMinutes}, scaling actions ${r.actions}, peak instances ${r.peak}`);

// Invariants: bounds respected, and the spike really did cause some overload while instances warmed up.
if (r.peak > config.max || r.peak < config.min) process.exit(1);
if (r.overloadedMinutes === 0 || r.instanceMinutes < traffic.length * config.min) process.exit(1);
