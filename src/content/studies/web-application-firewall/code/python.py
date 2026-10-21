# An anomaly-scoring web application firewall, in Python:
# every rule that matches adds points, a rate rule adds more for a noisy client, and the total is compared with a threshold.
# In detection-only mode the verdict is logged but nothing is blocked.

# Each rule has a part of the request to look at, a text to find, and the points it adds.
RULES = [
    ("sqli-union", "url", "union select", 5),
    ("sqli-tautology", "url", "or 1=1", 5),
    ("xss-script", "url", "<script", 5),
    ("path-traversal", "url", "../", 4),
    ("sql-keyword", "url", "select ", 2),
    ("sql-comment", "url", "--", 2),
    ("scanner-agent", "agent", "sqlmap", 5),
    ("script-agent", "agent", "python-requests", 2),
]
RATE_LIMIT, RATE_POINTS, WINDOW = 3, 3, 50  # more than 3 requests from one client in 50 requests adds 3 points


def normalise(s):
    # Undo the common encodings first, otherwise "%2e%2e%2f" would hide a "../".
    return s.lower().replace("+", " ").replace("%27", "'").replace("%3c", "<").replace("%2e%2e%2f", "../")


def score(req, count_from_client):
    parts = {"url": normalise(req["url"]), "agent": req["agent"].lower()}
    total = 0
    for _, part, find, points in RULES:
        if find in parts[part]:
            total += points
    if count_from_client > RATE_LIMIT:
        total += RATE_POINTS
    return total


# A seeded generator, so every run sees the same traffic.
REQUESTS = 1000
ATTACK_FROM = 80  # r is 0..99: r >= 80 is an attack (20%)
STRONG_UPTO = 92  # attacks: obvious payload below 92, evasive above
NORMAL_UPTO = 70  # users: plain URL below 70, tricky but harmless above
ATTACKERS = 3  # attacker client ids 1..3
USER_ID_FROM = 10  # user client ids 10..59
USERS = 50
DEFAULT_THRESHOLD = 5  # anomaly score that blocks

seed = 77


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


def pick(items):
    return items[rnd(len(items))]


NORMAL = ["/search?q=red+shoes", "/cart/add?id=42", "/products?page=3", "/account/orders"]
TRICKY = ["/help?q=select+a+plan--annual", "/blog?q=how+to+select+a+laptop", "/search?q=a--b+select+size"]
STRONG = ["/item?id=1+union+select+password+from+users--", "/c?q=%3cscript>alert(1)</script>", "/login?u=x%27+or+1=1"]
EVASIVE = ["/item?id=1;select+sleep(5)", "/f?p=%2e%2e%2fetc/passwd", "/item?id=1+or+1=1"]
BROWSER, BOT = "Mozilla/5.0", "python-requests/2.31"

traffic = []
seen = {}  # requests per client in the current window
for i in range(REQUESTS):
    if i % WINDOW == 0:
        seen.clear()
    r = rnd(100)
    attack = r >= ATTACK_FROM
    if attack:
        url = pick(STRONG if r < STRONG_UPTO else EVASIVE)
        agent = BOT if rnd(2) else BROWSER
        client = 1 + rnd(ATTACKERS)
    else:
        url = pick(NORMAL if r < NORMAL_UPTO else TRICKY)
        agent = BROWSER
        client = USER_ID_FROM + rnd(USERS)
    seen[client] = seen.get(client, 0) + 1
    req = {"url": url, "agent": agent, "client": client, "attack": attack}
    req["points"] = score(req, seen[client])
    traffic.append(req)


def run(threshold, detection_only):
    o = {"blocked_attacks": 0, "blocked_users": 0, "missed": 0, "would_block": 0}
    for t in traffic:
        flagged = t["points"] >= threshold
        blocked = flagged and not detection_only
        if flagged:
            o["would_block"] += 1
        if blocked:
            o["blocked_attacks" if t["attack"] else "blocked_users"] += 1
        if t["attack"] and not blocked:
            o["missed"] += 1
    return o


print(f"traffic: {len(traffic)} requests, {sum(1 for t in traffic if t['attack'])} attacks")
for threshold in [2, 4, 5, 8]:
    o = run(threshold, False)
    print(f"threshold {threshold}: blocked attacks {o['blocked_attacks']}, blocked real users {o['blocked_users']}, attacks let through {o['missed']}")
watch = run(DEFAULT_THRESHOLD, True)
print(f"detection only at 5: would block {watch['would_block']}, blocked {watch['blocked_attacks'] + watch['blocked_users']}")

strict, normal, loose = run(2, False), run(DEFAULT_THRESHOLD, False), run(8, False)
ok = (strict["blocked_users"] > normal["blocked_users"] and loose["missed"] > normal["missed"]
      and watch["blocked_attacks"] + watch["blocked_users"] == 0 and normal["would_block"] == watch["would_block"])
print(f"stricter threshold blocks more real users, looser lets more attacks through: {str(ok).lower()}")
if not ok:
    raise SystemExit(1)
