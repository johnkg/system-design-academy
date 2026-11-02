# A miniature of the ideas in Stripe's 2017 posts "Scaling your API with rate limiters" and "Designing robust and
# predictable APIs with idempotency", in Python (a teaching model, not Stripe's code):
# 1) a token bucket limits one user's request rate, 2) a load shedder keeps room for critical requests when the
# workers are short of capacity, 3) idempotency keys make a retried charge safe.
# Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
import sys

BUCKET_SIZE = 3  # tokens a user's bucket holds, so a burst of 3 is allowed
REFILL_PER_TICK = 1  # tokens added to the bucket each tick
SCRIPT_REQUESTS_PER_TICK = 5  # a script that has run out of control
SCRIPT_TICKS = 4
CAPACITY_PER_TICK = 10  # requests the workers can finish in one tick
NON_CRITICAL_LIMIT = 5  # the shedder lets this many non-critical requests in per tick and keeps the rest for critical ones
CRITICAL_PER_TICK = 4  # charges arriving each tick
NON_CRITICAL_PER_TICK = 9  # requests to list old charges arriving each tick
AMOUNT = 2000  # an example charge


# Request rate limiter: a token bucket. Each request takes a token, tokens drip back, an empty bucket rejects.
def token_bucket():
    print("--- request rate limiter: one script sends 5 requests a tick")
    tokens = BUCKET_SIZE
    rejected_total = 0
    for tick in range(1, SCRIPT_TICKS + 1):
        allowed = min(SCRIPT_REQUESTS_PER_TICK, tokens)
        tokens = min(BUCKET_SIZE, tokens - allowed + REFILL_PER_TICK)
        rejected = SCRIPT_REQUESTS_PER_TICK - allowed
        rejected_total += rejected
        print(f"tick {tick}: sent {SCRIPT_REQUESTS_PER_TICK}, allowed {allowed}, rejected with 429: {rejected}, tokens left {tokens}")
    return rejected_total


# Fleet usage load shedder: past its share of capacity, non-critical requests get a 503 so charges still fit.
# Without it, an overloaded tick finishes only part of every kind of request.
def load_shedding(use_shedder):
    non_critical_admitted = min(NON_CRITICAL_PER_TICK, NON_CRITICAL_LIMIT) if use_shedder else NON_CRITICAL_PER_TICK
    load = CRITICAL_PER_TICK + non_critical_admitted

    def finished(n):
        return (n * CAPACITY_PER_TICK) // load if load > CAPACITY_PER_TICK else n

    charges_done = finished(CRITICAL_PER_TICK)
    lists_done = finished(non_critical_admitted)
    shed = NON_CRITICAL_PER_TICK - non_critical_admitted
    label = "with" if use_shedder else "without"
    print(f"{label} the shedder: load {load} of {CAPACITY_PER_TICK}, charges done {charges_done} of {CRITICAL_PER_TICK}, lists done {lists_done}, lists shed with 503: {shed}")
    return charges_done


# Idempotency: the first time a key is seen the charge happens and its result is saved; a retry gets the saved result.
def charge(store, key, ledger):
    if key in store:
        return True, store[key]
    ledger.append(AMOUNT)  # the money moves once
    charge_id = f"ch_{len(ledger)}"
    store[key] = charge_id
    return False, charge_id


def retried_charge():
    print("--- idempotency keys: the answer to the first attempt is lost, so the client tries again")
    without_keys = [AMOUNT, AMOUNT]  # every attempt is a new charge
    print(f"without a key: charges made {len(without_keys)}, the customer pays {len(without_keys) * AMOUNT}")
    store, ledger = {}, []
    for attempt in range(1, 3):
        replayed, charge_id = charge(store, "key-1", ledger)
        print(f"with key-1, attempt {attempt}: {'replayed the saved result' if replayed else 'charged'} {charge_id}")
    print(f"with a key: charges made {len(ledger)}, the customer pays {len(ledger) * AMOUNT}")
    return len(without_keys), len(ledger)


rejected = token_bucket()
print("--- load shedding: 4 charges and 9 list requests arrive in a tick the workers can finish 10 requests of")
charges_without = load_shedding(False)
charges_with = load_shedding(True)
charges_no_key, charges_with_key = retried_charge()
ok = rejected == 14 and charges_without < CRITICAL_PER_TICK and charges_with == CRITICAL_PER_TICK and charges_no_key == 2 and charges_with_key == 1
print(f"checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
