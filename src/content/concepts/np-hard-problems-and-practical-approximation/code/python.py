# The traveling salesman problem (shortest round trip through n cities) as the standard example of an NP-hard problem.
# Part 1: how many tours exist, and how long checking them all would take at an ASSUMED one billion tours per second.
# Part 2: the same instance of 6 to 10 fixed cities (Manhattan distance, integers) solved four ways, counted in steps (a step is
#         one city added to a partial tour, or one pair of edges examined by 2-opt): brute force over every order, branch and bound
#         (abandon a partial tour once it is as long as the best known), nearest neighbour, and nearest neighbour plus 2-opt.
# Look for: tours grow factorially; exact answers are cheap for small n and still cheaper with pruning; nearest neighbour is fast and
# lands above the optimum on this instance (the gap varies with the instance); a little local improvement closes part of it.
# BigInt (JavaScript), int (Python) and BigInteger (C#) keep the huge counts exact, so all three languages print the same digits.
import math

CITIES = [(77, 29), (81, 47), (15, 50), (49, 61), (16, 31), (92, 18), (65, 84), (52, 18), (67, 64), (75, 2)]


def dist(a, b):
    return abs(CITIES[a][0] - CITIES[b][0]) + abs(CITIES[a][1] - CITIES[b][1])


NS_PER_SECOND = 1000000000
SECONDS_PER_YEAR = 31536000
for n in [5, 10, 15, 20, 25]:
    tours = math.factorial(n - 1) // 2  # fix the start city; a tour and its reverse are the same round trip
    seconds = tours // NS_PER_SECOND
    print(f'n={n}: {tours} tours, {seconds} seconds, {seconds // SECONDS_PER_YEAR} years at one billion tours per second')
# Held-Karp dynamic programming (exact, no enumeration): about n^2 * 2^n steps and n * 2^n stored values. Better, still exponential.
for n in [10, 20, 30, 40]:
    states = n * 2 ** n
    print(f'n={n}: dynamic programming about {states * n} steps and {states} stored values')


def tour_length(order):
    return sum(dist(order[i], order[(i + 1) % len(order)]) for i in range(len(order)))


def brute_force(n):  # every order of cities 1..n-1 after city 0
    st = {'steps': 0, 'tours': 0, 'best': 10 ** 9}
    path = [0]
    used = [False] * n
    used[0] = True

    def extend(length):
        if len(path) == n:
            st['tours'] += 1
            st['best'] = min(st['best'], length + dist(path[n - 1], 0))
            return
        for c in range(1, n):
            if used[c]:
                continue
            st['steps'] += 1
            used[c] = True
            path.append(c)
            extend(length + dist(path[-2], c))
            path.pop()
            used[c] = False

    extend(0)
    return st['best'], st['steps'], st['tours']


def branch_and_bound(n, bound):  # the same search, but a partial tour at least as long as the best known is dropped
    st = {'steps': 0, 'best': bound}
    path = [0]
    used = [False] * n
    used[0] = True

    def extend(length):
        if length >= st['best']:
            return
        if len(path) == n:
            st['best'] = min(st['best'], length + dist(path[n - 1], 0))
            return
        for c in range(1, n):
            if used[c]:
                continue
            st['steps'] += 1
            used[c] = True
            path.append(c)
            extend(length + dist(path[-2], c))
            path.pop()
            used[c] = False

    extend(0)
    return st['best'], st['steps']


def nearest_neighbour(n):
    order = [0]
    used = [False] * n
    used[0] = True
    at = 0
    steps = 0
    for _ in range(1, n):
        pick = -1
        for c in range(n):
            if used[c]:
                continue
            steps += 1
            if pick < 0 or dist(at, c) < dist(at, pick):  # ties go to the lower city number
                pick = c
        used[pick] = True
        order.append(pick)
        at = pick
    return order, steps


def two_opt(start):  # reverse a stretch of the tour whenever that shortens it, until no reversal helps
    order = list(start)
    n = len(order)
    steps = moves = 0
    improved = True
    while improved:
        improved = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                steps += 1
                a, b, c, d = order[i - 1], order[i], order[j], order[(j + 1) % n]
                if dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d):
                    order[i:j + 1] = order[i:j + 1][::-1]
                    moves += 1
                    improved = True
    return order, steps, moves


for n in [6, 7, 8, 9, 10]:
    nn_order, nn_steps = nearest_neighbour(n)
    nn_len = tour_length(nn_order)
    opt_order, opt_steps, opt_moves = two_opt(nn_order)
    opt_len = tour_length(opt_order)
    best, bf_steps, bf_tours = brute_force(n)
    bb_best, bb_steps = branch_and_bound(n, nn_len + 1)
    if best != bb_best:
        raise Exception('exact methods disagree')
    print(f'n={n}: optimum {best}; brute force {bf_tours} tours, {bf_steps} steps; branch and bound {bb_steps} steps; '
          f'nearest neighbour {nn_len} ({nn_len * 100 // best}% of optimum, {nn_steps} steps); '
          f'with 2-opt {opt_len} ({opt_len * 100 // best}%, {opt_moves} moves, {opt_steps} steps)')
