# A reconciliation run over 3 days of card payments, three sources (ledger, processor files, bank deposits), with
# injected breaks: a late file, a duplicate file, a corrected file, missing rows, lost references, fee differences,
# refunds and chargebacks, and processors that cut the day off in different time zones.
# Money is integer cents and the "random" payments come from a seeded generator, so the output never changes.
DAY = 1440                  # minutes in a day
PER_DAY, DAYS = 200, 3      # payments per day, days of payments (UTC days 1 to 3)
BUCKETS = 5                 # business days 0 to 4: refunds and chargebacks land later, and time zones shift the day
OFFSET = [0, 60, -480]      # minutes from UTC where each processor cuts the day: UTC, UTC+1, UTC-8
SEED = 20260115
REFUND_AFTER, CHARGEBACK_AFTER = 1500, 2900  # minutes after the payment

state = SEED


def nxt(n):
    global state
    state = (state * 48271) % 2147483647  # Park-Miller, the same generator in every language
    return state % n


def fee(amount):
    return (amount * 29 + 500) // 1000 + 30  # 2.9% plus 30 cents, rounded half up


def line(pid, type_, t, net, tail, proc, ref, big):
    # a sale (0), a refund (1) or a chargeback (2); ref is False when the processor lost the reference
    return {"pid": pid, "type": type_, "t": t, "net": net, "tail": tail, "proc": proc, "ref": ref, "big": big, "age": 0}


def copy(l, net, big):
    return line(l["pid"], l["type"], l["t"], net, l["tail"], l["proc"], l["ref"], big)


def total(ls, f):
    return sum(f(l) for l in ls)


def generate():
    global state
    state = SEED
    ledger, truth = [], []  # ledger lines, and what the processors really reported
    for i in range(DAYS * PER_DAY):
        day = 1 + i // PER_DAY
        t = day * DAY + nxt(DAY)
        amount = 500 + nxt(19501)
        tail = nxt(10000)
        proc = nxt(3)
        r = nxt(100)
        small = 1 + nxt(4)
        large = 200 + nxt(101)
        if r < 2: kind = "missing"
        elif r < 3: kind = "ghost"
        elif r < 6: kind = "lost"
        elif r < 14: kind = "fee"
        elif r < 15: kind = "bigfee"
        elif r < 17: kind = "chargeback"
        elif r < 20: kind = "refund"
        else: kind = "normal"
        if kind == "chargeback" and day != 1: kind = "normal"
        if kind == "refund" and day > 2: kind = "normal"
        expected = amount - fee(amount)
        if kind != "ghost":
            ledger.append(line(i, 0, t, expected, tail, proc, True, False))
        if kind == "refund":
            ledger.append(line(i, 1, t + REFUND_AFTER, -amount, tail, proc, True, False))
        if kind != "missing":
            net = expected - small if kind == "fee" else expected - large if kind == "bigfee" else expected
            truth.append(line(i, 0, t, net, tail, proc, kind != "lost", kind == "bigfee"))
            if kind == "refund":
                truth.append(line(i, 1, t + REFUND_AFTER, -amount, tail, proc, True, False))
            if kind == "chargeback":
                truth.append(line(i, 2, t + CHARGEBACK_AFTER, -amount, tail, proc, True, False))
    return ledger, truth


def run(name, strategy, tolerance, idempotent, per_processor_cutoff):
    ledger, truth = generate()
    Lb = [[[] for _ in range(BUCKETS)] for _ in range(3)]
    Tb = [[[] for _ in range(BUCKETS)] for _ in range(3)]
    for l in ledger:
        Lb[l["proc"]][(l["t"] + (OFFSET[l["proc"]] if per_processor_cutoff else 0)) // DAY].append(l)
    for l in truth:
        Tb[l["proc"]][(l["t"] + OFFSET[l["proc"]]) // DAY].append(l)
    # What the loader has stored for each processor and day. An idempotent load keeps one version of each row.
    Pb = [[[copy(l, l["net"], l["big"]) for l in ls] for ls in row] for row in Tb]
    duplicate_money = 0
    if not idempotent:
        Pb[1][3] = Pb[1][3] + Pb[1][1]
        Pb[1][1] = []  # late file: arrives 2 days after its day
        duplicate_money += total(Pb[2][2], lambda l: abs(l["net"]))
        Pb[2][2] = Pb[2][2] + [copy(l, l["net"], l["big"]) for l in Pb[2][2]]  # the same file delivered twice, both loaded
        Pb[0][2] = [copy(l, l["net"] + 1000, True) if l["pid"] % 5 == 0 else copy(l, l["net"], l["big"]) for l in Tb[0][2]]  # first version, 1 row in 5 wrong
        Pb[0][3] = Pb[0][3] + [copy(l, l["net"], l["big"]) for l in Tb[0][2]]  # the corrected file, loaded next to it
        duplicate_money += total(Tb[0][2], lambda l: abs(l["net"]))
    not_tying = 0
    for p in range(3):
        for b in range(BUCKETS):
            if total(Pb[p][b], lambda l: l["net"]) != total(Tb[p][b], lambda l: l["net"]):
                not_tying += 1

    single = strategy == "single"
    window = 0 if single else 1
    matched = resolved = false_pairs = wrong_money = 0
    breaks = []  # (class, cents)
    for p in range(3):
        paired = [0] * (DAYS * PER_DAY * 3)  # 1: key paired cleanly, 2: key paired with a wrong amount
        key = lambda l: l["pid"] * 3 + l["type"]
        carry_l, carry_p = [], []
        miss, orphan = [], []
        for b in range(BUCKETS):
            Ls = carry_l + Lb[p][b]
            Ps = carry_p + Pb[p][b]
            carry_l, carry_p = [], []
            uL = [False] * len(Ls)
            uP = [False] * len(Ps)
            for i in range(len(Ls)):  # tiers 1 and 2: same reference, exact amount or within tolerance
                for j in range(len(Ps)):
                    if uP[j] or not Ps[j]["ref"] or key(Ps[j]) != key(Ls[i]):
                        continue
                    uL[i] = uP[j] = True
                    diff = abs(Ls[i]["net"] - Ps[j]["net"])
                    if diff == 0:
                        matched += 1
                        paired[key(Ls[i])] = 1
                    elif not single and diff <= tolerance:
                        matched += 1
                        resolved += 1
                        paired[key(Ls[i])] = 1
                        if Ps[j]["big"]:
                            wrong_money += diff
                    else:
                        breaks.append(("amount", diff))
                        paired[key(Ls[i])] = 2
                    break
            for j in range(len(Ps)):  # a second row for a reference that is already paired
                if uP[j] or not Ps[j]["ref"] or paired[key(Ps[j])] == 0:
                    continue
                uP[j] = True
                if not single and paired[key(Ps[j])] == 1:
                    resolved += 1
                else:
                    breaks.append(("duplicate", abs(Ps[j]["net"])))
            if not single:  # tier 3: fuzzy, on amount, card tail and type
                for i in range(len(Ls)):
                    if uL[i]:
                        continue
                    for j in range(len(Ps)):
                        x = Ps[j]
                        if uP[j] or x["type"] != Ls[i]["type"] or abs(Ls[i]["net"] - x["net"]) > tolerance:
                            continue
                        if strategy == "tiered" and (x["ref"] or x["tail"] != Ls[i]["tail"]):
                            continue
                        uL[i] = uP[j] = True
                        matched += 1
                        if x["pid"] != Ls[i]["pid"]:
                            false_pairs += 1
                            wrong_money += abs(Ls[i]["net"])
                        else:
                            resolved += 1
                        break
            for i in range(len(Ls)):
                if not uL[i]:
                    if window and Ls[i]["age"] == 0 and b < BUCKETS - 1:
                        Ls[i]["age"] = 1
                        carry_l.append(Ls[i])
                    else:
                        miss.append(Ls[i])
            for j in range(len(Ps)):
                if not uP[j]:
                    if window and Ps[j]["age"] == 0 and b < BUCKETS - 1:
                        Ps[j]["age"] = 1
                        carry_p.append(Ps[j])
                    else:
                        orphan.append(Ps[j])
        used = [False] * len(orphan)
        for l in miss:  # a line missing on one side and extra on the other is a timing break
            j = -1
            for k, x in enumerate(orphan):
                if not used[k] and x["ref"] and x["pid"] == l["pid"] and x["type"] == l["type"]:
                    j = k
                    break
            if j >= 0:
                used[j] = True
                breaks.append(("timing", abs(l["net"])))
            else:
                breaks.append(("missing", abs(l["net"])))
        for k, x in enumerate(orphan):
            if not used[k]:
                breaks.append(("status" if x["type"] == 2 else "missing", abs(x["net"])))
    count = lambda c: sum(1 for x in breaks if x[0] == c)
    n = len(ledger)
    print(f"-- {name}")
    print(f"  matched {matched * 100 // n}% ({matched} of {n} ledger lines), {resolved} resolved by rules")
    print(f"  breaks for people {len(breaks)}: timing {count('timing')}, missing {count('missing')}, amount {count('amount')}, duplicate {count('duplicate')}, status {count('status')}")
    print(f"  unexplained {total(breaks, lambda x: x[1])} cents, duplicate-counted {duplicate_money} cents, bank deposits not tying {not_tying} of 15")
    print(f"  wrongly matched {false_pairs} pairs, {wrong_money} cents marked reconciled but wrong")


run("single pass on exact id, files appended, UTC cut-off", "single", 0, False, False)
run("single pass, each processor on its own time zone", "single", 0, False, True)
run("single pass, time zones, idempotent loads", "single", 0, True, True)
run("tiered rules, tolerance 5, time zones, idempotent loads", "tiered", 5, True, True)
run("tiered rules, tolerance 5, files appended, UTC cut-off", "tiered", 5, False, False)
run("loose fuzzy, tolerance 1000, time zones, idempotent loads", "loose", 1000, True, True)
run("tiered rules, tolerance 1000, time zones, idempotent loads", "tiered", 1000, True, True)
