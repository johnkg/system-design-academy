# A tiny durable workflow engine in Python:
# the workflow is plain code, its history is an append-only list of results, and after a crash a new worker replays the code against the history.
import sys

STEPS = ['reserve', 'charge', 'pack', 'ship', 'notify']
MAX_ATTEMPTS = 3
SEED, ORDERS = 7, 200
FAIL_PCT, LOST_REPLY_PCT, CRASH_PCT = 10, 10, 4  # an attempt fails early, or acts but its reply is lost; a worker dies before recording


class NeedActivity(Exception):
    def __init__(self, name):
        super().__init__(name)
        self.activity = name


# The workflow must be deterministic: same history in, same decisions out. It may only touch the world through ctx.
def order_workflow(ctx):
    results = []
    for step in STEPS:
        results.append(ctx.call(step))  # returns the recorded result, or pauses the code if there is none yet
    return results


class Ctx:
    def __init__(self, history):
        self.history = history
        self.pos = 0

    def call(self, name):
        if self.pos < len(self.history):
            self.pos += 1
            return self.history[self.pos - 1]['result']
        raise NeedActivity(name)


def replay(history):
    return order_workflow(Ctx(history))


seed = SEED


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# Runs one order to the end. The activity is at-least-once: it can run, lose its reply, and be run again.
def run_order(order_id, idempotent, effects, stats):
    history = []
    while True:
        try:
            replay(history)  # a fresh worker starts here with nothing but the history
        except NeedActivity as e:
            done = False
            attempt = 1
            while attempt <= MAX_ATTEMPTS and not done:
                attempt += 1
                r = random(100)
                if r < FAIL_PCT:
                    continue  # failed before doing anything
                key = f'{order_id}:{e.activity}'  # the idempotency key
                if not (idempotent and key in effects):
                    effects[key] = effects.get(key, 0) + 1  # the side effect (a charge, a shipment)
                if r < FAIL_PCT + LOST_REPLY_PCT:
                    continue  # the effect happened but the reply was lost
                done = True
            if not done:
                stats['stuck'] += 1  # retries are used up: the workflow waits for a human
                return len(history)
            if random(100) < CRASH_PCT:
                stats['crashes'] += 1  # the worker died before it wrote the result: the activity will run again
                continue
            history.append({'type': 'ActivityCompleted', 'result': f'{e.activity}-{order_id}'})
            continue
        stats['completed'] += 1
        return len(history)


def run_all(idempotent):
    global seed
    seed = SEED
    effects = {}
    stats = {'completed': 0, 'stuck': 0, 'crashes': 0}
    longest = 0
    for order_id in range(1, ORDERS + 1):
        longest = max(longest, run_order(order_id, idempotent, effects, stats))
    twice = sum(n - 1 for n in effects.values())
    double_charges = sum(n - 1 for key, n in effects.items() if key.endswith(':charge'))
    events = 2 + 2 * longest  # started + one scheduled and one completed event per step + finished
    return dict(stats, twice=twice, double_charges=double_charges, events=events)


def main():
    for idempotent in (False, True):
        r = run_all(idempotent)
        flag = 'true' if idempotent else 'false'
        print(f"idempotent={flag}: completed {r['completed']}, stuck {r['stuck']}, crashes {r['crashes']}, steps run twice {r['twice']}, double charges {r['double_charges']}, longest history {r['events']} events")
        if r['completed'] + r['stuck'] != ORDERS:
            sys.exit(1)
        if idempotent and r['twice'] != 0:
            sys.exit(1)
        if not idempotent and r['double_charges'] == 0:
            sys.exit(1)
    again = replay([{'result': f'{s}-9'} for s in STEPS])
    print(f"replay of a full history gives: {', '.join(again)}")
    if ','.join(again) != 'reserve-9,charge-9,pack-9,ship-9,notify-9':
        sys.exit(1)


main()
