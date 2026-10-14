# A federation gateway's core in Python: plan a query across subgraphs, batch the entity fetches,
# reject expensive queries, and accept only persisted queries by hash.
import sys

# The supergraph: which subgraph owns each field, and whether it returns a list. Lists are assumed to hold 10 items when costing.
FIELDS = {
    'users': True,
    'friends': True,
    'orders': True,
    'product': False,
    'price': False,
}
MAX_DEPTH, MAX_COST, LIST_GUESS = 5, 500, 10
seed = 7

def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed >> 16) % n


# Subgraph data, keyed by entity id. Each subgraph only knows its own part.
users = list(range(20))
orders = []
for u in users:
    for _ in range(random(4)):
        orders.append({'id': len(orders), 'user_id': u, 'product_id': random(8)})
prices = [10 + ((i * 37) % 90) for i in range(8)]

def make_subgraphs(calls):
    def hit(name):
        calls[name] = calls.get(name, 0) + 1

    def users_sg():
        hit('users')
        return list(users)

    def orders_sg(user_ids):  # one batch call, answers in key order
        hit('orders')
        return [[o for o in orders if o['user_id'] == i] for i in user_ids]

    def products_sg(ids):
        hit('products')
        return [{'id': i, 'price': prices[i]} for i in ids]

    return users_sg, orders_sg, products_sg


# Run the chain users -> orders -> product -> price. With batch, each level makes one call; without it, one call per parent.
def execute(batch):
    calls = {}
    users_sg, orders_sg, products_sg = make_subgraphs(calls)
    user_ids = users_sg()
    per_user = orders_sg(user_ids) if batch else [orders_sg([i])[0] for i in user_ids]
    every = [o for group in per_user for o in group]
    if batch:
        keys = list(dict.fromkeys(o['product_id'] for o in every))
        found = products_sg(keys)
    else:
        found = [products_sg([o['product_id']])[0] for o in every]
    price_of = {p['id']: p['price'] for p in found}
    return calls, sum(price_of[o['product_id']] for o in every)


# Analyse a query (a chain of field names) before running it: depth, and cost = number of objects it could touch.
def analyse(path):
    mult, cost = 1, 0
    for f in path:
        if FIELDS[f]:
            mult *= LIST_GUESS
        cost += mult
    verdict = 'too deep' if len(path) > MAX_DEPTH else 'too costly' if cost > MAX_COST else 'ok'
    return len(path), cost, verdict

def fnv1a(text):
    h = 2166136261
    for c in text:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h


hexed = lambda h: f'{h:08x}'

def fmt(calls):
    return '{' + ','.join(f'"{k}":{v}' for k, v in calls.items()) + '}'

good = ['users', 'orders', 'product', 'price']
attack = ['users', 'friends', 'friends', 'friends', 'friends', 'friends']
wide = ['users', 'friends', 'friends', 'friends']
allowed = {hexed(fnv1a('.'.join(good)))}  # the persisted-query registry, filled at deploy time

def gate(h):
    return 'allowed' if h in allowed else 'unknown hash, rejected'


naive_calls, naive_total = execute(False)
batched_calls, batched_total = execute(True)
print(f'orders: {len(orders)} across {len(users)} users')
print(f'naive calls: {fmt(naive_calls)}')
print(f'batched calls: {fmt(batched_calls)}')
print(f'sum of prices: naive {naive_total}, batched {batched_total}')
for name, q in [('good', good), ('wide', wide), ('attack', attack)]:
    depth, cost, verdict = analyse(q)
    h = hexed(fnv1a('.'.join(q)))
    print(f'{name}: depth {depth}, cost {cost}, {verdict}, hash {h} {gate(h)}')
same = naive_total == batched_total
fewer = batched_calls['orders'] == 1 and batched_calls['products'] == 1 and naive_calls['orders'] == len(users)
print(f'same result: {"true" if same else "false"}; batching holds: {"true" if fewer else "false"}')
if not same or not fewer or analyse(good)[2] != 'ok' or analyse(attack)[2] == 'ok':
    sys.exit(1)
