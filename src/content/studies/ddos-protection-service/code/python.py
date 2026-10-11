# An edge shield core, in Python:
# a WAF that adds up rule points (anomaly scoring), and a detector that learns normal traffic and switches on a challenge for unfamiliar clients.
import sys

RULES = [('union select', 4), ('<script', 4), ('../', 5), ("' or ", 4), ('--', 1), ('select ', 1)]  # a needle and its points
BLOCK_AT = 5


# One weak signal is logged, several weak signals together are blocked.
def score(req):
    text = req['path'].lower()
    total = 0
    for needle, points in RULES:
        if needle in text:
            total += points
    if req['ua'] == '':  # real browsers always send a user agent
        total += 2
    return total


# Learns the normal request rate. While it sees an attack it stops learning, or the attack would become "normal".
class Baseline:
    def __init__(self):
        self.mean = 100
        self.dev = 10
        self.hot = 0

    def observe(self, rate):
        if rate > self.mean + 4 * self.dev:
            self.hot += 1
        else:
            self.hot = 0
            self.dev = 0.8 * self.dev + 0.2 * abs(rate - self.mean)
            self.mean = 0.8 * self.mean + 0.2 * rate
        return self.hot >= 2  # two seconds in a row above the limit


seed = 2024


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


samples = [
    {'path': '/search?q=blue shoes', 'ua': 'Mozilla'},
    {'path': '/search?q=select a size -- how', 'ua': 'Mozilla'},
    {'path': "/item?id=1' or 1=1 --", 'ua': 'Mozilla'},
    {'path': '/comment?body=<script>alert(1)</script>', 'ua': 'Mozilla'},
    {'path': '/comment?body=<script>alert(1)</script>', 'ua': ''},
    {'path': '/../../etc/passwd', 'ua': 'Mozilla'},
]
scores = [score(s) for s in samples]
print(f"waf scores: {' '.join(str(s) for s in scores)}; blocked: {' '.join('yes' if s >= BLOCK_AT else 'no' for s in scores)}")

IP_LIMIT = 20  # requests per IP per second
baseline = Baseline()
detected_at = -1
challenge_from = -1
stat = {'real_in': 0, 'real_blocked': 0, 'bot_in': 0, 'bot_ip_limited': 0, 'bot_challenged': 0, 'bot_passed': 0, 'bot_before': 0}
for t in range(60):
    real = 100 + random(21) - 10
    bots = 900 + random(41) - 20 if t >= 20 else 0  # from second 20, 300 IPs send about 3 requests per second each
    if detected_at < 0 and baseline.observe(real + bots):
        detected_at = t
        challenge_from = t + 2  # the rule takes 2 more seconds to reach the edge
    challenge = challenge_from >= 0 and t >= challenge_from
    for _ in range(real):
        stat['real_in'] += 1
        fp = 100 + random(5) if random(100) < 2 else random(12)  # fingerprints 0 to 11 are common browsers, 100 and up are rare ones
        if challenge and fp >= 100 and random(100) >= 90:  # a few real people fail the challenge
            stat['real_blocked'] += 1
    per_ip = [0] * 300
    for _ in range(bots):
        stat['bot_in'] += 1
        ip = random(300)
        random(3)  # the bots use 3 fingerprints, all unknown
        per_ip[ip] += 1
        if per_ip[ip] > IP_LIMIT:
            stat['bot_ip_limited'] += 1
            continue
        if challenge and random(100) >= 5:
            stat['bot_challenged'] += 1
            continue
        stat['bot_passed'] += 1
        if not challenge:
            stat['bot_before'] += 1

print(f"attack detected at second {detected_at}, challenge from second {challenge_from}")
print(f"bot requests: {stat['bot_in']}; stopped by the per-IP limit: {stat['bot_ip_limited']}; stopped by the challenge: {stat['bot_challenged']}; passed: {stat['bot_passed']} ({stat['bot_before']} before the challenge)")
print(f"real requests: {stat['real_in']}; blocked by mistake: {stat['real_blocked']}")

ok = ''.join(str(s) for s in scores) == '025465' and detected_at == 21 and stat['bot_passed'] < stat['bot_in'] * 0.15 and stat['real_blocked'] < stat['real_in'] * 0.01 and stat['bot_ip_limited'] == 0
if not ok:
    sys.exit(1)
