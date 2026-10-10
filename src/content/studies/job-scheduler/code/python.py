# A job queue with leases, retries and a dead-letter queue in Python:
# a job that is received but never finished comes back by itself, and doing it twice causes no harm.
import sys
from dataclasses import dataclass


@dataclass
class Job:
    id: str
    attempts: int = 0
    visible_at: int = 0
    done: bool = False


class JobQueue:
    def __init__(self, lease_seconds, max_attempts):
        self.lease = lease_seconds
        self.max_attempts = max_attempts
        self.jobs: dict[str, Job] = {}  # id -> Job
        self.dead_letters: list[str] = []

    def add(self, id):
        self.jobs[id] = Job(id)

    # Hand out the next job that is visible. It becomes invisible for the lease time; if nobody acks it, it will reappear.
    def receive(self, now):
        for job in self.jobs.values():
            if job.done or job.visible_at > now:
                continue
            if job.attempts >= self.max_attempts:
                job.done = True
                self.dead_letters.append(job.id)  # too many tries: set it aside for a person
                continue
            job.attempts += 1
            job.visible_at = now + self.lease
            return job
        return None

    def ack(self, id):
        self.jobs[id].done = True


effects: dict[str, int] = {}  # what the jobs actually did in the world (an invoice sent, for example)
run_log: set[str] = set()     # a record of finished work, keyed by job id


# The handler is idempotent: it first looks at the run log, so a repeat delivery does not repeat the effect.
def handle(job, worker, crashes_after_effect):
    if job.id == 'poison':
        raise RuntimeError('this job always fails')
    if job.id not in run_log:
        effects[job.id] = effects.get(job.id, 0) + 1  # the real work
        run_log.add(job.id)
    if crashes_after_effect:
        raise RuntimeError(f'{worker} crashed after doing the work, before acknowledging it')


queue = JobQueue(30, 3)  # 30-second lease, at most 3 attempts
for job_id in ['invoice-1', 'invoice-2', 'poison']:
    queue.add(job_id)

# Script of what goes wrong: worker A dies without doing invoice-1, worker B does invoice-2 but dies before the ack.
crash_plan = {'invoice-1': ['dies before starting'], 'invoice-2': ['crash after work']}
log = []
for now in range(0, 201, 10):
    job = queue.receive(now)
    if job is None:
        continue
    plans = crash_plan.get(job.id, [])
    plan = plans[job.attempts - 1] if job.attempts - 1 < len(plans) else None
    try:
        if plan == 'dies before starting':
            raise RuntimeError('worker A died')
        handle(job, 'B', plan == 'crash after work')
        queue.ack(job.id)
        log.append(f't={now}s {job.id} attempt {job.attempts}: done')
    except RuntimeError as e:
        log.append(f't={now}s {job.id} attempt {job.attempts}: {e}')
print('\n'.join(log))
print(f"effects: {', '.join(f'{id} x{n}' for id, n in sorted(effects.items()))}   dead letters: {', '.join(queue.dead_letters)}")
if effects.get('invoice-1') != 1 or effects.get('invoice-2') != 1 or ','.join(queue.dead_letters) != 'poison':
    sys.exit(1)
