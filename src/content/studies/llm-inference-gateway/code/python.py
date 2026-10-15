# The token budget of an LLM gateway, in Python:
# each team has a token bucket. A request reserves "prompt + max output" before it runs and gets the unused part back when it finishes.
import sys


class Budget:
    # Levels are kept in milli-tokens so refills are exact integers. rate is tokens per second, now is in milliseconds.
    def __init__(self, capacity, rate):
        self.cap = capacity * 1000
        self.rate = rate
        self.level = self.cap
        self.last = 0

    def refill(self, now):
        self.level = min(self.cap, self.level + (now - self.last) * self.rate)
        self.last = now

    def reserve(self, tokens, now):
        self.refill(now)
        if self.level < tokens * 1000:
            return False
        self.level -= tokens * 1000
        return True

    def settle(self, reserved, used):
        self.level = min(self.cap, self.level + (reserved - used) * 1000)


# Price per token in micro-dollars: (input, output). Short prompts go to the small model, the rest to the large one.
PRICE = {'small': (1, 4), 'large': (3, 15)}
TEAMS = [('search', 20000, 3000), ('support', 20000, 3000), ('research', 40000, 6000)]  # name, capacity, tokens per second

seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def simulate(refund):
    global seed
    seed = 7
    budgets = [Budget(cap, rate) for _, cap, rate in TEAMS]
    stats = [{'ok': 0, 'rejected': 0, 'tokens': 0, 'cost': 0} for _ in TEAMS]
    now = 0
    for _ in range(300):
        now += 40 + random(200)
        team = random(3)
        prompt = 200 + random(1800)
        max_out = 1024
        out = 50 + random(500)
        reserved = prompt + max_out
        if not budgets[team].reserve(reserved, now):
            stats[team]['rejected'] += 1
            continue
        model = 'small' if prompt < 800 else 'large'
        used = prompt + out
        if refund:
            budgets[team].settle(reserved, used)  # without it the whole reservation stays spent
        stats[team]['ok'] += 1
        stats[team]['tokens'] += used
        stats[team]['cost'] += prompt * PRICE[model][0] + out * PRICE[model][1]
    return stats, now / 1000


for refund in (True, False):
    stats, seconds = simulate(refund)
    print('reserve, then refund the unused part:' if refund else 'reserve and never refund:')
    for (name, cap, rate), s in zip(TEAMS, stats):
        print(f"  {name}: {s['ok']} served, {s['rejected']} rejected, {s['tokens']} tokens, cost {s['cost']} micro-dollars")
        allowed = cap + rate * seconds  # a bucket can never hand out more than this
        if s['tokens'] > allowed:
            print('budget exceeded')
            sys.exit(1)


def served(r):
    return sum(s['ok'] for s in r[0])


with_refund, without = served(simulate(True)), served(simulate(False))
print(f'served with refund: {with_refund}, without: {without}')
if with_refund <= without:
    sys.exit(1)
