# An inverted-file (IVF) index in Python on 12 fixed 2-D points: how many distances are computed, and what is missed.
import math

POINTS = {
    "p0": (0.5, 1.0), "p1": (1.0, 0.5), "p2": (2.4, 1.2), "p3": (1.0, 1.5),
    "p4": (4.5, 1.0), "p5": (5.0, 0.5), "p6": (5.5, 1.5), "p7": (4.8, 1.2),
    "p8": (2.5, 5.0), "p9": (3.0, 4.5), "p10": (3.5, 5.5), "p11": (3.0, 5.0),
}
CENTROIDS = {"A": (1.2, 1.0), "B": (5.0, 1.0), "C": (3.0, 5.0)}
QUERY = (3.3, 1.1)

# Build: each point goes to the list of its nearest centroid.
lists = {name: [] for name in CENTROIDS}
for pid, point in POINTS.items():
    nearest = min(CENTROIDS, key=lambda c: math.dist(point, CENTROIDS[c]))
    lists[nearest].append(pid)


def search(names):
    candidates = [pid for name in names for pid in lists[name]]
    best = min(candidates, key=lambda pid: math.dist(POINTS[pid], QUERY))
    return len(candidates), best


count, exact = search(list(CENTROIDS))
print(f"exact search: {count} distances computed, nearest {exact} (distance {math.dist(POINTS[exact], QUERY):.3f})")

ranked = sorted(CENTROIDS, key=lambda c: math.dist(CENTROIDS[c], QUERY))  # the closest lists first
for nprobe in (1, 2):
    probed = ranked[:nprobe]
    count, best = search(probed)
    matches = "yes" if best == exact else "no"
    print(f"IVF, {nprobe} lists probed ({', '.join(probed)}): {count} distances computed, "
          f"nearest {best} (distance {math.dist(POINTS[best], QUERY):.3f}), matches exact: {matches}")
