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
def rules(count, total, amount):
    return (40 if count >= 3 else 0) + (20 if amount >= 15000 else 0)


def model(count, total, amount):
    return min(60, 6 * count + total // 1500 + amount // 1000)


def candidate(count, total, amount):  # new rule, evaluated in shadow
    return 35 if amount >= 8000 and count >= 1 else 0


def decide(score):
    return 'block' if score >= 70 else 'challenge' if score >= 40 else 'allow'


def price(d, fraud, amount):
    if fraud:
        return 0 if d == 'block' else 300 if d == 'challenge' else amount
    return 2500 if d == 'block' else 40 if d == 'challenge' else 0


seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


stolen = [3, 41, 77, 120, 158]  # cards that a thief is using from second 300 on
velocity = Velocity()
live = {'allow': 0, 'challenge': 0, 'block': 0}
cost_live = cost_shadow = 0
changed = caught = hurt = 0
fraud_total = fraud_blocked = good_blocked = good_challenged = 0

for t in range(1200):
    for _ in range(2):  # two events per second: a normal purchase, or a thief using a stolen card
        fraud = t >= 300 and random(100) < 18
        card = stolen[random(len(stolen))] if fraud else random(200)
        amount = 6000 + random(24000) if fraud else 500 + random(5500) + (random(12000) if card % 50 == 9 else 0)
        count, total = velocity.read(card, t)
        base = min(100, rules(count, total, amount) + model(count, total, amount))
        with_new = min(100, base + candidate(count, total, amount))
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
if sum(live.values()) != 2400 or fraud_blocked > fraud_total or caught + hurt != changed:
    sys.exit(1)
