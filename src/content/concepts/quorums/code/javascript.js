// Quorum reads and writes in JavaScript: N replicas, a write waits for W of them, a read asks R of them.
// To show the worst case, a write reaches the FIRST W replicas and a read asks the LAST R replicas.

class Cluster {
  constructor(n) { this.replicas = Array.from({ length: n }, () => ({ version: 1, value: "v1" })); }

  write(value, w) {
    const version = Math.max(...this.replicas.map((r) => r.version)) + 1;
    const reached = [];
    for (let i = 0; i < w; i++) { this.replicas[i] = { version, value }; reached.push(i); } // the other replicas are slow and miss it
    return reached;
  }

  read(r) {
    const asked = this.replicas.map((_, i) => i).slice(-r);
    const newest = asked.map((i) => this.replicas[i]).reduce((a, b) => (b.version > a.version ? b : a)); // newest version wins
    return { asked, value: newest.value };
  }
}

function demo(n, w, r) {
  const cluster = new Cluster(n);
  const wrote = cluster.write("v2", w);
  const read = cluster.read(r);
  const guaranteed = r + w > n;
  console.log(`N=${n} W=${w} R=${r}: wrote [${wrote}], read [${read.asked}] -> ${read.value}  (R+W ${guaranteed ? ">" : "<="} N: ${guaranteed ? "fresh read guaranteed" : "stale read possible"})`);
}

demo(3, 2, 2); // quorums overlap
demo(3, 1, 1); // fastest, but can read stale data
demo(3, 3, 1); // slow, fragile writes, but any single replica is up to date
demo(5, 3, 3); // a common majority setting
demo(5, 2, 3); // 5 is not greater than 5: stale read possible
