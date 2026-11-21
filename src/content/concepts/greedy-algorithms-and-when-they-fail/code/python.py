# Greedy algorithms: where "take the best-looking choice now" is provably right, and where it quietly is not.
# Operations are counted with an explicit counter (comparisons and candidate checks), not time.
# Four experiments, all deterministic:
#   1. interval scheduling (most non-overlapping jobs): sorting by earliest FINISH is optimal; two other "sensible" rules are not
#   2. weighted interval scheduling: the same earliest-finish rule is now wrong; dynamic programming is right
#   3. coin change: greedy is optimal for 1, 5, 10, 25 and wrong for 1, 3, 4, and for 1, 7, 10; but it is far cheaper
#   4. knapsack: greedy by value per weight is a heuristic with no guarantee, close here but not exact
# Look for: the gap between what a greedy rule picks and the true optimum, and the price of finding the optimum.

M = 2147483647  # Park-Miller generator, so every language produces the same numbers


class Rng:
    def __init__(self, seed):
        self.s = seed

    def next(self):
        self.s = self.s * 48271 % M
        return self.s


# Merge sort over job indices by a key, counting every key comparison (stable: equal keys keep their order).
def sort_by(keys, counter):
    def merge_sort(idx):
        if len(idx) <= 1:
            return idx
        mid = len(idx) // 2
        left, right = merge_sort(idx[:mid]), merge_sort(idx[mid:])
        out, i, j = [], 0, 0
        while i < len(left) and j < len(right):
            counter[0] += 1
            if keys[left[i]] <= keys[right[j]]:
                out.append(left[i])
                i += 1
            else:
                out.append(right[j])
                j += 1
        return out + left[i:] + right[j:]

    return merge_sort(list(range(len(keys))))


def make_jobs(n):
    rng = Rng(777)
    jobs = []
    for _ in range(n):
        s = rng.next() % (4 * n)
        length = 1 + rng.next() % 40
        jobs.append((s, s + length))  # half-open interval [start, end)
    return jobs


# Greedy: sort by the rule's key, then take every job that does not overlap a job already taken.
# For "finish" and "start" the jobs arrive in time order, so comparing with the last job taken is enough;
# "shortest" arrives in any time order, so each job is compared with every job taken so far.
def schedule(jobs, rule):
    keys = [{"finish": e, "start": s, "shortest": e - s}[rule] for s, e in jobs]
    counter = [0]
    order = sort_by(keys, counter)
    chosen, last_end = [], -1
    for i in order:
        if rule == "shortest":
            ok = True
            for j in chosen:
                counter[0] += 1
                if jobs[i][0] < jobs[j][1] and jobs[j][0] < jobs[i][1]:
                    ok = False
                    break
            if ok:
                chosen.append(i)
        else:
            counter[0] += 1
            if jobs[i][0] >= last_end:
                chosen.append(i)
                last_end = jobs[i][1]
    return len(chosen), counter[0]


def brute_force(jobs):
    n, best = len(jobs), 0
    for mask in range(1 << n):
        chosen = [jobs[i] for i in range(n) if mask >> i & 1]
        if len(chosen) <= best:
            continue
        chosen.sort()
        if all(chosen[k][1] <= chosen[k + 1][0] for k in range(len(chosen) - 1)):
            best = len(chosen)
    return best


print("-- interval scheduling: most non-overlapping jobs (jobs chosen, operations)")
for n in [10, 100, 1000]:
    jobs = make_jobs(n)
    f, s, sh = schedule(jobs, "finish"), schedule(jobs, "start"), schedule(jobs, "shortest")
    print(f"  n={n}: earliest finish {f[0]} ({f[1]} ops), earliest start {s[0]} ({s[1]} ops), shortest first {sh[0]} ({sh[1]} ops)")
small = make_jobs(14)
print(f"  brute force over 2^14 = {1 << 14} subsets of 14 jobs: best {brute_force(small)}, earliest finish {schedule(small, 'finish')[0]}, earliest start {schedule(small, 'start')[0]}, shortest first {schedule(small, 'shortest')[0]}")


# Weighted jobs: maximise total weight. Greedy rules against dynamic programming over jobs sorted by finish time.
def weighted(n):
    jobs = make_jobs(n)
    rng = Rng(999)
    w = [1 + rng.next() % 20 for _ in range(n)]
    # greedy A: earliest finish, weights ignored
    taken, _ = schedule(jobs, "finish")
    counter = [0]
    order = sort_by([e for s, e in jobs], counter)
    last, total_a = -1, 0
    for i in order:
        if jobs[i][0] >= last:
            total_a += w[i]
            last = jobs[i][1]
    # greedy B: heaviest first, skip any job that overlaps one already taken
    ops_b = [0]
    order_b = sort_by([1000 - x for x in w], ops_b)
    chosen, total_b = [], 0
    for i in order_b:
        ok = True
        for j in chosen:
            ops_b[0] += 1
            if jobs[i][0] < jobs[j][1] and jobs[j][0] < jobs[i][1]:
                ok = False
                break
        if ok:
            chosen.append(i)
            total_b += w[i]
    # dynamic programming: best[k] = best total using the first k jobs in finish order
    ops_dp = [counter[0]]
    ends = [jobs[i][1] for i in order]
    best = [0] * (n + 1)
    for k in range(1, n + 1):
        s, e = jobs[order[k - 1]]
        lo, hi = 0, k - 1  # how many earlier jobs (in finish order) end at or before this job's start
        while lo < hi:
            ops_dp[0] += 1
            mid = (lo + hi) // 2
            if ends[mid] <= s:
                lo = mid + 1
            else:
                hi = mid
        p = lo
        ops_dp[0] += 1
        best[k] = max(best[k - 1], w[order[k - 1]] + best[p])
    return total_a, total_b, best[n], ops_b[0], ops_dp[0]


print("-- weighted interval scheduling: total weight (greedy rules against dynamic programming)")
for n in [10, 100, 1000]:
    a, b, opt, ops_b, ops_dp = weighted(n)
    print(f"  n={n}: earliest finish ignoring weights {a}, heaviest first {b} ({ops_b} ops after sorting), optimal {opt} ({ops_dp} ops)")
tiny = [(0, 10), (0, 5), (5, 10)]
print("  tiny case: jobs [0,10) weight 10, [0,5) weight 1, [5,10) weight 1: earliest finish takes the two small jobs for weight 2, the optimum is 10")


def greedy_coins(coins, amount):
    used, ops = 0, 0
    for c in sorted(coins, reverse=True):
        ops += 1
        used += amount // c
        amount %= c
    return (used if amount == 0 else -1), ops


def best_coins(coins, upto):
    table, ops = [0], 0
    for a in range(1, upto + 1):
        best = 10**9
        for c in coins:
            ops += 1
            if c <= a and table[a - c] + 1 < best:
                best = table[a - c] + 1
        table.append(best)
    return table, ops


print("-- coin change: greedy against the optimum for every amount from 1 to 1000")
for coins in [[1, 5, 10, 25], [1, 3, 4], [1, 7, 10], [1, 5, 12], [1, 5, 10, 20, 25]]:
    table, _ = best_coins(coins, 1000)
    bad = [a for a in range(1, 1001) if greedy_coins(coins, a)[0] != table[a]]
    worst = max([greedy_coins(coins, a)[0] - table[a] for a in bad], default=0)
    first = bad[0] if bad else 0
    label = ",".join(map(str, coins))
    print(f"  coins {{{label}}}: greedy wrong for {len(bad)} of 1000 amounts, first at {first if bad else 'none'}, worst excess {worst} coins")
print("  the price of the optimum: amount 100000 with coins {1,5,10,25}")
g_used, g_ops = greedy_coins([1, 5, 10, 25], 100000)
_, dp_ops = best_coins([1, 5, 10, 25], 100000)
print(f"  greedy {g_used} coins in {g_ops} steps, table method {dp_ops} steps")


# Knapsack, 0/1: items have an integer weight and value; greedy takes items by value per weight while they fit.
def knapsack(n):
    items = [(5 + (i * 7) % 23, 10 + (i * 11) % 37) for i in range(n)]  # (weight, value)
    cap = sum(w for w, v in items) // 3
    ops = [0]
    order = list(range(n))
    # insertion sort by value/weight descending using cross-multiplication (integers only), counted
    for i in range(1, n):
        j = i
        while j > 0:
            ops[0] += 1
            a, b = items[order[j - 1]], items[order[j]]
            if a[1] * b[0] < b[1] * a[0]:
                order[j - 1], order[j] = order[j], order[j - 1]
                j -= 1
            else:
                break
    room, total = cap, 0
    for i in order:
        ops[0] += 1
        if items[i][0] <= room:
            room -= items[i][0]
            total += items[i][1]
    best = [0] * (cap + 1)
    dp_ops = 0
    for w, v in items:
        for c in range(cap, w - 1, -1):
            dp_ops += 1
            best[c] = max(best[c], best[c - w] + v)
    return cap, total, best[cap], ops[0], dp_ops


print("-- 0/1 knapsack: greedy by value per weight against the optimum (capacity is a third of the total weight)")
for n in [10, 20, 40, 80]:
    cap, g, opt, g_ops, dp_ops = knapsack(n)
    print(f"  n={n}: capacity {cap}, greedy value {g}, optimal {opt}, greedy {g_ops} ops, table method {dp_ops} ops")
