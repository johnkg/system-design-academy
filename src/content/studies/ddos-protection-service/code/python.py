# An edge shield core, in Python:
# a WAF that adds up rule points (anomaly scoring), and a detector that learns normal traffic and switches on a challenge for unfamiliar clients.
import sys

RULES = [('union select', 4), ('<script', 4), ('../', 5), ("' or ", 4), ('--', 1), ('select ', 1)]  # a needle and its points
BLOCK_AT = 5
NO_UA_POINTS = 2
# Baseline: starting guess, alert above mean + 4 deviations, exponential smoothing weights, seconds in a row to alert.
INITIAL_MEAN, INITIAL_DEV, ALERT_DEVS, KEEP, LEARN, HOT_SECONDS = 100, 10, 4, 0.8, 0.2, 2


# One weak signal is logged, several weak signals together are blocked.
def score(req):
    text = req['path'].lower()
    total = 0
    for needle, points in RULES:
        if needle in text:
            total += points
    if req['ua'] == '':  # real browsers always send a user agent
        total += NO_UA_POINTS
    return total


# Learns the normal request rate. While it sees an attack it stops learning, or the attack would become "normal".
class Baseline:
    def __init__(self):
        self.mean = INITIAL_MEAN
        self.dev = INITIAL_DEV
        self.hot = 0

    def observe(self, rate):
        if rate > self.mean + ALERT_DEVS * self.dev:
            self.hot += 1
        else:
            self.hot = 0
            self.dev = KEEP * self.dev + LEARN * abs(rate - self.mean)
            self.mean = KEEP * self.mean + LEARN * rate
        return self.hot >= HOT_SECONDS  # two seconds in a row above the limit


SEED = 2024
seed = SEED


def random(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
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
SECONDS, REAL_RATE, REAL_JITTER = 60, 100, 10
ATTACK_START, BOT_RATE, BOT_JITTER, BOT_IPS, BOT_FINGERPRINTS = 20, 900, 20, 300, 3
RULE_DELAY = 2  # seconds for the challenge rule to reach the edge
RARE_PERCENT, RARE_FP, RARE_KINDS, COMMON_FPS = 2, 100, 5, 12  # browser fingerprints
REAL_FAIL_PERCENT, BOT_PASS_PERCENT = 10, 5  # who fails or passes the challenge
MAX_BOT_PASSED, MAX_REAL_BLOCKED = 0.15, 0.01  # acceptance limits, as fractions
baseline = Baseline()
detected_at = -1
challenge_from = -1
stat = {'real_in': 0, 'real_blocked': 0, 'bot_in': 0, 'bot_ip_limited': 0, 'bot_challenged': 0, 'bot_passed': 0, 'bot_before': 0}
for t in range(SECONDS):
    real = REAL_RATE + random(2 * REAL_JITTER + 1) - REAL_JITTER
    bots = BOT_RATE + random(2 * BOT_JITTER + 1) - BOT_JITTER if t >= ATTACK_START else 0  # from second 20, 300 IPs send about 3 requests per second each
    if detected_at < 0 and baseline.observe(real + bots):
        detected_at = t
        challenge_from = t + RULE_DELAY  # the rule takes 2 more seconds to reach the edge
    challenge = challenge_from >= 0 and t >= challenge_from
    for _ in range(real):
        stat['real_in'] += 1
        fp = RARE_FP + random(RARE_KINDS) if random(100) < RARE_PERCENT else random(COMMON_FPS)  # fingerprints 0 to 11 are common browsers, 100 and up are rare ones
        if challenge and fp >= RARE_FP and random(100) >= 100 - REAL_FAIL_PERCENT:  # a few real people fail the challenge
            stat['real_blocked'] += 1
    per_ip = [0] * BOT_IPS
    for _ in range(bots):
        stat['bot_in'] += 1
        ip = random(BOT_IPS)
        random(BOT_FINGERPRINTS)  # the bots use 3 fingerprints, all unknown
        per_ip[ip] += 1
        if per_ip[ip] > IP_LIMIT:
            stat['bot_ip_limited'] += 1
            continue
        if challenge and random(100) >= BOT_PASS_PERCENT:
            stat['bot_challenged'] += 1
            continue
        stat['bot_passed'] += 1
        if not challenge:
            stat['bot_before'] += 1

print(f"attack detected at second {detected_at}, challenge from second {challenge_from}")
print(f"bot requests: {stat['bot_in']}; stopped by the per-IP limit: {stat['bot_ip_limited']}; stopped by the challenge: {stat['bot_challenged']}; passed: {stat['bot_passed']} ({stat['bot_before']} before the challenge)")
print(f"real requests: {stat['real_in']}; blocked by mistake: {stat['real_blocked']}")

ok = ''.join(str(s) for s in scores) == '025465' and detected_at == 21 and stat['bot_passed'] < stat['bot_in'] * MAX_BOT_PASSED and stat['real_blocked'] < stat['real_in'] * MAX_REAL_BLOCKED and stat['bot_ip_limited'] == 0
if not ok:
    sys.exit(1)
