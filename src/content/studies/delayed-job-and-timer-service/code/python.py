# A hierarchical timing wheel with cancellation, in Python:
# three levels of 64 slots, so a timer is placed once in O(1), moves down a level when its turn comes, and fires on exactly its tick.
import sys

BITS = 6
SLOTS = 1 << BITS
LEVELS = 3  # level 0 = 1 tick per slot, level 1 = 64 ticks, level 2 = 4,096 ticks


class TimingWheel:
    def __init__(self):
        self.now = 0
        self.levels = [[[] for _ in range(SLOTS)] for _ in range(LEVELS)]
        self.cancelled = set()
        self.moved = [0, 0, 0]  # how many timers each level handed down

    # The farther away the due tick, the coarser the level that holds the timer.
    def add(self, timer):
        delta = timer['due'] - self.now
        level = 0
        while level < LEVELS - 1 and delta >= 1 << (BITS * (level + 1)):
            level += 1
        self.levels[level][(timer['due'] >> (BITS * level)) & (SLOTS - 1)].append(timer)
        return level

    def cancel(self, timer_id):  # lazy: the timer is skipped when its slot comes up
        self.cancelled.add(timer_id)

    # Advance one tick: cascade the coarse slots that start now, then fire the fine slot.
    def tick(self):
        self.now += 1
        for level in range(LEVELS - 1, 0, -1):
            if self.now % (1 << (BITS * level)) != 0:
                continue
            slot = (self.now >> (BITS * level)) & (SLOTS - 1)
            moving = self.levels[level][slot]
            self.levels[level][slot] = []
            self.moved[level] += len(moving)
            for t in moving:
                self.add(t)
        slot = self.now & (SLOTS - 1)
        due = self.levels[0][slot]
        self.levels[0][slot] = []
        return sorted((t for t in due if t['id'] not in self.cancelled), key=lambda t: t['id'])


seed = 2024


def random_below(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 256) % n


wheel = TimingWheel()
timers = []
placed = [0, 0, 0]


def schedule(timer_id, due):
    t = {'id': timer_id, 'due': due}
    timers.append(t)
    placed[wheel.add(t)] += 1


for i in range(3000):
    schedule(i, 1 + random_below(200000))
for t in timers:
    if t['id'] % 10 == 3:
        wheel.cancel(t['id'])  # 10% are cancelled before they are due

fired = []
on_time = True
while wheel.now < 200000:
    if wheel.now == 1000:  # new timers keep arriving while the wheel turns
        for i in range(3000, 3200):
            schedule(i, wheel.now + 1 + random_below(150000))
        for t in timers:
            if t['id'] >= 3000 and t['id'] % 10 == 3:
                wheel.cancel(t['id'])
    for t in wheel.tick():
        fired.append(t)
        if t['due'] != wheel.now:
            on_time = False

expected = sorted((t for t in timers if t['id'] not in wheel.cancelled), key=lambda t: (t['due'], t['id']))
same_order = fired == expected
flag = lambda b: 'true' if b else 'false'
print(f"timers {len(timers)}, cancelled {len(wheel.cancelled)}, fired {len(fired)}")
print(f"placed on arrival by level: L0 {placed[0]}, L1 {placed[1]}, L2 {placed[2]}")
print("first 5 fired: " + ", ".join(f"#{t['id']}@{t['due']}" for t in fired[:5]))
print(f"cascaded down: {wheel.moved[2]} from level 2, {wheel.moved[1]} from level 1")
print(f"every timer fired on its own tick: {flag(on_time)}; same order as a full sort: {flag(same_order)}")
if not on_time or not same_order or len(fired) != len(timers) - len(wheel.cancelled):
    sys.exit(1)
