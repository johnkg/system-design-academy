# Strangler fig: a legacy shop with 8 slices is replaced by a new system four ways, for a few shadow-traffic and ramp-up settings.
# Look for: days until real users reach the new system, the most traffic switched in one step, requests hit by bugs before they were noticed,
# bugs still silent after the migration, and how many data links cross the old/new boundary at the worst moment.
# Model: each slice has traffic (thousand requests a day) and hidden bugs (each fires on `rate` of every 1,000 requests of its slice).
# Shadow mode replays real requests to both systems and compares the answers: a bug counts as caught before any user sees it when its expected number of firings in the replay is at least 1 (a deterministic simplification: real catches are probabilistic).
# A ramp moves a share of a slice's traffic for one day per step. A monitor alerts when a bug hits 20 or more requests a day. Without rollback, fixing forward takes 5 days.
# Assumptions: building a slice takes 21 days (7 days for a slice a third the size), the team builds slices one after another, and ramp days overlap with the next build.
ALERT, FIX_FORWARD_DAYS = 20, 5
SLICES = [  # name, traffic, bug rates
    ("accounts", 30, [40]), ("catalog", 120, [2]), ("search", 90, []), ("cart", 60, [15, 1]),
    ("checkout", 30, [50, 3]), ("orders", 24, [8]), ("invoices", 9, [30, 1]), ("reports", 6, []),
]
LINKS = [(0, 3), (0, 4), (1, 2), (1, 3), (3, 4), (4, 5), (5, 6), (5, 7), (6, 7)]  # slices that share data
RAMPS = [("All at once", [100]), ("1% then everything", [1, 100]), ("1, 10, 50, 100", [1, 10, 50, 100]), ("10% steps", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])]
# name, split, shadow, ramp, rollback
DESIGNS = [
    ("Big-bang rewrite", 1, True, False, False),
    ("Strangler with parity checks", 1, True, True, True),
    ("Strangler without parity checks", 1, False, True, True),
    ("Slices of one endpoint", 3, True, True, True),
]


def slices_of(split):  # split each slice in `split` parts: traffic is shared out, bug i goes to part i % split
    out = []
    for p, (name, traffic, bugs) in enumerate(SLICES):
        for j in range(split):
            out.append({"parent": p, "part": j, "traffic": traffic // split, "bugs": [b for i, b in enumerate(bugs) if i % split == j]})
    return out


def links_of(split, slices):
    if split == 1:
        return LINKS

    def idx(p, j):
        return next(i for i, s in enumerate(slices) if s["parent"] == p and s["part"] == j)

    out = []
    for a, b in LINKS:
        for j in range(split):
            out.append((idx(a, j), idx(b, j)))
    for p in range(len(SLICES)):
        for j in range(split - 1):
            out.append((idx(p, j), idx(p, j + 1)))
    return out


def peak_crossing(slices, links):  # slices move in order; count links with one end moved and the other not
    peak = 0
    for k in range(1, len(slices)):
        peak = max(peak, sum(1 for a, b in links if (a < k) != (b < k)))
    return peak


def run(d, shadow_requests, ramp):
    _, split, use_shadow, use_ramp, rollback = d
    slices = slices_of(split)
    total = sum(x[1] for x in SLICES)
    steps = ramp if use_ramp else [100]
    shadow = shadow_requests if use_shadow else 0
    harm = silent = caught = bugs = widest = 0
    for s in slices:
        prev = 0
        for share in steps:
            widest = max(widest, ((share - prev) * s["traffic"]) // total)
            prev = share
        for rate in s["bugs"]:
            bugs += 1
            if (shadow * rate) // 1000 >= 1:
                caught += 1
                continue
            noticed = False
            for share in steps:
                hit = (s["traffic"] * share * rate) // 100  # requests a day that fire the bug at this share
                if hit >= ALERT:
                    harm += hit if rollback else hit * FIX_FORWARD_DAYS
                    noticed = True
                    break
                harm += hit
            if not noticed:
                silent += 1
    build_days = 21 if split == 1 else 7
    first = build_days if use_ramp else 21 * len(SLICES)
    finish = build_days * len(slices) + len(steps) if use_ramp else 21 * len(SLICES) + 1
    return (first + 1, finish, widest if use_ramp else 100, caught, bugs, harm, silent,
            peak_crossing(slices, links_of(split, slices)) if use_ramp else 0, len(slices) if use_ramp else 1)


for shadow, ramp_idx in [(0, 2), (500, 2), (2000, 2), (500, 0)]:
    print(f'-- shadow {shadow} requests per slice, ramp "{RAMPS[ramp_idx][0]}"')
    for d in DESIGNS:
        first, finish, widest, caught, bugs, harm, silent, peak, routes = run(d, shadow, RAMPS[ramp_idx][1])
        print(f"  {d[0]}: first users on day {first}, done on day {finish}, widest step {widest}% of all traffic, shadow caught {caught} of {bugs} bugs, requests hit before noticed {harm}, bugs silent {silent}, data links across the boundary at worst {peak}, slices to route {routes}")
