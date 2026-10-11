// A tiny cluster control plane in JavaScript:
// controllers compare desired and actual state, a scheduler filters then scores nodes,
// and a node controller evicts the pods of a node whose heartbeats stop for longer than the grace period.

const NODES = 8, CPU = 16, MEM = 64, BEAT = 10, END = 200;
const DEPLOYMENTS = [
  { name: 'web', replicas: 16, cpu: 2, mem: 4 },
  { name: 'cache', replicas: 4, cpu: 1, mem: 16 },
  { name: 'batch', replicas: 6, cpu: 4, mem: 8 },
];

function simulate(grace, lossPercent, killAt) {
  let seed = 42;
  const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
  const nodes = Array.from({ length: NODES }, (_, id) => ({ id, lastBeat: 0, ready: true, dead: false }));
  let pods = []; // the store: every pod object, with the node it is bound to (-1 while unscheduled)
  let nextId = 1;
  const r = { evictions: 0, falseEvictions: 0, killed: -1, killedPods: 0, notReadyAt: -1, restoredAt: -1, maxCpu: 0, maxMem: 0, spread: '' };

  const used = (n, key) => pods.filter((p) => p.node === n.id).reduce((s, p) => s + p[key], 0);

  // Filter: ready nodes with enough unrequested CPU and memory. Score: the most even CPU and memory use afterwards. Ties go to the lower id.
  function schedule(pod) {
    let best = null, bestScore = Infinity;
    for (const n of nodes) {
      const freeCpu = CPU - used(n, 'cpu') - pod.cpu, freeMem = MEM - used(n, 'mem') - pod.mem;
      if (!n.ready || freeCpu < 0 || freeMem < 0) continue;
      const score = Math.abs(Math.floor((freeCpu * 1000) / CPU) - Math.floor((freeMem * 1000) / MEM));
      if (score < bestScore) { best = n; bestScore = score; }
    }
    if (best) pod.node = best.id;
  }

  for (let t = 1; t <= END; t++) {
    if (t === killAt) { // the busiest node loses power
      const victim = nodes.reduce((a, b) => (pods.filter((p) => p.node === b.id).length > pods.filter((p) => p.node === a.id).length ? b : a));
      victim.dead = true; r.killed = victim.id; r.killedPods = pods.filter((p) => p.node === victim.id).length;
    }
    for (const n of nodes) { // kubelets send a heartbeat every BEAT seconds; a lossy network drops some of them
      if (t % BEAT !== n.id % BEAT || n.dead) continue;
      if (random(100) >= lossPercent) { n.lastBeat = t; n.ready = true; }
    }
    for (const n of nodes) { // node controller: no heartbeat for longer than the grace period means NotReady, so evict its pods
      if (n.ready && t - n.lastBeat > grace) {
        n.ready = false; r.evictions++;
        if (!n.dead) r.falseEvictions++; else r.notReadyAt = t;
        pods = pods.filter((p) => p.node !== n.id);
      }
    }
    for (const d of DEPLOYMENTS) { // replica controller: make the actual count match the desired count
      const have = pods.filter((p) => p.dep === d.name).length;
      for (let i = have; i < d.replicas; i++) pods.push({ id: nextId++, dep: d.name, cpu: d.cpu, mem: d.mem, node: -1 });
    }
    pods.filter((p) => p.node < 0).slice(0, 4).forEach(schedule); // the scheduler binds at most 4 pods per second
    for (const n of nodes) { r.maxCpu = Math.max(r.maxCpu, used(n, 'cpu')); r.maxMem = Math.max(r.maxMem, used(n, 'mem')); }
    if (t === 20) r.spread = nodes.map((n) => pods.filter((p) => p.node === n.id).length).join(' ');
    if (r.killed >= 0 && t > killAt && r.restoredAt < 0 && pods.length === 26 && pods.every((p) => p.node >= 0 && !nodes[p.node].dead)) r.restoredAt = t;
  }
  r.finalBound = pods.filter((p) => p.node >= 0 && !nodes[p.node].dead).length;
  return r;
}

const a = simulate(40, 0, 100);
console.log(`pods per node at t=20: ${a.spread}`);
console.log(`node ${a.killed} died at t=100 with ${a.killedPods} pods; marked NotReady at t=${a.notReadyAt}; all 26 pods bound again at t=${a.restoredAt}`);
const b = simulate(5, 10, -1), c = simulate(40, 10, -1);
console.log(`healthy nodes, 10% of heartbeats lost: grace 5 s gives ${b.falseEvictions} false evictions, grace 40 s gives ${c.falseEvictions}`);

const ok = a.maxCpu <= CPU && a.maxMem <= MEM && b.maxCpu <= CPU && b.maxMem <= MEM
  && a.finalBound === 26 && a.restoredAt > a.notReadyAt && a.notReadyAt - 100 <= 40 + BEAT + 1
  && b.falseEvictions > 0 && c.falseEvictions === 0;
console.log(`no node over-committed, desired equals actual, no flapping at 40 s: ${ok}`);
if (!ok) process.exit(1);
