# DRY and the wrong abstraction: retail and wholesale shipping start out looking identical. Part 1 has the three designs as real
# functions (copy-paste, one merged function with flags, a shared core with separate edges) after four change requests that each
# concern ONE case, and shows they agree while their signatures differ. Part 2 counts the edits over a year of 20 change
# requests, as the share that concern only one case grows. Look for: the flag count and 2^flags of the merged function, and where
# copy-paste and merging cross over.
import inspect


def ceil_kg(grams):
    return (grams + 999) // 1000


def tariff(grams):  # the carrier's price list: real, shared knowledge (cents)
    return 500 + 120 * ceil_kg(grams)


# 1. Copy-paste: each case keeps its own copy of the tariff formula.
def retail_copy(grams, order, remote):
    if order >= 5000:
        return 0  # change 1: retail free shipping over 50.00
    return 500 + 120 * ceil_kg(grams) + (300 if remote else 0)  # change 2: retail remote-area surcharge


def wholesale_copy(grams):
    c = 500 + 120 * ceil_kg(grams)
    if grams > 20000:
        c -= 40 * ceil_kg(grams)  # change 3: wholesale pallet discount
    return c + (c * 8) // 100  # change 4: wholesale fuel surcharge of 8%


# 2. Merged: one function that serves both, so every difference became a flag.
def merged(grams, order, free_over, remote, pallet, fuel):
    c = tariff(grams)
    if free_over and order >= 5000:
        return 0
    if remote:
        c += 300
    if pallet and grams > 20000:
        c -= 40 * ceil_kg(grams)
    if fuel:
        c += (c * 8) // 100
    return c


# 3. Shared core, separate edges: only the price list is shared.
def retail_shared(grams, order, remote):
    return 0 if order >= 5000 else tariff(grams) + (300 if remote else 0)


def wholesale_shared(grams):
    c = tariff(grams) - (40 * ceil_kg(grams) if grams > 20000 else 0)
    return c + (c * 8) // 100


def n_params(f):
    return len(inspect.signature(f).parameters)


SHIPMENTS = [(2500, 3000, False), (800, 9000, False), (30000, 12000, True), (21500, 400, True)]
agree = True
for g, o, r in SHIPMENTS:
    a = [retail_copy(g, o, r), merged(g, o, True, r, False, False), retail_shared(g, o, r)]
    b = [wholesale_copy(g), merged(g, o, False, False, True, True), wholesale_shared(g)]
    if len(set(a)) > 1 or len(set(b)) > 1:
        agree = False
    print(f"{g} g, order {o}, remote {str(r).lower()}: retail {a[0]}, wholesale {b[0]}")
print(f"all three designs agree: {str(agree).lower()}")
print(f"parameters: copy-paste {n_params(retail_copy)} and {n_params(wholesale_copy)}, merged {n_params(merged)}, "
      f"shared core {n_params(retail_shared)} and {n_params(wholesale_shared)} (plus tariff {n_params(tariff)})")

# Part 2: a year of N change requests. Some concern both cases (the price list changes), the rest only one of them.
# copy-paste: a shared change is made twice (and a copy can be missed); a divergent one once.
# merged: the merge itself is 1 edit; a shared change is 1 edit; a divergent one is 2 (the new flag, and the call that sets it).
#         every divergent change adds one flag, and the flags can combine: 2^flags paths.
# shared core: extracting the core is 1 edit; every change is 1 edit, in the core or in one edge.
N = 20


def year(pct, design):
    d = N * pct // 100
    s = N - d
    if design == "copy":
        return {"edits": 2 * s + d, "flags": 0, "paths": 1, "risk": s}
    if design == "merged":
        return {"edits": 1 + s + 2 * d, "flags": d, "paths": 2 ** d, "risk": d}
    return {"edits": 1 + N, "flags": 0, "paths": 1, "risk": 0}


for pct in [0, 25, 50, 75, 100]:
    row = []
    for x in ["copy", "merged", "core"]:
        r = year(pct, x)
        row.append(f"{x} {r['edits']} edits, {r['flags']} flags, {r['paths']} paths, {r['risk']} risk")
    print(f"{pct}% divergent ({N * pct // 100} of {N}): {' | '.join(row)}")
