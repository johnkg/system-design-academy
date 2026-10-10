# A grid index for finding the nearest driver in Python:
# drivers are filed under the grid cell they are in, so a search only looks at nearby cells instead of every driver.
import math
import sys

CELL = 2  # cell size, in the same units as the coordinates (think of 2 km)


def cell_of(v):
    return math.floor(v / CELL)


def distance(a, b):
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


class DriverIndex:
    def __init__(self):
        self.cells = {}  # "cx,cy" -> drivers in that cell
        self.where = {}  # driver id -> the key of the cell it is filed under

    # Called for every location update: move the driver to the right cell if it changed.
    def update(self, driver):
        key = f"{cell_of(driver['x'])},{cell_of(driver['y'])}"
        old = self.where.get(driver["id"])
        if old != key:
            if old:
                del self.cells[old][driver["id"]]
            if key not in self.cells:
                self.cells[key] = {}
            self.where[driver["id"]] = key
        self.cells[key][driver["id"]] = driver

    # Search ring by ring around the rider's cell. Ring 0 is the rider's own cell, ring 1 the 8 cells around it, and so on.
    # Every cell in ring k is at least (k - 1) * CELL away, so once the best driver found is closer than that, stop.
    def nearest(self, rider, max_ring=50):
        cx, cy = cell_of(rider["x"]), cell_of(rider["y"])
        best, best_distance, examined = None, math.inf, 0
        for k in range(max_ring + 1):
            if best and (k - 1) * CELL >= best_distance:
                break
            for dx in range(-k, k + 1):
                for dy in range(-k, k + 1):
                    if max(abs(dx), abs(dy)) != k:
                        continue  # only the cells on the edge of this ring
                    cell = self.cells.get(f"{cx + dx},{cy + dy}")
                    if not cell:
                        continue
                    for driver in cell.values():
                        examined += 1
                        d = distance(rider, driver)
                        if d < best_distance:
                            best, best_distance = driver, d
        return {"driver": best, "distance": best_distance, "examined": examined}


# A reproducible set of 2,000 drivers on a 100 x 100 map.
seed = 42


def random():
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296


drivers = []
for i in range(2000):
    # x is drawn before y, as in the JavaScript object literal
    x = random() * 100
    y = random() * 100
    drivers.append({"id": i, "x": x, "y": y})

index = DriverIndex()
for d in drivers:
    index.update(d)

# A driver moves across a cell boundary: the next update files them under the new cell.
index.update({"id": 0, "x": drivers[0]["x"] + 5, "y": drivers[0]["y"]})


def fmt(v):
    return str(v)


mismatches = 0
for rider in [{"x": 50, "y": 50}, {"x": 1.9, "y": 99.9}, {"x": 21.99, "y": 21.99}]:
    found = index.nearest(rider)
    # Check against the slow way, which looks at every driver.
    truth, truth_distance = None, math.inf
    for driver in [d for c in index.cells.values() for d in c.values()]:
        d = distance(rider, driver)
        if d < truth_distance:
            truth, truth_distance = driver, d
    same = found["driver"]["id"] == truth["id"]
    if not same:
        mismatches += 1
    print(f"rider ({fmt(rider['x'])}, {fmt(rider['y'])})  nearest driver {found['driver']['id']} at {found['distance']:.2f}  looked at {found['examined']} of 2000 drivers  {'matches' if same else 'DIFFERS from'} the full scan")
if mismatches > 0:
    sys.exit(1)
