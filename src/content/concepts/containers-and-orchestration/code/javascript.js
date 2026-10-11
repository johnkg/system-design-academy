// A tiny orchestrator: a scheduler (filter by free CPU/memory, score by policy) and a reconcile loop
// that restores the desired replica count after a node is lost. Integers only, so output is exact.

const NODE_CPU = 4000; // millicores per node
const NODE_MEM = 8192; // MiB per node

function makeCluster(count) {
  const nodes = [];
  for (let i = 1; i <= count; i++) nodes.push({ name: `n${i}`, up: true });
  return { nodes, pods: [], nextId: 1 };
}

const podsOn = (c, i) => c.pods.filter((p) => p.node === i);

// FILTER: a node is feasible if it is up and the sum of requests still fits.
// SCORE: percent of CPU + percent of memory that would be requested after placing the pod.
//        spread prefers the lowest score (emptiest), pack prefers the highest (fullest that fits).
function schedule(c, spec, policy) {
  let best = -1;
  let bestScore = 0;
  c.nodes.forEach((node, i) => {
    if (!node.up) return;
    const used = podsOn(c, i);
    const cpu = used.length * spec.cpu + spec.cpu;
    const mem = used.length * spec.mem + spec.mem;
    if (cpu > NODE_CPU || mem > NODE_MEM) return; // filtered out
    const score = Math.floor((cpu * 100) / NODE_CPU) + Math.floor((mem * 100) / NODE_MEM);
    const better = best === -1 || (policy === "spread" ? score < bestScore : score > bestScore);
    if (better) { best = i; bestScore = score; }
  });
  return best; // -1 means no node fits: the pod stays Pending
}

// RECONCILE: compare desired with actual, create or delete, then try to place Pending pods.
function reconcile(c, desired, spec, policy) {
  while (c.pods.length < desired) c.pods.push({ id: c.nextId++, node: -1 });
  while (c.pods.length > desired) c.pods.pop();
  for (const pod of c.pods) {
    if (pod.node === -1) pod.node = schedule(c, spec, policy);
  }
  return c.pods.filter((p) => p.node === -1).length;
}

function killNode(c, i) {
  c.nodes[i].up = false;
  const before = c.pods.length;
  c.pods = c.pods.filter((p) => p.node !== i); // the pods on it are gone
  return before - c.pods.length;
}

const running = (c) => c.pods.filter((p) => p.node !== -1).length;
const counts = (c) => c.nodes.map((n, i) => (n.up ? String(podsOn(c, i).length) : "X")).join(" ");

function check(c, spec) {
  c.nodes.forEach((_, i) => {
    const n = podsOn(c, i).length;
    if (n * spec.cpu > NODE_CPU || n * spec.mem > NODE_MEM) throw new Error("node over-requested");
  });
}

const spec = { cpu: 1000, mem: 1024 };

for (const policy of ["spread", "pack"]) {
  const c = makeCluster(4);
  let pending = reconcile(c, 6, spec, policy);
  console.log(`${policy}: placed 6 pods -> ${counts(c)} (pending ${pending})`);
  const victim = c.nodes.findIndex((_, i) => podsOn(c, i).length === Math.max(...c.nodes.map((__, j) => podsOn(c, j).length)));
  const lost = killNode(c, victim);
  console.log(`${policy}: ${c.nodes[victim].name} died, ${lost} pods lost, ${running(c)} of 6 running`);
  pending = reconcile(c, 6, spec, policy);
  console.log(`${policy}: reconciled -> ${counts(c)} (running ${running(c)}, pending ${pending})`);
  check(c, spec);
  if (running(c) !== 6 || pending !== 0) throw new Error("did not converge");
}

const c = makeCluster(4);
reconcile(c, 14, spec, "spread");
killNode(c, 0);
let pending = reconcile(c, 14, spec, "spread");
console.log(`14 replicas, 1 node down -> ${counts(c)} (running ${running(c)}, pending ${pending})`);
if (running(c) !== 12 || pending !== 2) throw new Error("expected 12 running and 2 pending");
c.nodes[0].up = true; // the node comes back
pending = reconcile(c, 14, spec, "spread");
console.log(`node back -> ${counts(c)} (running ${running(c)}, pending ${pending})`);
check(c, spec);
if (pending !== 0) throw new Error("pending pods should have been scheduled");
