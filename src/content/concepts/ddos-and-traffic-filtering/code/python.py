# A toy tick simulation of three kinds of flood against one service, and seven ways of filtering.
# Every number is a made-up round figure chosen to show the shape of each attack, not a measurement of a real system.
# Legitimate load per tick: 60 home users with their own IP sending 2 requests each, plus one office behind a single NAT IP
# sending 80 requests: 200 in total. Attack intensity varies by 90 to 110 percent per tick from a seeded generator.
# Volumetric: packets that fill the origin's 1,000 unit link. SYN flood: spoofed SYNs that fill a 1,024 entry half-open table
# (each entry lives 5 ticks). HTTP flood: 500 real bot IPs each sending 4 valid requests per tick at an app that handles 600.
# Edge scrubbing: 8 sites of 1,000 units each; it removes 95% of a volumetric flood, proxies SYNs, drops 30% of bot requests by
# reputation, and wrongly drops 2% of legitimate traffic. A challenge is passed by 95% of legitimate users and 10% of bots.
# Assumptions: a blocklist of 10 IPs takes the 10 busiest IPs; spoofed sources are random, so IP-based filters cannot match them.

TICKS, HOMES, HOME_RATE, OFFICE = 10, 60, 2, 80
LEGIT = HOMES * HOME_RATE + OFFICE
LINK_CAP, VOLUME, SYN_RATE, TABLE, SYN_HOLD = 1000, 5000, 3000, 1024, 5
BOTS, BOT_RATE, APP_CAP, POPS, POP_CAP, BLOCKLIST = 500, 4, 600, 8, 1000, 10
LIMITS = {"limit3": 3, "limit1": 1}


def make_rng(seed):
    state = [seed]

    def rng():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]

    return rng


# Legitimate requests left after the defence itself has acted ("collateral damage" is LEGIT minus this).
def legit_after(defense, stage):
    if defense == "block":
        return LEGIT - OFFICE  # the office NAT IP is the busiest IP, so it is blocked first
    if defense in LIMITS:
        return HOMES * min(HOME_RATE, LIMITS[defense]) + min(OFFICE, LIMITS[defense])
    if defense == "challenge":
        return (LEGIT * 95) // 100 if stage == "app" else LEGIT
    if defense == "edge":
        return (LEGIT * 98) // 100
    return LEGIT


def sim(attack, defense, scale):
    rng = make_rng(7)
    expiring = [0] * (TICKS + SYN_HOLD + 1)
    used = served = filtered = through = 0
    for t in range(TICKS):
        m = 90 + (rng() % 21)
        legit = legit_after(defense, "app" if attack == "http" else "ip")
        filtered += LEGIT - legit
        l, at = legit, 0
        if attack == "volumetric":
            a = (VOLUME * scale * m) // 100
            if defense == "edge":
                at = (a * 5) // 100
                cap = POPS * POP_CAP
                if a + LEGIT > cap:
                    l = (l * cap) // (a + LEGIT)
                    at = (at * cap) // (a + LEGIT)
            else:
                offered = a + LEGIT  # the link fills before any filter behind it can act
                share = (LEGIT * LINK_CAP) // offered if offered > LINK_CAP else LEGIT
                l = (share * legit) // LEGIT
                at = (a * LINK_CAP) // offered if offered > LINK_CAP else a
        elif attack == "syn":
            a = (SYN_RATE * scale * m) // 100
            if defense != "edge" and defense != "cookies":
                used -= expiring[t]
                arrivals = a + legit
                admitted = min(TABLE - used, arrivals)
                l = (admitted * legit) // arrivals
                at = admitted - l  # half-open entries held by spoofed sources
                used += admitted
                expiring[t + SYN_HOLD] += admitted
        else:
            n = (BOTS * scale * m) // 100
            if defense == "block":
                at = max(0, n - (BLOCKLIST - 1)) * BOT_RATE  # 1 slot goes to the office, 9 to bots
            elif defense in LIMITS:
                at = n * min(BOT_RATE, LIMITS[defense])
            elif defense == "edge":
                at = (n * BOT_RATE * 70) // 100
            elif defense == "challenge":
                at = (n * BOT_RATE * 10) // 100
            else:
                at = n * BOT_RATE
            arrivals = at + legit
            if arrivals > APP_CAP:
                l = (APP_CAP * legit) // arrivals
                at = (APP_CAP * at) // arrivals
        served += l
        through += at
    pct = lambda x: (x * 100) // (LEGIT * TICKS)
    return f"legit served {pct(served)}%, dropped by the filter itself {pct(filtered)}%, attack reaching the service {through // TICKS} per tick"


for attack in ["volumetric", "syn", "http"]:
    for defense in ["none", "block", "limit3", "limit1", "edge", "cookies", "challenge"]:
        print(f"{attack} / {defense}: {sim(attack, defense, 1)}")
print(f"volumetric x2 / none: {sim('volumetric', 'none', 2)}")
print(f"volumetric x2 / edge: {sim('volumetric', 'edge', 2)}")
