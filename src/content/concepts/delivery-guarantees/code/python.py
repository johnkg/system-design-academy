# Four consumer styles over the same seeded crash schedule. Payment events are charged to a card API
# and recorded in a ledger. Intended final state: every payment charged once and recorded once.
import sys

N = 12
MASK = 0xFFFFFFFF
MIN_AMOUNT, AMOUNT_STEP, AMOUNT_SPREAD = 10, 7, 30  # synthetic amounts: 10..39
RATE_SCALE = 1000  # fault rates are per 1000 attempts
CRASH_BEFORE_UPTO, CRASH_MID_UPTO, CRASH_AFTER_UPTO = 30, 55, 80  # percent cut points; the rest lose the ack
MAX_ATTEMPTS = 50  # redeliveries before a consumer gives up
SEED, FAULT_RATE = 1, 250  # 250 per 1000 = 25 % of attempts fail


def amount_of(i):
    return MIN_AMOUNT + ((i * AMOUNT_STEP) % AMOUNT_SPREAD)


# Deterministic fault for (message, attempt): the same schedule hits every style. 25 % of attempts fail.
# Hash (seed, id, attempt) with primes, then mix with 3 rounds of a 32-bit LCG.
def fault(seed, id_, attempt, rate):
    x = (seed * 7919 + id_ * 104729 + attempt * 1299709 + 12345) & MASK
    for _ in range(3):
        x = (x * 1664525 + 1013904223) & MASK
    if (x >> 16) % RATE_SCALE >= rate:
        return "ok"
    s = (x >> 8) % 100
    return "crashBefore" if s < CRASH_BEFORE_UPTO else "crashMid" if s < CRASH_MID_UPTO else "crashAfter" if s < CRASH_AFTER_UPTO else "lostAck"


def run(style, seed, rate, card_key):
    ledger, card, seen = [0] * N, [0] * N, set()

    def charge(i):
        if not (card_key and card[i] > 0):  # provider honours the key
            card[i] += 1

    for i in range(N):
        if style == "ack-before":  # offset moves first: one try, no redelivery
            f = fault(seed, i, 0, rate)
            if f == "crashBefore":
                continue  # lost
            charge(i)
            if f == "crashMid":
                continue  # charged, never recorded, lost
            ledger[i] += 1
            continue
        for attempt in range(MAX_ATTEMPTS):
            f = fault(seed, i, attempt, rate)
            if f == "crashBefore":
                continue  # redelivered
            if style == "idempotent" and i in seen:
                break  # unique key hit: skip and ack
            charge(i)
            if f == "crashMid":
                continue  # transaction never committed
            ledger[i] += 1
            if style == "idempotent":
                seen.add(i)  # same transaction as the ledger row
            if style == "transactional":
                break  # offset committed with the row
            if f == "ok":
                break  # ack arrived
            # crashAfter / lostAck: redelivered
    lost = sum(1 for c in ledger if c == 0)
    return {
        "lost": lost,
        "dupLedger": sum(max(0, c - 1) for c in ledger),
        "dupCard": sum(max(0, c - 1) for c in card),
        "ledgerTotal": sum(c * amount_of(i) for i, c in enumerate(ledger)),
        "cardTotal": sum(c * amount_of(i) for i, c in enumerate(card)),
        "want": sum(amount_of(i) for i in range(N)),
    }


def show(name, r):
    print(f"{name.ljust(14)} lost={r['lost']} dupLedger={r['dupLedger']} dupCard={r['dupCard']} ledger={r['ledgerTotal']} card={r['cardTotal']} intended={r['want']}")


STYLES = ["ack-before", "ack-after", "idempotent", "transactional"]
R = {}
for s in STYLES:
    R[s] = run(s, SEED, FAULT_RATE, False)
    show(s, R[s])
print("-- card API honours an idempotency key --")
K = {}
for s in STYLES:
    K[s] = run(s, SEED, FAULT_RATE, True)
    show(s, K[s])


def must(cond, msg):
    if not cond:
        print("FAILED: " + msg, file=sys.stderr)
        sys.exit(1)


must(R["ack-before"]["lost"] > 0, "ack-before loses messages")
must(R["ack-before"]["dupLedger"] == 0, "ack-before never duplicates")
must(R["ack-after"]["lost"] == 0 and R["ack-after"]["dupLedger"] > 0, "ack-after loses nothing but duplicates")
must(R["idempotent"]["lost"] == 0 and R["idempotent"]["ledgerTotal"] == R["idempotent"]["want"], "idempotent consumer reaches the intended ledger")
must(R["idempotent"]["dupCard"] > 0, "without a card key the external charge is still repeated")
must(R["transactional"]["lost"] == 0 and R["transactional"]["dupLedger"] == 0, "transactional consumer has no duplicate ledger rows")
must(K["idempotent"]["cardTotal"] == K["idempotent"]["want"] and K["idempotent"]["ledgerTotal"] == K["idempotent"]["want"], "dedupe plus card key is exactly the intended state")
must(K["transactional"]["cardTotal"] == K["transactional"]["want"], "transactional plus card key is exactly the intended state")
print("all invariants hold")
