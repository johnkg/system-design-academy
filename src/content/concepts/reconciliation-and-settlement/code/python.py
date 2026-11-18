# Reconciliation: match your records with the payment provider's, classify what does not agree, count the money at stake.
# 200 generated transactions with injected breaks from a seeded generator, so every run prints the same text. Integers only.
SEED = 20261128
COUNT = 200
PRICES = [499, 999, 1999, 4900]  # few distinct prices on purpose: many payments look alike, so a fuzzy match can pick the wrong one
DAYS = 7                         # transactions fall on days 1 to 7
CLASSES = ["timing shift", "missing at provider", "missing in our records", "duplicate", "amount off by fee", "status differs", "no reference id"]


def fee_of(amount):
    """The provider's fee: 2.9% (half up) plus 30 cents."""
    return (amount * 290 + 5000) // 10000 + 30


def make_rng(seed):
    """A small seeded generator (Park-Miller): the same seed always gives the same numbers."""
    state = [seed]

    def rng(n):
        state[0] = (state[0] * 48271) % 2147483647
        return state[0] % n

    return rng


def generate(rate_pct):
    """Your records and the provider's records of the same payments, with breaks injected at rate_pct percent."""
    r = make_rng(SEED)
    ours, provider, injected = [], [], [0] * len(CLASSES)
    for i in range(1, COUNT + 1):
        tid = "T" + str(i).zfill(4)
        amount = PRICES[r(len(PRICES))]
        day = 1 + r(DAYS)
        status = "refunded" if r(100) < 15 else "captured"
        broken = r(100) < rate_pct
        cls = r(len(CLASSES))  # always drawn, so a higher rate only adds breaks
        row = {"id": tid, "trueId": tid, "amount": amount, "day": day, "status": status}
        mine = {"id": tid, "amount": amount, "day": day, "status": status}
        kind = cls if broken else -1
        if broken:
            injected[cls] += 1
        if kind != 2:  # missing in our records: the provider has it, we never wrote it down
            ours.append(mine)
        if kind == 1:  # missing at provider: no row on their side
            continue
        if kind == 0:  # paid at 23:59, booked by the provider the next day
            row["day"] = day + 1
        if kind == 4:  # the provider reports the amount net of its fee
            row["amount"] = amount - fee_of(amount)
        if kind == 5:
            row["status"] = "refunded" if status == "captured" else "captured"
        if kind == 6:  # the reference did not make it into the provider's file
            row["id"] = ""
        provider.append(row)
        if kind == 3:  # the same payment delivered twice
            provider.append(dict(row))
    return ours, provider, injected


def reconcile(ours, provider, rule, n):
    """rule: 'id' (the id alone), 'fee' (id, and the amount may be lower by the fee), 'window' (id, and the date within n days),
    'fuzzy' (id; rows without an id are matched by amount and a date within n days)."""
    by_id = {o["id"]: o for o in ours}
    matched_ours, pairs, unmatched_p, deferred = set(), [], [], []
    for p in provider:
        if p["id"] == "":
            deferred.append(p)
            continue
        o = by_id.get(p["id"])
        if o is None or o["id"] in matched_ours:  # unknown id, or a second row for an id already matched
            unmatched_p.append(p)
            continue
        if rule == "fee":
            ok = p["amount"] <= o["amount"] and o["amount"] - p["amount"] <= fee_of(o["amount"])
        elif rule == "window":
            ok = abs(p["day"] - o["day"]) <= n
        else:
            ok = True
        if ok:
            matched_ours.add(o["id"])
            pairs.append((o, p))
        else:
            unmatched_p.append(p)
    for p in deferred:
        if rule != "fuzzy":
            unmatched_p.append(p)
            continue
        best = None
        for o in ours:
            if o["id"] in matched_ours or o["amount"] != p["amount"] or abs(o["day"] - p["day"]) > n:
                continue
            if best is None or abs(o["day"] - p["day"]) < abs(best["day"] - p["day"]):  # closest date, then the lowest id
                best = o
        if best is not None:
            matched_ours.add(best["id"])
            pairs.append((best, p))
        else:
            unmatched_p.append(p)
    unmatched_o = [o for o in ours if o["id"] not in matched_ours]

    # Classify what is left, from what can be seen in the two files.
    exceptions = {}

    def add(cls, text):
        exceptions.setdefault(cls, []).append(text)

    used_p = set()
    for o in unmatched_o:
        k = next((i for i, x in enumerate(unmatched_p) if x["id"] == o["id"] and i not in used_p), -1)
        if k >= 0:
            used_p.add(k)
            add("same id, rejected by the rule", o["id"])
        else:
            add("missing at provider", o["id"])
    for i, p in enumerate(unmatched_p):
        if i in used_p:
            continue
        if p["id"] == "":
            add("no reference id", f"{p['amount']} on day {p['day']}")
        elif p["id"] in matched_ours:
            add("duplicate", p["id"])
        else:
            add("missing in our records", p["id"])
    for o, p in pairs:
        if o["day"] != p["day"]:
            add("date differs", o["id"])
        if o["amount"] != p["amount"] and not (rule == "fee" and p["amount"] < o["amount"] and o["amount"] - p["amount"] <= fee_of(o["amount"])):
            add("amount differs", o["id"])
        if o["status"] != p["status"]:
            add("status differs", o["id"])
    correct = sum(1 for o, p in pairs if o["id"] == p["trueId"])
    total = lambda rows: sum(x["amount"] for x in rows)
    unexplained = total(unmatched_o) + total(unmatched_p)
    for o, p in pairs:
        tolerated = rule == "fee" and p["amount"] <= o["amount"] and o["amount"] - p["amount"] <= fee_of(o["amount"])
        if not tolerated:
            unexplained += abs(o["amount"] - p["amount"])
    return {"matched": len(pairs), "correct": correct, "false": len(pairs) - correct, "unmatched_o": len(unmatched_o),
            "unmatched_p": len(unmatched_p), "difference": total(ours) - total(provider), "unexplained": unexplained, "exceptions": exceptions}


RULES = [("id", "exact id only"), ("fee", "id and amount within the fee"), ("window", "id and date within the window"), ("fuzzy", "id, then fuzzy by amount and date")]
for rate_pct in (0, 10, 25):
    ours, provider, injected = generate(rate_pct)
    print(f"-- break rate {rate_pct}%: {len(ours)} of our records, {len(provider)} of the provider's, {sum(injected)} breaks injected")
    print("  injected: " + ", ".join(f"{c} {injected[i]}" for i, c in enumerate(CLASSES)))
    for rule, label in RULES:
        for n in ([1] if rule in ("id", "fee") else [0, 1, 3]):
            if rate_pct == 0 and n != 1:
                continue
            x = reconcile(ours, provider, rule, n)
            ex = ", ".join(f"{c} {len(l)}" for c, l in sorted(x["exceptions"].items())) or "none"
            suffix = f" ({n} days)" if rule in ("window", "fuzzy") else ""
            print(f"  {label}{suffix}: matched {x['matched']} (false {x['false']}), unmatched ours {x['unmatched_o']}, provider {x['unmatched_p']}; "
                  f"money difference {x['difference']}, unexplained {x['unexplained']}; {ex}")
