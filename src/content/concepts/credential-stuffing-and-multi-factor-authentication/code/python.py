# Credential stuffing in a toy model: an attacker replays 20,000 email and password pairs leaked from another site against
# this site's login, from many addresses, once per pair. 2,000 of the pairs are for real accounts here, and some users reuse
# the leaked password. Then we turn on defences one at a time and see which ones matter.
# What to look for: per-IP and per-account limits barely touch the attack (it is spread out, one try per account),
# a password breach check and multi-factor authentication do, SMS, TOTP and tap-to-approve push each fail in their own way,
# and account recovery can undo all of it.
# Seeded integer generator, fixed events, integers only: the output never changes. Every rate here is an assumption of the toy.

USERS, ATTEMPTS, SEED = 2000, 20000, 12345
state = SEED


def nxt():
    global state
    state = (state * 48271) % 2147483647  # MINSTD: the same sequence in every language
    return state


# Each user's random facts, drawn up front so changing a setting never changes who is who.
def make_world():
    global state
    state = SEED
    users = []
    for _ in range(USERS):
        d = [nxt() % 100 for _ in range(11)]
        users.append({"reuse": d[0], "enrol": d[1], "fooled": d[2], "sim_swap": d[3], "mail": d[4], "known": d[5], "tap": d[6:11]})
    ip_raw = [nxt() for _ in range(ATTEMPTS)]
    return users, ip_raw


USER_LIST, IP_RAW = make_world()

DEFAULTS = {"reusePct": 10, "ips": 5000, "ipLimit": 0, "acctLimit": 0, "breachCover": 0, "mfa": "none", "enrolPct": 50, "relay": False, "recovery": "email"}


# Assumptions: 20% of owners are fooled by a live phishing page, 2% have a phone number that can be taken over (SIM swap),
# a tired owner approves a tap prompt 10% of the time and gets 5 prompts, 3% of owners' email accounts also fall to the leak.
def simulate(over):
    c = {**DEFAULTS, **over}
    ip_fails = [0] * c["ips"]
    acct_fails = [0] * USERS
    blocked_ip = blocked_acct = screened = hits = 0
    hit = []
    for i in range(ATTEMPTS):
        ip = IP_RAW[i] % c["ips"]
        if c["ipLimit"] > 0 and ip_fails[ip] >= c["ipLimit"]:
            blocked_ip += 1
            continue
        u = i // 10 if i % 10 == 0 else -1  # one in ten pairs is for an account that exists here
        if u < 0:
            ip_fails[ip] += 1
            continue
        if c["acctLimit"] > 0 and acct_fails[u] >= c["acctLimit"]:
            blocked_acct += 1
            continue
        w = USER_LIST[u]
        if w["reuse"] < c["reusePct"]:
            if c["breachCover"] > 0 and w["known"] < c["breachCover"]:  # known-breached password: reset required, no login
                screened += 1
                continue
            hits += 1
            hit.append(u)
        else:
            ip_fails[ip] += 1
            acct_fails[u] += 1

    def enrolled(w):
        return c["mfa"] != "none" and w["enrol"] < c["enrolPct"]

    def by_fatigue(w):
        return any(d < 10 for d in w["tap"])

    def mfa_beaten(w):
        relayed = c["relay"] and w["fooled"] < 20
        if c["mfa"] == "sms":
            return relayed or w["sim_swap"] < 2
        if c["mfa"] in ("totp", "pushnm"):
            return relayed
        if c["mfa"] == "push":
            return relayed or by_fatigue(w)
        return False  # passkey: bound to the real site, so a relay or a prompt gets nothing

    taken = set()
    stopped = 0
    for u in hit:
        w = USER_LIST[u]
        if not enrolled(w) or mfa_beaten(w):
            taken.add(u)
        else:
            stopped += 1
    via_password = len(taken)
    for u in range(USERS):
        w = USER_LIST[u]
        if u in taken or w["mail"] >= 3:  # the attacker also holds this owner's email password
            continue
        if c["recovery"] == "email" or not enrolled(w):  # email-only recovery skips the second factor
            taken.add(u)
    return {"blockedIp": blocked_ip, "blockedAcct": blocked_acct, "screened": screened, "hits": hits, "stopped": stopped,
            "viaPassword": via_password, "viaRecovery": len(taken) - via_password, "total": len(taken)}


def show(label, over):
    r = simulate(over)
    print(f"{label}: password hits {r['hits']} (blocked by IP limit {r['blockedIp']}, by account limit {r['blockedAcct']}, by breach check {r['screened']}), stopped by MFA {r['stopped']}, taken over {r['viaPassword']} + {r['viaRecovery']} by recovery = {r['total']}")


print(f"{USERS} accounts, {ATTEMPTS} leaked pairs, 10% of users reuse a leaked password")
show("no defences, 5000 IPs", {})
show("no defences, 20 IPs", {"ips": 20})
show("per-IP limit 20, 20 IPs", {"ips": 20, "ipLimit": 20})
show("per-IP limit 20, 5000 IPs", {"ipLimit": 20})
show("per-account limit 5, 5000 IPs", {"acctLimit": 5})
show("breach check 70%, 5000 IPs", {"breachCover": 70})
for mfa in ["sms", "totp", "push", "pushnm", "passkey"]:
    show(f"{mfa}, 50% enrolled", {"mfa": mfa})
for mfa in ["sms", "totp", "push", "pushnm", "passkey"]:
    show(f"{mfa}, 50% enrolled, phishing relay", {"mfa": mfa, "relay": True})
show("passkey, 100% enrolled, email recovery", {"mfa": "passkey", "enrolPct": 100})
show("passkey, 100% enrolled, recovery needs the factor", {"mfa": "passkey", "enrolPct": 100, "recovery": "email+mfa"})
show("everything: 20 IPs limit 20, breach 70, totp 100%, strict recovery", {"ips": 20, "ipLimit": 20, "breachCover": 70, "mfa": "totp", "enrolPct": 100, "recovery": "email+mfa"})
