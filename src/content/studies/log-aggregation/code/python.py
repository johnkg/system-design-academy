# A bounded log buffer with three drop policies, in Python:
# a burst of log lines meets a queue of fixed size, and the policy decides which lines are lost when it is full.
import sys

LEVELS = ['debug', 'info', 'warn', 'error']  # index = priority
CAPACITY, DRAIN, TICKS = 300, 60, 60  # lines the buffer holds, lines shipped per tick, length of the run
DEBUG, INFO, WARN, ERROR = 0, 1, 2, 3
ERROR_PCT, WARN_PCT, INFO_PCT = 3, 7, 30  # the remaining 60% is debug
SEED, NORMAL_RATE, BURST_RATE, BURST_START, BURST_END = 7, 30, 150, 20, 30  # lines per tick

seed = SEED


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def level_of(r):
    return ERROR if r < ERROR_PCT else WARN if r < ERROR_PCT + WARN_PCT else INFO if r < ERROR_PCT + WARN_PCT + INFO_PCT else DEBUG


def run(policy):
    global seed
    seed = SEED
    queue, lost, sent = [], [0] * len(LEVELS), [0] * len(LEVELS)
    arrived = 0
    peak = 0

    def offer(level):
        if len(queue) < CAPACITY:
            queue.append(level)
        elif policy == 'drop-newest':
            lost[level] += 1
        elif policy == 'drop-oldest':
            lost[queue.pop(0)] += 1
            queue.append(level)
        else:
            lowest = min(queue)  # keep-errors: make room by evicting the oldest line of the lowest level
            if lowest < level:
                queue.pop(queue.index(lowest))
                lost[lowest] += 1
                queue.append(level)
            else:
                lost[level] += 1

    for t in range(TICKS):
        n = BURST_RATE if BURST_START <= t < BURST_END else NORMAL_RATE # a burst between ticks 20 and 29
        for _ in range(n):
            offer(level_of(random(100)))
            arrived += 1
        peak = max(peak, len(queue))
        for _ in range(min(DRAIN, len(queue))):
            sent[queue.pop(0)] += 1
    while queue:  # the agent catches up after the burst
        sent[queue.pop(0)] += 1

    detail = ', '.join(f'{LEVELS[i]} {lost[i]}' for i in (3, 2, 1, 0))
    print(f'{policy}: shipped {sum(sent)} of {arrived}, lost {sum(lost)} ({detail}), worst wait {(peak + DRAIN - 1) // DRAIN} ticks')
    return arrived, lost, sent


policies = ['drop-newest', 'drop-oldest', 'keep-errors']
results = {}
for policy in policies:
    arrived, lost, sent = run(policy)
    results[policy] = lost
    if sum(lost) + sum(sent) != arrived:  # every line is either shipped or counted as lost
        sys.exit(1)
ok = results['keep-errors'][ERROR] == 0 and results['drop-newest'][ERROR] > 0 and results['drop-oldest'][ERROR] > 0
print(f"errors lost: {' / '.join(str(results[p][ERROR]) for p in policies)}; keep-errors loses none: {str(ok).lower()}")
if not ok:
    sys.exit(1)
