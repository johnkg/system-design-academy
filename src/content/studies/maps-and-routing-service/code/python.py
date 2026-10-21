# A road grid in Python: Dijkstra and A* find the same cheapest route, but A* settles far fewer cells.
# Each cell takes 2 or 3 minutes to cross, about one cell in eight is blocked, and a jam can make cells slower.
import heapq
import sys

W, H, MIN_COST = 24, 16, 2
START, GOAL = 8 * W + 2, 8 * W + 21
WALL_ONE_IN = 8  # one cell in 8 is a wall
JAM_X0 = 8  # the jammed area: columns 8..15, rows 4..11
JAM_X1 = 16
JAM_Y0 = 4
JAM_Y1 = 12
JAM_FACTOR = 3  # jammed cells cost three times as much
INF = 10**9

seed = 7


def next_random():
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed // 65536


def make_grid():
    cost = []  # cost[cell] = minutes to enter the cell, or 0 for a wall
    for _ in range(W * H):
        wall = next_random() % WALL_ONE_IN == 0
        cost.append(0 if wall else MIN_COST + next_random() % 2)
    cost[START] = MIN_COST
    cost[GOAL] = MIN_COST  # start and goal are always open
    return cost


# With use_estimate off this is Dijkstra. With it on, the straight-line (block) distance times the cheapest
# cell cost never overestimates, so the answer stays exact. The heap orders by (priority, cell), so ties break the same way everywhere.
def route(cost, start, goal, use_estimate):
    gx, gy = goal % W, goal // W

    def estimate(c):
        return (abs(c % W - gx) + abs(c // W - gy)) * MIN_COST if use_estimate else 0

    best = [INF] * (W * H)
    prev = [-1] * (W * H)
    done = [False] * (W * H)
    best[start] = 0
    heap = [(estimate(start), start)]
    settled = 0
    while heap:
        _, c = heapq.heappop(heap)
        if done[c]:
            continue
        done[c] = True
        settled += 1
        if c == goal:
            break
        x, y = c % W, c // W
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= W or ny >= H:
                continue
            n = ny * W + nx
            if cost[n] == 0:
                continue
            if best[c] + cost[n] < best[n]:
                best[n] = best[c] + cost[n]
                prev[n] = c
                heapq.heappush(heap, (best[n] + estimate(n), n))
    path = []
    c = goal
    while c != -1:
        path.append(c)
        c = prev[c]
    path.reverse()
    return best[goal], settled, path


def path_cost(cost, path):
    return sum(cost[c] for c in path[1:])


def compare(label, cost):
    d_cost, d_settled, d_path = route(cost, START, GOAL, False)
    a_cost, a_settled, a_path = route(cost, START, GOAL, True)
    open_cells = sum(1 for c in cost if c > 0)
    print(f"{label}: Dijkstra cost {d_cost}, settled {d_settled} of {open_cells} cells")
    print(f"{label}: A* cost {a_cost}, settled {a_settled} ({100 * a_settled // d_settled}% of Dijkstra)")
    same = d_cost == a_cost and path_cost(cost, d_path) == d_cost and path_cost(cost, a_path) == a_cost
    print(f"{label}: same cost and both paths add up: {'true' if same else 'false'}")
    if not same or a_settled > d_settled or d_cost == INF:
        sys.exit(1)
    return a_cost


cost = make_grid()
before = compare("free-flowing", cost)

# A jam: every cell in the middle block takes three times as long. The estimate still never overestimates, so A* stays exact.
jammed = [c * JAM_FACTOR if c > 0 and JAM_X0 <= i % W < JAM_X1 and JAM_Y0 <= i // W < JAM_Y1 else c for i, c in enumerate(cost)]
after = compare("with a jam", jammed)
print(f"the jam adds {after - before} minutes to the trip")
if after < before:
    sys.exit(1)
