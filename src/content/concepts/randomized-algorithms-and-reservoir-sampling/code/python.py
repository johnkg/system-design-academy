# Two uses of randomness, with a seeded generator so every run (and every language) prints the same numbers.
# Part 1: quicksort with the first element as pivot against a random pivot, counted in comparisons (one per element tested
#         against the pivot). Look for: sorted input is the worst case for the first-element pivot (n(n-1)/2 comparisons), while
#         a random pivot has no bad input, only bad luck: over 20 seeds on the same sorted input the count stays within a narrow band.
# Part 2: reservoir sampling (Algorithm R): keep k items from a stream of unknown length, using k cells. Look for: every item is
#         kept with the same chance k/n; a plausible-looking shortcut ("replace a random cell half the time") favours late items.
# The generator is the Park-Miller "minimal standard": x = x * 16807 mod 2147483647. The product stays below 2^53, so plain
# 64-bit floats (JavaScript), big integers (Python) and 64-bit integers (C#) all compute it exactly and agree.
MOD = 2147483647


def make_rng(seed):
    state = [seed]

    def rand(m):  # an integer in 0 .. m-1 (the tiny modulo bias is ignored here)
        state[0] = (state[0] * 16807) % MOD
        return state[0] % m

    return rand


def shuffled(n, seed):
    a = list(range(1, n + 1))
    rand = make_rng(seed)
    for i in range(n - 1, 0, -1):
        j = rand(i + 1)
        a[i], a[j] = a[j], a[i]
    return a


# Iterative quicksort (a sorted input would make the recursion n levels deep). Lomuto partition with the pivot moved to the front.
def quicksort(data, pivot_rule, seed):
    a = list(data)
    rand = make_rng(seed)
    comparisons = 0
    stack = [(0, len(a) - 1)]
    while stack:
        lo, hi = stack.pop()
        if lo >= hi:
            continue
        if pivot_rule == 'random':
            p = lo + rand(hi - lo + 1)
            a[lo], a[p] = a[p], a[lo]
        pivot = a[lo]
        i = lo
        for j in range(lo + 1, hi + 1):
            comparisons += 1
            if a[j] < pivot:
                i += 1
                a[i], a[j] = a[j], a[i]
        a[lo], a[i] = a[i], a[lo]
        stack.append((lo, i - 1))
        stack.append((i + 1, hi))
    for i in range(1, len(a)):
        if a[i - 1] > a[i]:
            raise Exception('not sorted')
    return comparisons


def sorted_input(n):
    return list(range(1, n + 1))


for n in [100, 1000, 10000]:
    print(f'quicksort, n={n}')
    print(f"  sorted input: first-element pivot {quicksort(sorted_input(n), 'first', 1)}, random pivot {quicksort(sorted_input(n), 'random', 1)} (n(n-1)/2 is {n * (n - 1) // 2})")
    print(f"  shuffled input: first-element pivot {quicksort(shuffled(n, 99), 'first', 1)}, random pivot {quicksort(shuffled(n, 99), 'random', 1)}")
lowest, highest, total = 10 ** 18, 0, 0
for seed in range(1, 21):
    c = quicksort(sorted_input(1000), 'random', seed)
    lowest = min(lowest, c)
    highest = max(highest, c)
    total += c
print(f'random pivot on sorted input, n=1000, seeds 1 to 20: lowest {lowest}, highest {highest}, mean {total // 20}')


# Reservoir sampling. rule 'reservoir': item i (0-based, after the first k) replaces cell j = rand(i+1) when j < k.
# rule 'naive': after the first k, replace a random cell with probability 1/2 (looks fair, is not). rule 'first': keep the first k.
def sample(n, k, rule, rand):
    cells = []
    writes = 0
    for i in range(n):
        item = i + 1
        if i < k:
            cells.append(item)
            writes += 1
            continue
        if rule == 'reservoir':
            j = rand(i + 1)
            if j < k:
                cells[j] = item
                writes += 1
        elif rule == 'naive':
            if rand(2) == 0:
                cells[rand(k)] = item
                writes += 1
    return cells, writes


trials, n, k = 10000, 10, 3
print(f'how often each of {n} items is kept in a sample of {k}, over {trials} runs (fair is {trials * k // n} each)')
for rule in ['reservoir', 'naive', 'first']:
    rand = make_rng(7)
    counts = [0] * n
    for _ in range(trials):
        for item in sample(n, k, rule, rand)[0]:
            counts[item - 1] += 1
    print(f"  {rule}: {' '.join(str(c) for c in counts)}")
for size in [1000, 1000000]:
    cells, writes = sample(size, 5, 'reservoir', make_rng(2024))
    print(f"one pass over {size} items, k=5: kept [{', '.join(str(c) for c in cells)}] after {writes} writes, using 5 cells instead of {size}")
