# A Snowflake-style ID generator in Python, with a clock we control so every run prints the same lines.
# Layout (teaching size): time in milliseconds | 3 machine bits | 2 sequence bits.
# Real layouts use more bits, for example 41 for time, 10 for the machine and 12 for the sequence.
import sys

MACHINE_BITS, SEQUENCE_BITS = 3, 2
MAX_SEQUENCE = (1 << SEQUENCE_BITS) - 1  # 3, so 4 ids fit in one millisecond
START_MS = 1000                          # where the fake clock starts
OVERFLOW_REQUEST = 6                     # more ids than fit in one millisecond
CLOCK_BACK_MS = 3                        # how far the clock is set back
YESTERDAY_FIRST, YESTERDAY_LAST = 41823, 43201  # auto-increment order numbers seen a day apart


class IdGenerator:
    def __init__(self, machine, clock, wait_one_ms):
        self.machine = machine
        self.clock = clock
        self.wait_one_ms = wait_one_ms
        self.last = -1
        self.sequence = 0

    def next(self):
        now = self.clock()
        if now < self.last:
            raise RuntimeError(f"clock moved back by {self.last - now} ms, refusing to issue ids")
        if now == self.last:
            self.sequence = (self.sequence + 1) & MAX_SEQUENCE
            if self.sequence == 0:  # the sequence is used up: wait for the next millisecond
                while True:
                    self.wait_one_ms()
                    now = self.clock()
                    if now > self.last:
                        break
        else:
            self.sequence = 0
        self.last = now
        return (now << (MACHINE_BITS + SEQUENCE_BITS)) | (self.machine << SEQUENCE_BITS) | self.sequence


def decode(id):
    return f"time {id >> (MACHINE_BITS + SEQUENCE_BITS)}, machine {(id >> SEQUENCE_BITS) & ((1 << MACHINE_BITS) - 1)}, sequence {id & MAX_SEQUENCE}"


time = START_MS


def clock():
    return time


def wait_one_ms():
    global time
    time += 1


# 1. Two databases that each count from 1 hand out the same numbers.
node_a, node_b = [1, 2, 3], [1, 2, 3]
print(f"auto-increment on 2 nodes: {len(node_a) + len(node_b)} ids, {len(set(node_a + node_b))} distinct")

# 2. Different machine numbers keep two nodes apart, even in the same millisecond.
a, b = IdGenerator(1, clock, wait_one_ms), IdGenerator(2, clock, wait_one_ms)
ids = [a.next(), a.next(), b.next(), b.next()]
for id in ids:
    print(f"id {id} = {decode(id)}")
print(f"machines 1 and 2: {len(ids)} ids, {len(set(ids))} distinct")

# 3. Two processes started with the same machine number repeat each other.
c, d = IdGenerator(3, clock, wait_one_ms), IdGenerator(3, clock, wait_one_ms)
clash = [c.next(), c.next(), d.next(), d.next()]
print(f"both machine 3: {len(clash)} ids, {len(set(clash))} distinct")

# 4. More ids than the sequence holds: the generator waits for the next millisecond.
time += 1
busy = IdGenerator(4, clock, wait_one_ms)
burst = [busy.next() for _ in range(OVERFLOW_REQUEST)]
burst_times = {id >> (MACHINE_BITS + SEQUENCE_BITS) for id in burst}
print(f"{OVERFLOW_REQUEST} ids asked in one millisecond: last one is {decode(burst[-1])}, spread over {len(burst_times)} ms")

# 5. A clock set back is refused, not trusted.
time -= CLOCK_BACK_MS
refused = False
try:
    busy.next()
except RuntimeError as e:
    refused = True
    print(f"clock set back: {e}")

# 6. Ids made later are larger, so sorting by value sorts by time.
is_sorted = sorted(burst) == burst
print(f"sorted by value is sorted by time: {str(is_sorted).lower()}")

# 7. A plain counter tells a competitor your volume.
print(f"two auto-increment ids a day apart: {YESTERDAY_LAST - YESTERDAY_FIRST} orders that day")

if len(set(ids)) != 4 or len(set(clash)) != 2 or len(burst_times) != 2 or not refused or not is_sorted:
    sys.exit(1)
