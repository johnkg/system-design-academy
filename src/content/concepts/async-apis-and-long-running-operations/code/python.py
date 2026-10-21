# A job service: idempotent create, status, leased workers and a polling comparison.
# The clock is an integer "second" that the loop advances by hand, so the output is deterministic.

LEASE = 4  # a worker renews its lease every second; if it stops, the job is re-queued after 4 s
WORK_MIN, WORK_SPREAD = 6, 10  # a job needs 6..15 s of work
RESTART_DELAY = 2  # seconds before a crashed worker comes back
WORKERS, SEED, CRASH_AT, MAX_TICKS = 2, 7, 4, 100  # worker 0 crashes at t = CRASH_AT
POLL_CAP = 16  # longest wait between polls (s)
DONE_AT = 45  # the polled job finishes at this second
CLIENTS = 1000000


def lcg(seed):
    state = seed
    while True:
        state = (state * 1664525 + 1013904223) % 4294967296
        yield state


class JobService:
    def __init__(self, workers, seed):
        self.jobs, self.by_key, self.queue, self.results = {}, {}, [], {}
        self.workers = [None] * workers
        self.down_until = [0] * workers  # a crashed worker restarts after 2 s
        self.random = lcg(seed)

    def log(self, t, job, text):
        print(f"t={t:2d} op_{job['id']} {text}")

    def create(self, t, key):
        """POST /reports: the same key always returns the same operation."""
        if key in self.by_key:
            return self.by_key[key]
        job = {"id": len(self.jobs) + 1, "state": "pending", "work": WORK_MIN + next(self.random) % WORK_SPREAD, "lease": 0, "runs": 0}
        job["left"] = job["work"]
        self.jobs[job["id"]] = job
        self.by_key[key] = job["id"]
        self.queue.append(job)
        self.log(t, job, f"pending ({job['work']} s of work)")
        return job["id"]

    def status(self, op_id):
        """GET /operations/{id}"""
        return self.jobs[op_id]["state"]

    def tick(self, t, crash_worker=-1):
        if crash_worker >= 0 and self.workers[crash_worker]:
            self.log(t, self.workers[crash_worker], f"worker {crash_worker} crashed, lease stays at t={self.workers[crash_worker]['lease']}")
            self.workers[crash_worker] = None  # the job stays 'running' until its lease expires
            self.down_until[crash_worker] = t + RESTART_DELAY
        for job in self.jobs.values():
            if job["state"] == "running" and job["lease"] <= t and job not in self.workers:
                job["state"], job["left"] = "pending", job["work"]  # start over from the beginning
                self.queue.insert(0, job)
                self.log(t, job, "lease expired, back to pending")
        for i, job in enumerate(self.workers):
            if job:
                job["left"] -= 1
                job["lease"] = t + LEASE
                if job["left"] == 0:
                    job["state"] = "succeeded"
                    self.results[job["id"]] = f"report-{job['id']}"  # a put under the job id, so a re-run overwrites
                    self.workers[i] = None
                    self.log(t, job, f"succeeded after {job['runs']} run(s)")
        for i, job in enumerate(self.workers):
            if job is None and self.queue and t >= self.down_until[i]:
                job = self.workers[i] = self.queue.pop(0)
                job["state"], job["runs"], job["lease"] = "running", job["runs"] + 1, t + LEASE
                self.log(t, job, f"running on worker {i}")


svc = JobService(workers=WORKERS, seed=SEED)
a = svc.create(0, "key-a")
b = svc.create(0, "key-b")
a_again = svc.create(0, "key-a")  # the client retried a lost 202
assert a_again == a and len(svc.jobs) == 2, "same key must return the same job"
svc.create(1, "key-c")
t = 0
while any(j["state"] != "succeeded" for j in svc.jobs.values()):
    t += 1
    svc.tick(t, crash_worker=0 if t == CRASH_AT else -1)
    assert t < MAX_TICKS
assert len(svc.results) == 3 and all(j["state"] == "succeeded" for j in svc.jobs.values())
print(f"jobs: {len(svc.jobs)}, results stored: {len(svc.results)}, runs: {[j['runs'] for j in svc.jobs.values()]}")


def poll_times(done_at, first, growth):
    """Poll at `first` seconds, then wait growth*previous (capped at 16); stop when the job is done."""
    times, wait, now = [], first, 0
    while True:
        now += wait
        times.append(now)
        if now >= done_at:
            return times
        wait = min(POLL_CAP, wait * growth)


fixed = poll_times(DONE_AT, 1, 1)
backoff = poll_times(DONE_AT, 2, 2)
print(f"fixed 1 s: {len(fixed)} polls, result seen at {fixed[-1]} s")
print(f"backoff 2,4,8,16: {len(backoff)} polls, result seen at {backoff[-1]} s")
assert len(backoff) < len(fixed) and backoff[-1] - DONE_AT < POLL_CAP
print(f"1,000,000 clients: {CLIENTS} req/s fixed, {CLIENTS * len(backoff) // DONE_AT} req/s average with backoff")
