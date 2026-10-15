# An SMS and one-time-password pipeline, in Python:
# dedupe by key, a pumping guard, cheapest-first routing with failover and circuit breakers, then OTP checks.
import sys

M = 0xFFFFFFFF
seed = 7

def next_int():
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
    roll = next_int() % 1000
    up = not (p["name"] == "A" and 800 <= i < 1600)  # provider A is down for requests 800 to 1599
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
        if p["fails"] >= 5:  # open the breaker; one more failure re-opens it after a trial
            p["until"] = i + 200
            p["opens"] += 1
        stats["failovers"] += 1
    return None


stats = dict(dupes=0, blocked=0, saved=0, delivered=0, lost=0, failovers=0, spend=0)
seen = set()
ranges = [dict(sent=0, ok=0) for _ in MULT]
for i in range(3000):
    key = i - 1 if i % 10 == 9 else i  # every 10th request is a client retry of the one before it
    if key in seen:
        stats["dupes"] += 1
        continue
    seen.add(key)
    attacker = i >= 1000 and i % 5 == 3
    prefix = 2 if attacker else (0 if next_int() % 100 < 80 else 1)
    r = ranges[prefix]
    if r["sent"] >= 30 and r["ok"] * 10 < r["sent"]:  # under 10% verified
        stats["blocked"] += 1
        stats["saved"] += providers[0]["price"] * MULT[prefix]
        continue
    r["sent"] += 1
    if route(i, prefix, stats):
        stats["delivered"] += 1
        if not attacker and next_int() % 100 < 85:  # a real user types the code in; a pumping bot never does
            r["ok"] += 1
    else:
        stats["lost"] += 1
print(f"requests 3000, duplicate keys ignored {stats['dupes']}, blocked by the pumping guard {stats['blocked']} (saves {stats['saved']})")
for p in providers:
    print(f"{p['name']}: {p['ok']} delivered of {p['tries']} tries, breaker opened {p['opens']} times")
print(f"delivered {stats['delivered']}, lost {stats['lost']}, failovers {stats['failovers']}, spend {stats['spend']}")
if stats["delivered"] + stats["lost"] + stats["blocked"] + stats["dupes"] != 3000:
    sys.exit(1)

# One-time passwords: 6 digits, kept only as a salted hash, valid for 300 s, 5 wrong guesses, then locked.
def issue(now):
    code = (next_int() * 65536 + next_int()) % 1000000
    salt = next_int()
    return code, dict(salt=salt, hash=mix(code ^ ((salt * 40503) & M)), expires=now + 300, tries=0, used=False)

def verify(rec, guess, now):
    if rec["used"]:
        return "used"
    if now > rec["expires"]:
        return "expired"
    if rec["tries"] >= 5:
        return "locked"
    rec["tries"] += 1
    if mix(guess ^ ((rec["salt"] * 40503) & M)) != rec["hash"]:
        return "wrong"
    rec["used"] = True
    return "ok"


a_code, a_rec = issue(0)
b_code, b_rec = issue(0)
c_code, c_rec = issue(0)
guessing = [verify(a_rec, a_code if n == 6 else (a_code + n) % 1000000, n) for n in range(1, 7)]
results = [",".join(guessing), verify(b_rec, b_code, 299) + "," + verify(b_rec, b_code, 300), verify(c_rec, c_code, 301)]
print(f"six guesses, last one right: {results[0]}")
print(f"right at 299 s then again: {results[1]}; right at 301 s: {results[2]}")
if results[0] != "wrong,wrong,wrong,wrong,wrong,locked" or results[1] != "ok,used" or results[2] != "expired":
    sys.exit(1)
