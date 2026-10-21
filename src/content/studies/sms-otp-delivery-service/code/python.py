# An SMS and one-time-password pipeline, in Python:
# dedupe by key, a pumping guard, cheapest-first routing with failover and circuit breakers, then OTP checks.
import sys

M = 0xFFFFFFFF
SEED, PER_MILLE = 7, 1000
OUTAGE_FROM, OUTAGE_TO = 800, 1600        # provider A is down for these requests
BREAKER_FAILS, COOL_DOWN = 5, 200         # failures in a row that open a breaker, requests it stays open
REQUESTS, RETRY_EVERY = 3000, 10          # every 10th request is a client retry
ATTACK_FROM, ATTACK_EVERY, PREMIUM, STANDARD_PERCENT = 1000, 5, 2, 80
# The pumping guard: after 30 sends to a range, block it if fewer than 1 in 10 codes were verified.
GUARD_MIN_SENT, GUARD_RATIO, VERIFY_PERCENT = 30, 10, 85
# OTPs: 6 digits, valid for 300 s, 5 tries; the salt is folded in with a multiplier before hashing.
HALF_WORD, CODE_SPACE, OTP_TTL, MAX_TRIES, SALT_MIX = 65536, 1000000, 300, 5, 40503
seed = SEED

def next_int():
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) & M
    return seed >> 16

def mix(x):  # a small integer hash (a real service uses HMAC-SHA256 with a secret key)
    x &= M
    x = ((x ^ (x >> 16)) * 0x45D9F3B) & M
    x = ((x ^ (x >> 16)) * 0x45D9F3B) & M
    return (x ^ (x >> 16)) & M

# price is in hundredths of a cent per message; good is deliveries per 1000 when healthy
providers = [dict(name=n, price=p, good=g, fails=0, until=0, tries=0, ok=0, opens=0)
             for n, p, g in [("A", 450, 970), ("B", 600, 985), ("C", 900, 995)]]
MULT = [1, 2, 12]  # price factor per destination range; range 2 is a premium range that pumping attackers abuse

def attempt(p, i):
    roll = next_int() % PER_MILLE
    up = not (p["name"] == "A" and OUTAGE_FROM <= i < OUTAGE_TO)  # provider A is down for requests 800 to 1599
    return up and roll < p["good"]

def route(i, prefix, stats):
    """Cheapest first. A provider whose breaker is open is skipped until its cool-down ends, then it gets one trial."""
    for p in providers:
        if i < p["until"]:
            continue
        p["tries"] += 1
        if attempt(p, i):
            p["fails"] = 0
            p["ok"] += 1
            stats["spend"] += p["price"] * MULT[prefix]
            return p
        p["fails"] += 1
        if p["fails"] >= BREAKER_FAILS:  # open the breaker; one more failure re-opens it after a trial
            p["until"] = i + COOL_DOWN
            p["opens"] += 1
        stats["failovers"] += 1
    return None


stats = dict(dupes=0, blocked=0, saved=0, delivered=0, lost=0, failovers=0, spend=0)
seen = set()
ranges = [dict(sent=0, ok=0) for _ in MULT]
for i in range(REQUESTS):
    key = i - 1 if i % RETRY_EVERY == RETRY_EVERY - 1 else i  # every 10th request is a client retry of the one before it
    if key in seen:
        stats["dupes"] += 1
        continue
    seen.add(key)
    attacker = i >= ATTACK_FROM and i % ATTACK_EVERY == 3
    prefix = PREMIUM if attacker else (0 if next_int() % 100 < STANDARD_PERCENT else 1)
    r = ranges[prefix]
    if r["sent"] >= GUARD_MIN_SENT and r["ok"] * GUARD_RATIO < r["sent"]:  # under 10% verified
        stats["blocked"] += 1
        stats["saved"] += providers[0]["price"] * MULT[prefix]
        continue
    r["sent"] += 1
    if route(i, prefix, stats):
        stats["delivered"] += 1
        if not attacker and next_int() % 100 < VERIFY_PERCENT:  # a real user types the code in; a pumping bot never does
            r["ok"] += 1
    else:
        stats["lost"] += 1
print(f"requests 3000, duplicate keys ignored {stats['dupes']}, blocked by the pumping guard {stats['blocked']} (saves {stats['saved']})")
for p in providers:
    print(f"{p['name']}: {p['ok']} delivered of {p['tries']} tries, breaker opened {p['opens']} times")
print(f"delivered {stats['delivered']}, lost {stats['lost']}, failovers {stats['failovers']}, spend {stats['spend']}")
if stats["delivered"] + stats["lost"] + stats["blocked"] + stats["dupes"] != REQUESTS:
    sys.exit(1)

# One-time passwords: 6 digits, kept only as a salted hash, valid for 300 s, 5 wrong guesses, then locked.
def issue(now):
    code = (next_int() * HALF_WORD + next_int()) % CODE_SPACE
    salt = next_int()
    return code, dict(salt=salt, hash=mix(code ^ ((salt * SALT_MIX) & M)), expires=now + OTP_TTL, tries=0, used=False)

def verify(rec, guess, now):
    if rec["used"]:
        return "used"
    if now > rec["expires"]:
        return "expired"
    if rec["tries"] >= MAX_TRIES:
        return "locked"
    rec["tries"] += 1
    if mix(guess ^ ((rec["salt"] * SALT_MIX) & M)) != rec["hash"]:
        return "wrong"
    rec["used"] = True
    return "ok"


a_code, a_rec = issue(0)
b_code, b_rec = issue(0)
c_code, c_rec = issue(0)
guessing = [verify(a_rec, a_code if n == MAX_TRIES + 1 else (a_code + n) % CODE_SPACE, n) for n in range(1, MAX_TRIES + 2)]
results = [",".join(guessing), verify(b_rec, b_code, 299) + "," + verify(b_rec, b_code, 300), verify(c_rec, c_code, 301)]
print(f"six guesses, last one right: {results[0]}")
print(f"right at 299 s then again: {results[1]}; right at 301 s: {results[2]}")
if results[0] != "wrong,wrong,wrong,wrong,wrong,locked" or results[1] != "ok,used" or results[2] != "expired":
    sys.exit(1)
