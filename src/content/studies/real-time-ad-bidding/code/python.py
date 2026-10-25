# Budget pacing for one ad campaign across a day of bidding, simulated second by second, in Python.
# Three designs spend the same daily budget: no pacing, a pacer that hands each bidder node a local slice, and a
# central counter that every bid must reach. Then win notices that arrive twice are counted once by auction id.
# Money is in mills (thousandths of a dollar) so that every language does the same integer arithmetic.
import sys

HOURLY = [4, 3, 2, 2, 2, 3, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 10, 10, 10, 9, 7, 6]  # traffic weight of each hour, 160 in all
MILLS_PER_WEIGHT_SECOND = 25  # bidding on every matching request would spend 25 mills per second per unit of weight
DAY, HOUR = 86400, 3600
BUDGET = 5000 * 1000  # $5,000 a day
REPORT_DELAY = 60  # spend reports reach the bidders and the pacer 60 seconds late
NODE_SHARES = [16, 16, 12, 12, 12, 12, 12, 8]  # percent of the campaign's traffic seen by each of 8 bidder nodes
COUNTER_REGIONS, LATE_REGIONS = 4, 3  # a central counter in one of 4 regions; the other 3 are too far away to answer in time


def rate(s):  # spend per second if we bid on everything
    return MILLS_PER_WEIGHT_SECOND * HOURLY[s // HOUR]


potential_from = [0] * (DAY + 1)  # potential_from[s] = spend possible from second s to midnight
for s in range(DAY - 1, -1, -1):
    potential_from[s] = potential_from[s + 1] + rate(s)


def clock(s):
    return f"{s // HOUR:02d}:{(s % HOUR) // 60:02d}:{s % 60:02d}"


def dollars(m):
    return f"${m // 1000}.{(m % 1000) // 10:02d}"


# 1. No pacing: every node bids on everything until the spend it has heard about reaches the budget.
def no_pacing():
    spent = [0]  # spent[s] = total spend before second s
    out_at = last_bid = -1
    for s in range(DAY):
        known = spent[s - REPORT_DELAY] if s >= REPORT_DELAY else 0
        spend = rate(s) if known < BUDGET else 0
        if spend > 0:
            last_bid = s
        spent.append(spent[s] + spend)
        if out_at < 0 and spent[s + 1] >= BUDGET:
            out_at = s + 1
    return {"total": spent[DAY], "out_at": out_at, "last_bid": last_bid}


# 2. Local slices: every REPORT_DELAY seconds a pacer splits the next slice of budget between the nodes in proportion to
# their traffic. It plans with the newest report, which is one interval old. Each node spends its own slice with no network call.
def local_slices():
    spent = [0]
    left = [0] * len(NODE_SHARES)
    last_bid = -1
    slices = 0
    for s in range(DAY):
        if s % REPORT_DELAY == 0:
            known = spent[s - REPORT_DELAY] if s >= REPORT_DELAY else 0
            end = min(s + REPORT_DELAY, DAY)
            slice_ = (max(0, BUDGET - known) * (potential_from[s] - potential_from[end])) // potential_from[s]
            left = [(slice_ * share) // 100 for share in NODE_SHARES]  # an unspent slice is taken back
            slices += 1
        spend = 0
        for i, share in enumerate(NODE_SHARES):
            supply = (rate(s) * share) // 100  # what this node could spend in this second
            used = min(supply, left[i])
            left[i] -= used
            spend += used
        if spend > 0:
            last_bid = s
        spent.append(spent[s] + spend)
    return {"total": spent[DAY], "last_bid": last_bid, "slices": slices}


# 3. Central counter: exact, but a bid from a far region waits a long round trip and misses the exchange's deadline.
def central_counter():
    scaled = 0  # spend times COUNTER_REGIONS, so a quarter of a mill is still a whole number
    for s in range(DAY):
        target = (BUDGET * (potential_from[0] - potential_from[s + 1])) // potential_from[0]  # even plan
        reachable = rate(s) * (COUNTER_REGIONS - LATE_REGIONS)  # only the counter's own region answers in time
        scaled += max(0, min(reachable, target * COUNTER_REGIONS - scaled))
    return {"total": scaled // COUNTER_REGIONS}


a, b, c = no_pacing(), local_slices(), central_counter()
print(f"bidding on everything would spend {dollars(potential_from[0])}; the budget is {dollars(BUDGET)}")
print(f"no pacing: out of budget at {clock(a['out_at'])}, last bid at {clock(a['last_bid'])}, spent {dollars(a['total'])} ({dollars(a['total'] - BUDGET)} over)")
print(f"local slices: {b['slices']} slices to {len(NODE_SHARES)} nodes, last bid at {clock(b['last_bid'])}, spent {dollars(b['total'])} ({dollars(max(0, b['total'] - BUDGET))} over)")
print(f"central counter, {LATE_REGIONS} of {COUNTER_REGIONS} regions too far: spent {dollars(c['total'])} of {dollars(BUDGET)}")

# Win notices: the exchange calls the win URL again when it does not hear back in time, so some arrive twice.
WINS, PRICE_MICROS, RETRY_EVERY = 10000, 2600, 25  # a $2.60 CPM is $0.0026 per impression
notices = []
for i in range(WINS):
    notices.append(f"auction-{i}")
    if i % RETRY_EVERY == 0:
        notices.append(f"auction-{i}")
seen = set()
billed = 0
for notice_id in notices:
    if notice_id not in seen:
        seen.add(notice_id)
        billed += 1


def micros(n):
    return f"${(n * PRICE_MICROS) // 1000000}.{((n * PRICE_MICROS) % 1000000) // 10000:02d}"


print(f"win notices received {len(notices)}: counted naively {micros(len(notices))}, counted once per auction {micros(billed)}")

if a["out_at"] >= 12 * HOUR or b["total"] > BUDGET * 101 // 100 or billed != WINS:
    sys.exit(1)
