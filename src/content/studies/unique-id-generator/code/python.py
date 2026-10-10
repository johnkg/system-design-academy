# A Snowflake-style ID generator in Python:
# 41 bits of time, 10 bits of machine number and 12 bits of sequence make a 64-bit number that is unique and roughly sorted by time.
import sys

EPOCH = 1735689600000  # 1 January 2025, so the 41 time bits last about 69 years from there
MACHINE_BITS, SEQUENCE_BITS = 10, 12
MAX_SEQUENCE = (1 << SEQUENCE_BITS) - 1  # 4095


class IdGenerator:
    def __init__(self, machine_id, clock, sleep):
        self.machine = machine_id
        self.clock = clock
        self.sleep = sleep
        self.last = -1
        self.sequence = 0

    def next(self):
        now = self.clock()
        if now < self.last:
            raise RuntimeError(f"clock moved back by {self.last - now} ms: refusing to issue IDs")  # issuing now could repeat an old ID
        if now == self.last:
            self.sequence = (self.sequence + 1) & MAX_SEQUENCE
            if self.sequence == 0:  # 4096 IDs in this millisecond: wait for the next one
                while True:
                    self.sleep()
                    now = self.clock()
                    if now > self.last:
                        break
        else:
            self.sequence = 0
        self.last = now
        return ((now - EPOCH) << (MACHINE_BITS + SEQUENCE_BITS)) | (self.machine << SEQUENCE_BITS) | self.sequence


def decode(id):
    return {"ms": id >> (MACHINE_BITS + SEQUENCE_BITS), "machine": (id >> SEQUENCE_BITS) & 1023, "sequence": id & MAX_SEQUENCE}


# A clock we control, so the run is the same every time.
time = EPOCH + 1000


def clock():
    return time


def sleep():
    global time
    time += 1


a = IdGenerator(1, clock, sleep)
b = IdGenerator(2, clock, sleep)
ids = [a.next(), a.next(), b.next(), b.next()]
for id in ids:
    d = decode(id)
    print(f"id {id}  = time +{d['ms']} ms, machine {d['machine']}, sequence {d['sequence']}")

seen = set(ids)
time += 1
for _ in range(4097):
    seen.add(a.next())  # more than 4096 in one millisecond
spill = decode(a.next())["ms"] - 1001  # how many milliseconds after the busy one the generator is now
print(f"{len(seen)} distinct IDs from two machines; the 4,097th ID of one millisecond was issued {spill} ms later, after waiting")

refused = False
time -= 5  # the clock is set back by 5 ms
try:
    a.next()
except RuntimeError as e:
    refused = True
    print(f"clock set back: {e}")

increasing = ids[0] < ids[1] and ids[2] < ids[3]
if not increasing or len(seen) != 4 + 4097 or spill != 1 or not refused:
    sys.exit(1)
