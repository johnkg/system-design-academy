# A miniature of the idea in Slack's "Scaling Slack's Job Queue" (2017), in Python (a teaching model, not Slack's code):
# a durable log (Kafka's role) sits in front of a small in-memory queue (Redis's role). A relay moves jobs from the log
# to the queue under a rate limit and moves its offset forward only after the queue accepted the job.
# The first run has no log, so a full queue rejects new jobs. The second run uses the log.
# Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
import sys

PARTITIONS = 2  # log partitions (Slack's topics have 32)
REDIS_LIMIT = 4  # jobs the in-memory queue can hold
RATE = 2  # most jobs the relay may write to the queue per tick
DRAIN = 1  # jobs the workers finish per tick
BURST_TICKS = 4  # ticks in which new jobs arrive
PER_TICK = 3  # new jobs per tick
REDIS_DOWN_TICK = 3  # a tick in which the queue cannot be written to


# 32-bit FNV-1a, used to choose a partition from the job id.
def fnv(text):
    h = 0x811C9DC5
    for b in text.encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


# Ids of the jobs arriving in a tick. Job 2 is sent twice in tick 1, as a client retry might do.
def arrivals(tick):
    if tick > BURST_TICKS:
        return []
    ids = [f"job-{(tick - 1) * PER_TICK + i + 1}" for i in range(PER_TICK)]
    if tick == 1:
        ids[2] = "job-2"
    return ids


def redis_add(queue, job):
    # Limited deduplication: a job whose id is already waiting is discarded.
    if job in queue:
        return "duplicate"
    queue.append(job)
    return "added"


def direct():
    print("--- without a log: producers write straight to the queue")
    queue, rejected = [], 0
    for tick in range(1, BURST_TICKS + 1):
        lost = 0
        for job in arrivals(tick):
            if len(queue) >= REDIS_LIMIT:
                lost += 1
            else:
                redis_add(queue, job)
        rejected += lost
        queue = queue[DRAIN:]
        print(f"tick {tick}: arrived {PER_TICK}, rejected {lost}, queue {len(queue)}")
    print(f"rejected in total: {rejected}")
    return rejected


def with_log():
    print("--- with a log in front: producers append to the log, a relay feeds the queue")
    log = [[] for _ in range(PARTITIONS)]
    offset = [0] * PARTITIONS  # next entry the relay will read, per partition
    queue, done = [], []
    for tick in range(1, 30):
        for job in arrivals(tick):
            log[fnv(job) % PARTITIONS].append(job)  # always accepted
        moved = 0
        if tick != REDIS_DOWN_TICK:
            for p in range(PARTITIONS):
                while moved < RATE and offset[p] < len(log[p]) and len(queue) < REDIS_LIMIT:
                    redis_add(queue, log[p][offset[p]])
                    offset[p] += 1  # committed only after the queue took the job
                    moved += 1
        finished = queue[:DRAIN]
        queue = queue[DRAIN:]
        done += finished
        lag = sum(len(log[p]) - offset[p] for p in range(PARTITIONS))
        note = " (queue unreachable)" if tick == REDIS_DOWN_TICK else ""
        print(f"tick {tick}: arrived {len(arrivals(tick))}, relayed {moved}, queue {len(queue)}, waiting in log {lag}{note}")
        if tick > BURST_TICKS and lag == 0 and not queue:
            break
    return done


rejected = direct()
done = with_log()
print(f"finished {len(done)} distinct jobs, none rejected, first {done[0]}, last {done[-1]}")
ok = rejected > 0 and len(done) == len(set(done)) == BURST_TICKS * PER_TICK - 1
print(f"checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
