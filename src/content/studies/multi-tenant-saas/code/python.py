# A multi-tenant store in Python: a tenant directory routes each tenant to a shard, one big tenant gets its own shard,
# a query that forgets the tenant filter leaks rows unless row-level security is on, and a fair queue protects small tenants.
import sys


def fnv(s):
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h


names = ['acme', 'globex', 'initech', 'umbrella', 'hooli', 'stark', 'wayne', 'wonka']
POOLED, DEDICATED = 3, 3  # shards 0..2 are shared; shard 3 belongs to the big tenant
directory = {t: DEDICATED if t == 'acme' else fnv(t) % POOLED for t in names}  # tenant -> shard

SEED, BIG_TENANT_ROWS, SMALL_MIN_ROWS, SMALL_ROW_SPREAD = 7, 40, 4, 5  # small tenants have 4..8 rows
MIN_AMOUNT, AMOUNT_SPREAD = 10, 990
seed = SEED


def rnd(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


shards = [[], [], [], []]
next_id = 1
for t in names:
    count = BIG_TENANT_ROWS if t == 'acme' else SMALL_MIN_ROWS + rnd(SMALL_ROW_SPREAD)
    for _ in range(count):
        shards[directory[t]].append({'id': next_id, 'tenant': t, 'amount': MIN_AMOUNT + rnd(AMOUNT_SPREAD)})
        next_id += 1


# The right query always filters by tenant. The buggy one forgets, and returns the whole shard.
def list_safe(t):
    return [r for r in shards[directory[t]] if r['tenant'] == t]


def list_buggy(t):
    return list(shards[directory[t]])


# Row-level security: the database applies the policy to every query, whatever the query says.
def with_rls(session, query):
    return [r for r in query(session) if r['tenant'] == session]


def leaked(rows, t):
    return sum(1 for r in rows if r['tenant'] != t)


# One worker does one job per tick. FIFO serves jobs in arrival order; the fair queue takes one job per tenant in turn.
def finish(counts, fair):
    done, tick = {}, 0
    if not fair:
        for t in counts:
            tick += counts[t]
            done[t] = tick
        return done
    left = dict(counts)
    while any(n > 0 for n in left.values()):
        for t in left:
            if left[t] > 0:
                tick += 1
                left[t] -= 1
                if left[t] == 0:
                    done[t] = tick
    return done


# Moving a tenant: copy its rows, switch the directory entry, delete the old copy.
def move_tenant(t, to):
    src = directory[t]
    rows = [r for r in shards[src] if r['tenant'] == t]
    shards[to].extend(rows)
    shards[src] = [r for r in shards[src] if r['tenant'] != t]
    directory[t] = to
    return len(rows)


def lower(b):
    return 'true' if b else 'false'


print('directory: ' + ' '.join(f'{t}->{directory[t]}' for t in names))
print('rows per shard: ' + ' '.join(str(len(s)) for s in shards))
safe_ok = all(leaked(list_safe(t), t) == 0 for t in names)
print(f'filtered query leaks nothing: {lower(safe_ok)}')
bug_leak = sum(leaked(list_buggy(t), t) for t in names)
rls_leak = sum(leaked(with_rls(t, list_buggy), t) for t in names)
print(f'missing filter leaks {bug_leak} rows; with row-level security it leaks {rls_leak}')

counts = {'acme': 30, 'globex': 3, 'initech': 3}
fifo, fair = finish(counts, False), finish(counts, True)
print(f"last job done: fifo globex {fifo['globex']} initech {fifo['initech']}; fair globex {fair['globex']} initech {fair['initech']}")

before = len(list_safe('globex'))
src = directory['globex']
dst = (src + 1) % POOLED
moved = move_tenant('globex', dst)
print(f"moved globex from shard {src} to shard {dst}: {moved} rows, now {len(list_safe('globex'))}")
if not safe_ok or bug_leak == 0 or rls_leak != 0 or fair['globex'] >= fifo['globex'] or moved != before or len(list_safe('globex')) != before:
    sys.exit(1)
