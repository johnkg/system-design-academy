# A miniature of three ideas from Shopify's flash-sale posts, in Python (a teaching model, not Shopify's code or data):
# 1. pods: every request goes to exactly one pod, so one broken pod does not break the other shops,
# 2. a fair checkout queue: a threshold on arrival order that is corrected each tick by the unused room in the bucket,
# 3. protecting a slow dependency: a limit on workers waiting on it, and a circuit breaker.
# Everything is deterministic and uses whole numbers, so every run prints the same thing.
import sys

# ---- 1. Pods ----
pod_of = {'shop-a': 1, 'shop-b': 1, 'shop-c': 2, 'shop-d': 2, 'shop-e': 3}  # the "Sorting Hat" rules, as a table
pods_down = {2}

print('== Pods: pod 2 loses its database ==')
for shop, pod in pod_of.items():
    print(f"{shop} -> pod {pod}: {'unavailable' if pod in pods_down else 'ok'}")
shops = list(pod_of)
served = len([s for s in shops if pod_of[s] not in pods_down])
print(f'shops served: {served} of {len(shops)}')
# Without pods, an action that visits every shard fails for everyone as soon as one shard is down.
print(f"an action that needs every pod: {len(shops) if not pods_down else 0} of {len(shops)}")

# ---- 2. A fair checkout queue ----
# Buyers 1..10 arrive in that order. Each tick the bucket lets LIMIT buyers through. The threshold is an arrival
# number: only buyers at or below it may try the bucket. Each tick it moves by the room left, a proportional-only correction.
print('== Fair queue: limit 3 per tick ==')
LIMIT = 3
waiting = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
threshold = 0
admitted = []
for tick in range(1, 5):
    if tick == 2:
        waiting = [n for n in waiting if n not in (4, 7)]  # buyers 4 and 7 give up and stop polling
    eligible = len([n for n in waiting if n <= threshold])
    threshold += LIMIT - eligible
    let_in = [n for n in waiting if n <= threshold][:LIMIT]
    waiting = [n for n in waiting if n not in let_in]
    admitted += let_in
    print(f"tick {tick}: threshold {threshold}, let in {','.join(map(str, let_in))}, still waiting {len(waiting)}")
fair = all(admitted[i - 1] < admitted[i] for i in range(1, len(admitted)))

# ---- 3. A slow dependency ----
TIMEOUT = 10  # time units a worker is stuck on a call that never answers
print('== Slow session store: 8 workers call it at once ==')
WORKERS, PERMITS = 8, 2
unguarded = WORKERS * TIMEOUT
guarded = PERMITS * TIMEOUT  # the rest are refused at once and use the guest fallback
print(f'no limit: {unguarded} worker time lost')
print(f'limit of {PERMITS} at a time: {guarded} worker time lost, {WORKERS - PERMITS} served at once as guests')

print('== Circuit breaker: 6 calls in a row to a dead store ==')
OPEN_AFTER = 2
failures = 0
lost = 0
for call in range(1, 7):
    if failures >= OPEN_AFTER:
        print(f'call {call}: circuit open, refused at once')
        continue
    failures += 1
    lost += TIMEOUT
    print(f'call {call}: waited {TIMEOUT}, failed')
print(f'time lost: {lost} instead of {6 * TIMEOUT}')

ok = served == 3 and fair and len(admitted) == 8 and guarded == 20 and lost == 20
print(f"checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
