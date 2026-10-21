# A property graph with adjacency lists, in Python:
# every node holds a direct list of its neighbours, so a hop is a list read. Supernodes are not expanded, and a hash splits nodes over shards.
import sys

SHARDS = 4
INF = float('inf')


def shard_of(node_id):
    """Knuth's multiplicative hash (2654435761 is about 2^32 / golden ratio)."""
    return (((node_id * 2654435761) & 0xFFFFFFFF) >> 16) % SHARDS  # the high bits of the product are well mixed


class Graph:
    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.props = [{'name': f'user{i}'} for i in range(n)]
        self.edges = []

    def add_edge(self, a, b):
        self.adj[a].append(b)
        self.adj[b].append(a)  # a friendship is stored on both ends
        self.edges.append((a, b))

    def degree(self, node_id):
        return len(self.adj[node_id])

    # Breadth-first walk of k hops. A node with more than `cap` neighbours is reached but not expanded.
    def walk(self, start, k, cap):
        seen = {start}
        frontier = [start]
        examined = 0
        cross = 0
        levels = []
        for _ in range(k):
            nxt = []
            for u in frontier:
                if self.degree(u) > cap:  # do not open a supernode
                    continue
                for v in self.adj[u]:
                    examined += 1
                    if shard_of(u) != shard_of(v):  # this step would be a network call
                        cross += 1
                    if v not in seen:
                        seen.add(v)
                        nxt.append(v)
            levels.append(len(nxt))
            frontier = nxt
        return {'levels': levels, 'seen': seen, 'examined': examined, 'cross': cross}


SEED, FRIENDS_PER_USER, START, HOPS, DEGREE_CAP = 7, 3, 5, 3, 50
seed = SEED


def random_below(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


N = 400
graph = Graph(N)
for i in range(1, N):
    graph.add_edge(0, i)  # node 0 is a celebrity that everyone follows
for i in range(1, N):
    for _ in range(FRIENDS_PER_USER):
        b = 1 + random_below(N - 1)
        if b != i:
            graph.add_edge(i, b)

max_degree = max(len(a) for a in graph.adj)
median = sorted(len(a) for a in graph.adj)[N >> 1]
print(f'nodes {N}, edges {len(graph.edges)}, supernode degree {graph.degree(0)}, median degree {median}')


def show(label, r):
    print(f"{label}: new nodes per hop [{', '.join(str(x) for x in r['levels'])}], reached {len(r['seen'])}, edges examined {r['examined']}, cross-shard {r['cross']}")


full = graph.walk(START, HOPS, INF)
capped = graph.walk(START, HOPS, DEGREE_CAP)
show('3 hops, expand everything ', full)
show('3 hops, skip nodes over 50', capped)

# Check the walk against the slow way: scan the whole edge list once per hop.
reach = {START}
for _ in range(HOPS):
    grown = set(reach)
    for a, b in graph.edges:
        if a in reach:
            grown.add(b)
        if b in reach:
            grown.add(a)
    reach = grown
same = reach == full['seen']
saved = (100 * (full['examined'] - capped['examined'])) // full['examined']
print(f"matches the edge-list scan: {str(same).lower()}; the cap saves {saved}% of the edge reads; max degree {max_degree}")
if not same or capped['examined'] >= full['examined'] or max_degree != graph.degree(0):
    sys.exit(1)
