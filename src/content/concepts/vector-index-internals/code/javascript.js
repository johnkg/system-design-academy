// An inverted-file (IVF) index in JavaScript on 12 fixed 2-D points: how many distances are computed, and what is missed.
const POINTS = {
  p0: [0.5, 1.0], p1: [1.0, 0.5], p2: [2.4, 1.2], p3: [1.0, 1.5],
  p4: [4.5, 1.0], p5: [5.0, 0.5], p6: [5.5, 1.5], p7: [4.8, 1.2],
  p8: [2.5, 5.0], p9: [3.0, 4.5], p10: [3.5, 5.5], p11: [3.0, 5.0],
};
const CENTROIDS = { A: [1.2, 1.0], B: [5.0, 1.0], C: [3.0, 5.0] };
const QUERY = [3.3, 1.1];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const argmin = (items, key) => items.reduce((best, x) => (key(x) < key(best) ? x : best));

// Build: each point goes to the list of its nearest centroid.
const lists = Object.fromEntries(Object.keys(CENTROIDS).map((name) => [name, []]));
for (const [pid, point] of Object.entries(POINTS)) {
  lists[argmin(Object.keys(CENTROIDS), (c) => dist(point, CENTROIDS[c]))].push(pid);
}

function search(names) {
  const candidates = names.flatMap((name) => lists[name]);
  return [candidates.length, argmin(candidates, (pid) => dist(POINTS[pid], QUERY))];
}

const [allCount, exact] = search(Object.keys(CENTROIDS));
console.log(`exact search: ${allCount} distances computed, nearest ${exact} (distance ${dist(POINTS[exact], QUERY).toFixed(3)})`);

const ranked = Object.keys(CENTROIDS).sort((a, b) => dist(CENTROIDS[a], QUERY) - dist(CENTROIDS[b], QUERY)); // the closest lists first
for (const nprobe of [1, 2]) {
  const probed = ranked.slice(0, nprobe);
  const [count, best] = search(probed);
  console.log(`IVF, ${nprobe} lists probed (${probed.join(", ")}): ${count} distances computed, ` +
    `nearest ${best} (distance ${dist(POINTS[best], QUERY).toFixed(3)}), matches exact: ${best === exact ? "yes" : "no"}`);
}
