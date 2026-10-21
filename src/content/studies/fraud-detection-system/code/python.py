# A real-time fraud scorer in Python:
# velocity counters in time buckets, rules plus a small model, a decision (allow, challenge, block),
# and a candidate rule tested in shadow mode against later chargeback labels.
import sys

BUCKET, BUCKETS = 10, 6  # a 60-second window made of six 10-second buckets


class Velocity:
    def __init__(self):
        self.cards = {}

    # Count and total of the card's payments in the last 60 seconds, read before the new payment is added.
    def read(self, card, t):
        c = self.cards.get(card)
        now = t // BUCKET
        count = total = 0
        if c is None:
            return count, total
        for i in range(BUCKETS):
            if c['id'][i] != -1 and now - c['id'][i] < BUCKETS:
                count += c['n'][i]
                total += c['sum'][i]
        return count, total

    def add(self, card, t, amount):
        if card not in self.cards:
            self.cards[card] = {'id': [-1] * BUCKETS, 'n': [0] * BUCKETS, 'sum': [0] * BUCKETS}
        c = self.cards[card]
        now = t // BUCKET
        slot = now % BUCKETS
        if c['id'][slot] != now:  # a stale bucket is reused
            c['id'][slot], c['n'][slot], c['sum'][slot] = now, 0, 0
        c['n'][slot] += 1
        c['sum'][slot] += amount


# Rules are exact and explainable; the model adds a graded score from the same features. Amounts are in cents.
VELOCITY_COUNT, VELOCITY_POINTS, BIG_AMOUNT, BIG_POINTS = 3, 40, 15000, 20
MODEL_CAP, POINTS_PER_PAYMENT, TOTAL_PER_POINT, AMOUNT_PER_POINT = 60, 6, 1500, 1000
CANDIDATE_AMOUNT, CANDIDATE_POINTS = 8000, 35
BLOCK_AT, CHALLENGE_AT, MAX_SCORE = 70, 40, 100
# Cost of a decision in cents: fraud that gets through a challenge, a good payment blocked, the friction of a challenge.
CHALLENGED_FRAUD_LOSS, FALSE_BLOCK_COST, CHALLENGE_FRICTION = 300, 2500, 40


def rules(count, total, amount):
    return (VELOCITY_POINTS if count >= VELOCITY_COUNT else 0) + (BIG_POINTS if amount >= BIG_AMOUNT else 0)


def model(count, total, amount):
    return min(MODEL_CAP, POINTS_PER_PAYMENT * count + total // TOTAL_PER_POINT + amount // AMOUNT_PER_POINT)


def candidate(count, total, amount):  # new rule, evaluated in shadow
    return CANDIDATE_POINTS if amount >= CANDIDATE_AMOUNT and count >= 1 else 0


def decide(score):
    return 'block' if score >= BLOCK_AT else 'challenge' if score >= CHALLENGE_AT else 'allow'


def price(d, fraud, amount):
    if fraud:
        return 0 if d == 'block' else CHALLENGED_FRAUD_LOSS if d == 'challenge' else amount
    return FALSE_BLOCK_COST if d == 'block' else CHALLENGE_FRICTION if d == 'challenge' else 0


SEED, SECONDS, EVENTS_PER_SECOND, CARDS = 7, 1200, 2, 200
THEFT_START, FRAUD_PERCENT, FRAUD_MIN, FRAUD_SPREAD = 300, 18, 6000, 24000
NORMAL_MIN, NORMAL_SPREAD = 500, 5500
BIG_SPENDER_EVERY, BIG_SPENDER_EXTRA = 50, 12000  # one card in 50 also makes large purchases
seed = SEED


def random(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


stolen = [3, 41, 77, 120, 158]  # cards that a thief is using from second 300 on
velocity = Velocity()
live = {'allow': 0, 'challenge': 0, 'block': 0}
cost_live = cost_shadow = 0
changed = caught = hurt = 0
fraud_total = fraud_blocked = good_blocked = good_challenged = 0

for t in range(SECONDS):
    for _ in range(EVENTS_PER_SECOND):  # two events per second: a normal purchase, or a thief using a stolen card
        fraud = t >= THEFT_START and random(100) < FRAUD_PERCENT
        card = stolen[random(len(stolen))] if fraud else random(CARDS)
        amount = (FRAUD_MIN + random(FRAUD_SPREAD) if fraud
                  else NORMAL_MIN + random(NORMAL_SPREAD) + (random(BIG_SPENDER_EXTRA) if card % BIG_SPENDER_EVERY == 9 else 0))
        count, total = velocity.read(card, t)
        base = min(MAX_SCORE, rules(count, total, amount) + model(count, total, amount))
        with_new = min(MAX_SCORE, base + candidate(count, total, amount))
        d, d_new = decide(base), decide(with_new)  # only d is acted on
        live[d] += 1
        fraud_total += fraud
        fraud_blocked += fraud and d == 'block'
        good_blocked += not fraud and d == 'block'
        good_challenged += not fraud and d == 'challenge'
        cost_live += price(d, fraud, amount)
        cost_shadow += price(d_new, fraud, amount)
        changed += d_new != d
        caught += d_new != d and fraud
        hurt += d_new != d and not fraud
        velocity.add(card, t, amount)

print(f"decisions: allow {live['allow']}, challenge {live['challenge']}, block {live['block']}")
print(f"fraud blocked {fraud_blocked} of {fraud_total}; good payments blocked {good_blocked}, challenged {good_challenged}")
print(f"shadow rule would change {changed} decisions: {caught} on fraud, {hurt} on good payments")
print(f"loss in cents with the live rules {cost_live}, with the candidate added {cost_shadow}")
promote = cost_shadow < cost_live
print(f"promote the candidate rule: {'true' if promote else 'false'}")
if sum(live.values()) != SECONDS * EVENTS_PER_SECOND or fraud_blocked > fraud_total or caught + hurt != changed:
    sys.exit(1)
