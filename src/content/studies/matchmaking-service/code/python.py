# A skill-based matchmaking queue in Python:
# every waiting player has a search window around their rating that widens each second, and two players match
# when their rating gap fits inside both windows. We compare a fixed window with a widening one.
import sys

seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# Ratings come from the sum of three dice, so most players are near the middle and a few are far out.
def make_ratings(count):
    return [400 + random(600) + random(600) + random(600) for _ in range(count)]


# The window is the base plus a step for each second waited, up to a cap. A step of 0 gives a fixed window.
def window_of(policy, waited):
    return min(policy['cap'], policy['base'] + policy['step'] * waited)


def simulate(policy, ratings, arrival_seconds, drain_seconds):
    queue = []  # waiting tickets, oldest first
    stats = {'matched': 0, 'gap_sum': 0, 'wait_sum': 0, 'max_wait': 0}
    for now in range(arrival_seconds + drain_seconds):
        if now < arrival_seconds:
            queue.append({'id': now, 'rating': ratings[now], 'since': now})  # one player joins each second
        taken = set()
        for a in queue:  # oldest first, so nobody waits behind a newcomer
            if a['id'] in taken:
                continue
            wa = window_of(policy, now - a['since'])
            best = None
            for b in queue:
                if b['id'] == a['id'] or b['id'] in taken:
                    continue
                gap = abs(a['rating'] - b['rating'])
                fits = gap <= wa and gap <= window_of(policy, now - b['since'])  # both players must accept the gap
                if fits and (best is None or gap < best[1]):
                    best = (b, gap)
            if best is None:
                continue
            b, gap = best
            taken.add(a['id'])
            taken.add(b['id'])
            waits = [now - a['since'], now - b['since']]
            stats['matched'] += 1
            stats['gap_sum'] += gap
            stats['wait_sum'] += waits[0] + waits[1]
            stats['max_wait'] = max(stats['max_wait'], *waits)
            if gap > min(window_of(policy, waits[0]), window_of(policy, waits[1])):
                raise RuntimeError('gap outside a window')
        queue = [t for t in queue if t['id'] not in taken]
    stats['left'] = len(queue)
    return stats


# How wide the widening window is after a few waits, so the reader can see the schedule.
def schedule(policy):
    return ' '.join(f'{w}s:{window_of(policy, w)}' for w in [0, 5, 20, 40])


ratings = make_ratings(600)
policies = [
    {'name': 'fixed', 'base': 25, 'step': 0, 'cap': 25},
    {'name': 'widening', 'base': 25, 'step': 10, 'cap': 400},
]
results = [(p, simulate(p, ratings, 600, 120)) for p in policies]
for p, r in results:
    avg_gap = r['gap_sum'] // r['matched']
    avg_wait = r['wait_sum'] // (2 * r['matched'])
    print(f"{p['name']}: {r['matched']} matches, {r['left']} players left, average gap {avg_gap}, average wait {avg_wait}s, longest wait {r['max_wait']}s")
print(f'widening window by wait: {schedule(policies[1])}')
fixed, widening = results[0][1], results[1][1]
print(f"widening finds {widening['matched'] - fixed['matched']} more matches and leaves {fixed['left'] - widening['left']} fewer players waiting")
if 2 * widening['matched'] + widening['left'] != 600 or 2 * fixed['matched'] + fixed['left'] != 600:
    sys.exit(1)
if widening['matched'] <= fixed['matched'] or fixed['max_wait'] < widening['max_wait']:
    sys.exit(1)
