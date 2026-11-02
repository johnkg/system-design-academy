// A miniature of Dapper, Google's tracing system (Google technical report, 2010), in JavaScript (a teaching model, not Google's code):
// every traced request carries a trace id, span id and parent span id through its RPCs, the sampling decision is made once at the
// root and followed by every callee, each host writes spans to its own local log, a collector gathers the logs out of band, and
// the trace tree is rebuilt from the ids even when some hosts have not been collected yet. Everything is deterministic.

const RATE = 4; // trace 1 request in 4 (Dapper's real rates are as low as 1 in 1024)
const REQUESTS = 20;
const logs = { frontend: [], auth: [], search: [], index: [], ads: [] }; // each host's local span log

// One request: frontend calls auth and search; search calls index and ads. The times are made up and depend on the trace id.
function handle(traceId) {
  const ctx = { traceId, sampled: traceId % RATE === 0 }; // decided once, at the root
  let next = 1;
  const span = (host, name, parent, start, end) => {
    const id = traceId * 10 + next++;
    if (ctx.sampled) logs[host].push({ traceId, id, parent, name, host, start, end }); // untraced requests write nothing
    return id;
  };
  const adsTime = 40 + (traceId % 3) * 15;
  const root = span('frontend', 'Frontend.Request', null, 0, 20 + 70 + adsTime);
  span('auth', 'Auth.Check', root, 5, 15);
  const search = span('search', 'Search.Query', root, 20, 20 + 70 + adsTime);
  span('index', 'Index.Lookup', search, 30, 60);
  span('ads', 'Ads.Select', search, 30, 30 + adsTime);
  return ctx.sampled;
}

const sampled = [];
for (let id = 1; id <= REQUESTS; id++) if (handle(id)) sampled.push(id);
const written = Object.values(logs).reduce((n, l) => n + l.length, 0);
console.log(`${REQUESTS} requests, sampling 1 in ${RATE}: traced ${sampled.join(', ')}`);
console.log(`spans written: ${written} instead of ${REQUESTS * 5} if every request were traced`);

function tree(spans, traceId) { // rebuild the tree from ids alone
  const mine = spans.filter((s) => s.traceId === traceId);
  const ids = new Set(mine.map((s) => s.id));
  const lines = [];
  const walk = (parent, depth) => {
    for (const s of mine.filter((x) => x.parent === parent).sort((a, b) => a.start - b.start)) {
      lines.push(`${'  '.repeat(depth)}${s.name} on ${s.host}: ${s.start}-${s.end} ms (${s.end - s.start} ms)`);
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  const orphans = mine.filter((s) => s.parent !== null && !ids.has(s.parent)).length;
  return { lines, orphans, count: mine.length };
}

console.log('--- collection is out of band: the daemons have gathered every host except ads');
const partial = Object.entries(logs).filter(([host]) => host !== 'ads').flatMap(([, l]) => l);
let result = tree(partial, 4);
console.log(`trace 4 has ${result.count} of 5 spans so far`);
result.lines.forEach((l) => console.log(`  ${l}`));
console.log('--- the ads host is collected');
const everything = Object.values(logs).flat();
result = tree(everything, 4);
console.log(`trace 4 has ${result.count} of 5 spans`);
result.lines.forEach((l) => console.log(`  ${l}`));
const slowest = sampled.map((id) => [id, tree(everything, id).lines[0]]).sort((a, b) => Number(b[1].match(/\((\d+) ms\)/)[1]) - Number(a[1].match(/\((\d+) ms\)/)[1]))[0];
console.log(`slowest traced request: trace ${slowest[0]}, ${slowest[1]}`);
