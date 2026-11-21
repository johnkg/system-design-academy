# Hidden complexity in loops: four jobs that look like one loop, each done the naive way and the fixed way.
# Steps are counted by an explicit model, not timed. A step is one comparison, one element moved or one character copied.
# Where a language's own library would hide the cost (`x in list`, `s += piece`, `list.pop(0)`), the loop below is written out
# by hand so the counter sees what the runtime does underneath (real runtimes may optimise some of these cases).
PIECE = 4  # characters in one piece of the string being built


def find_duplicates_naive(ids):  # `if x in seen_list` scans the list on every item
    steps = 0
    seen = []
    for x in ids:
        for s in seen:
            steps += 1
            if s == x:
                break
        seen.append(x)
        steps += 1
    return steps


def find_duplicates_fixed(ids):  # a hash set: one lookup and one insert per item (average case, 1 step each)
    steps = 0
    seen = set()
    for x in ids:
        steps += 1
        _ = x in seen
        steps += 1
        seen.add(x)
    return steps


def build_string_naive(n):  # s = s + piece copies the whole growing string each time (in many languages, typically)
    steps = 0
    length = 0
    for _ in range(n):
        steps += length + PIECE
        length += PIECE
    return steps


def build_string_fixed(n):  # collect the pieces, then join once: every character is copied one time
    steps = 0
    parts = []
    for i in range(n):
        parts.append(i)
        steps += 1
    return steps + n * PIECE


def drain_from_front_naive(n):  # remove(0) on an array shifts every later element one place left
    steps = 0
    a = list(range(n))
    while len(a) > 0:
        for i in range(1, len(a)):
            a[i - 1] = a[i]
            steps += 1
        a.pop()
        steps += 1
    return steps


def drain_from_front_fixed(n):  # a queue (deque, linked list or ring buffer) takes from the front in one step
    steps = 0
    head = 0
    a = list(range(n))
    while head < len(a):
        head += 1
        steps += 1
    return steps


def lookup_per_row_naive(n):  # for each row, scan the table for its key (rows come in table order)
    steps = 0
    table = list(range(n))
    for row in range(n):
        for key in table:
            steps += 1
            if key == row:
                break
    return steps


def lookup_per_row_fixed(n):  # build a dictionary once, then one lookup per row
    steps = 0
    d = {}
    for i in range(n):
        d[i] = i
        steps += 1
    for row in range(n):
        _ = d[row]
        steps += 1
    return steps


def dup(n):
    ids = [i * 3 + 1 for i in range(n)]
    return find_duplicates_naive(ids), find_duplicates_fixed(ids)


tasks = [
    ("find duplicates", dup, lambda n: n * (n - 1) // 2 + n),
    ("build a string", lambda n: (build_string_naive(n), build_string_fixed(n)), lambda n: PIECE * n * (n + 1) // 2),
    ("drain from front", lambda n: (drain_from_front_naive(n), drain_from_front_fixed(n)), lambda n: n * (n + 1) // 2),
    ("lookup per row", lambda n: (lookup_per_row_naive(n), lookup_per_row_fixed(n)), lambda n: n * (n + 1) // 2),
]
for n in [10, 100, 1000]:
    print(f"n={n}")
    for name, run, formula in tasks:
        naive, fixed = run(n)
        if naive != formula(n):
            raise Exception(f"model mismatch for {name}")
        print(f"  {name}: naive {naive} steps, fixed {fixed} steps, {naive // fixed}x")
for name, _, formula in tasks:
    n = 1
    while formula(n) < 1000000000:
        n += 1
    print(f"{name}: the naive version passes 1000000000 steps at n = {n}")
