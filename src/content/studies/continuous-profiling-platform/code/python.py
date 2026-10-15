# A tiny continuous-profiling backend, in Python:
# samples of call stacks are interned by an FNV-1a hash, counted, folded into flame-graph paths and diffed across two releases.

# Rate control: the sampling frequency that keeps profiler overhead within a budget (in permille of one core).
# One second of one core is 1,000,000 microseconds, so a budget of b permille allows b * 1000 microseconds of sampling work per second.
def choose_hz(budget_permille, cost_us):
    return min(100, (budget_permille * 1000) // cost_us)


def fnv1a(text):  # 32-bit FNV-1a over ASCII text
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


class Store:
    def __init__(self):
        self.stacks = {}  # stack id -> frames (kept once, however many samples use it)

    def intern(self, frames):
        stack_id = fnv1a(";".join(frames))
        known = self.stacks.get(stack_id)
        if known is not None and known != frames:
            raise RuntimeError("hash collision")
        if known is None:
            self.stacks[stack_id] = frames
        return stack_id


class Profile:
    def __init__(self, store):
        self.store = store
        self.counts = {}  # stack id -> samples
        self.total = 0

    def add(self, frames):
        stack_id = self.store.intern(frames)
        self.counts[stack_id] = self.counts.get(stack_id, 0) + 1
        self.total += 1

    def flame(self):  # a flame graph is the number of samples whose stack starts with each path
        paths = {}
        for stack_id, n in self.counts.items():
            frames = self.store.stacks[stack_id]
            for d in range(1, len(frames) + 1):
                p = ";".join(frames[:d])
                paths[p] = paths.get(p, 0) + n
        return paths


# Weights of each call stack in two releases. The new release spends more time encoding JSON.
MIX = [(s.split(";"), a, b) for s, a, b in [
    ("main;handle;parse_json", 30, 30), ("main;handle;auth;verify_token", 20, 20), ("main;handle;render;json_encode", 15, 40),
    ("main;handle;db_query;wait", 25, 25), ("main;gc", 10, 10)]]

seed = 7


def next_int(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


def collect(store, column, samples):
    profile = Profile(store)
    total = sum(m[column] for m in MIX)
    for _ in range(samples):
        r, k = next_int(total), 0
        while r >= MIX[k][column]:
            r -= MIX[k][column]
            k += 1
        profile.add(MIX[k][0])
    return profile


print("; ".join(f"cost {c}us -> {choose_hz(10, c)} Hz" for c in [100, 250, 1000]))
store = Store()
before, after = collect(store, 1, 20000), collect(store, 2, 20000)
print(f"samples {before.total + after.total}, distinct stacks {len(store.stacks)}")

flame = after.flame()
print("flame graph of the new release:")
for p, n in sorted(flame.items(), key=lambda e: (-e[1], e[0]))[:4]:
    print(f"  {n} {p}")

# Diff: compare shares in parts per 10,000, so two ranges with different sample counts can be compared.
fa = before.flame()
diff = [(p, n * 10000 // after.total - fa.get(p, 0) * 10000 // before.total) for p, n in flame.items()]
diff.sort(key=lambda e: (-e[1], e[0]))
print("biggest share increases:")
for p, d in diff[:3]:
    print(f"  +{d} {p}")

root_ok = flame["main"] == after.total and fa["main"] == before.total
worst = next(d for p, d in diff if p.endswith("json_encode"))
print(f"root equals samples: {str(root_ok).lower()}; json_encode regression found: {str(worst > 1000).lower()}")
if not root_ok or worst <= 1000 or choose_hz(10, 250) != 40:
    raise SystemExit(1)
