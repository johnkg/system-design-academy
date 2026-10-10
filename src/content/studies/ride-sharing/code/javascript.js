// A grid index for finding the nearest driver in JavaScript:
// drivers are filed under the grid cell they are in, so a search only looks at nearby cells instead of every driver.

const CELL = 2; // cell size, in the same units as the coordinates (think of 2 km)

const cellOf = (v) => Math.floor(v / CELL);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

class DriverIndex {
  constructor() {
    this.cells = new Map(); // "cx,cy" -> drivers in that cell
    this.where = new Map(); // driver id -> the key of the cell it is filed under
  }

  // Called for every location update: move the driver to the right cell if it changed.
  update(driver) {
    const key = `${cellOf(driver.x)},${cellOf(driver.y)}`;
    const old = this.where.get(driver.id);
    if (old !== key) {
      if (old) this.cells.get(old).delete(driver.id);
      if (!this.cells.has(key)) this.cells.set(key, new Map());
      this.where.set(driver.id, key);
    }
    this.cells.get(key).set(driver.id, driver);
  }

  // Search ring by ring around the rider's cell. Ring 0 is the rider's own cell, ring 1 the 8 cells around it, and so on.
  // Every cell in ring k is at least (k - 1) * CELL away, so once the best driver found is closer than that, stop.
  nearest(rider, maxRing = 50) {
    const cx = cellOf(rider.x), cy = cellOf(rider.y);
    let best = null, bestDistance = Infinity, examined = 0;
    for (let k = 0; k <= maxRing; k++) {
      if (best && (k - 1) * CELL >= bestDistance) break;
      for (let dx = -k; dx <= k; dx++) {
        for (let dy = -k; dy <= k; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue; // only the cells on the edge of this ring
          const cell = this.cells.get(`${cx + dx},${cy + dy}`);
          if (!cell) continue;
          for (const driver of cell.values()) {
            examined++;
            const d = distance(rider, driver);
            if (d < bestDistance) { best = driver; bestDistance = d; }
          }
        }
      }
    }
    return { driver: best, distance: bestDistance, examined };
  }
}

// A reproducible set of 2,000 drivers on a 100 x 100 map.
let seed = 42;
const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const drivers = Array.from({ length: 2000 }, (_, i) => ({ id: i, x: random() * 100, y: random() * 100 }));

const index = new DriverIndex();
drivers.forEach((d) => index.update(d));

// A driver moves across a cell boundary: the next update files them under the new cell.
index.update({ id: 0, x: drivers[0].x + 5, y: drivers[0].y });

let mismatches = 0;
for (const rider of [{ x: 50, y: 50 }, { x: 1.9, y: 99.9 }, { x: 21.99, y: 21.99 }]) {
  const found = index.nearest(rider);
  // Check against the slow way, which looks at every driver.
  let truth = null, truthDistance = Infinity;
  for (const driver of [...index.cells.values()].flatMap((c) => [...c.values()])) {
    const d = distance(rider, driver);
    if (d < truthDistance) { truth = driver; truthDistance = d; }
  }
  const same = found.driver.id === truth.id;
  if (!same) mismatches++;
  console.log(`rider (${rider.x}, ${rider.y})  nearest driver ${found.driver.id} at ${found.distance.toFixed(2)}  looked at ${found.examined} of 2000 drivers  ${same ? 'matches' : 'DIFFERS from'} the full scan`);
}
if (mismatches > 0) process.exit(1);
