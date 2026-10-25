# A flight search fan-out in Python: ask every provider at once with its own timeout and one global deadline, stream the
# answers as they arrive, serve fares from a short-lived cache, skip a failing provider with a circuit breaker, merge the same
# itinerary sold by several providers, and check the chosen price live before handing the traveller over.
# Time is simulated (milliseconds within a search, minutes between searches), so every run prints the same thing.
import sys

DEADLINE_MS = 3000  # the whole search closes here
TIMEOUT_FACTOR = 2  # a provider's own timeout is twice its typical latency, capped by the deadline
TTL_MIN = 5  # a cached fare is served for 5 minutes
BREAKER_FAILS = 2  # failures in a row that open a provider's breaker
BREAKER_OPEN_MIN = 4  # minutes the breaker stays open before one trial call
CACHE_MS = 5  # time to answer from the cache
JITTER_MIN, JITTER_SPAN = 50, 100  # a live call takes 50% to 149% of the provider's typical latency

PROVIDERS = [
    {"name": "airline-1", "typical": 400, "markup": 0},
    {"name": "airline-2", "typical": 700, "markup": 0},
    {"name": "ota-1", "typical": 1200, "markup": 9},
    {"name": "ota-2", "typical": 1500, "markup": 4},
    {"name": "gds-1", "typical": 2000, "markup": -6},
]
ITINERARIES = [  # the same flights are sold by several providers
    {"key": "XA101", "label": "07:10 nonstop 7h10", "base": 420, "sellers": [0, 2, 3, 4]},
    {"key": "XA105", "label": "13:40 nonstop 7h25", "base": 395, "sellers": [0, 3, 4]},
    {"key": "YB220+YB31", "label": "09:05 one stop 10h40", "base": 330, "sellers": [1, 2, 4]},
]
FARE_RISE = {"key": "YB220+YB31", "minute": 7, "by": 34}  # the cheap fare class sells out at minute 7
OUTAGE = {"provider": 4, "from": 5, "to": 11}  # gds-1 stops answering from minute 5 to minute 11
SEARCHES = [0, 3, 6, 7, 8, 12]  # minutes at which travellers search the same route
SELECT_AT = 8  # the traveller at minute 8 picks the cheapest result

seed = 7


def plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def fare(it, minute):
    return it["base"] + (FARE_RISE["by"] if it["key"] == FARE_RISE["key"] and minute >= FARE_RISE["minute"] else 0)


def offers_of(p, minute):
    return [{"key": it["key"], "price": fare(it, minute) + PROVIDERS[p]["markup"], "seller": p} for it in ITINERARIES if p in it["sellers"]]


cache = {}  # provider -> {"at", "offers"}
breakers = [{"fails": 0, "open_until": -1} for _ in PROVIDERS]
totals = {"live": 0, "cached": 0, "timeouts": 0, "skipped": 0}


def search(minute):
    events = []  # (at, provider, text, offers)
    for p, prov in enumerate(PROVIDERS):
        hit, br = cache.get(p), breakers[p]
        if hit and minute - hit["at"] < TTL_MIN:
            totals["cached"] += 1
            events.append((CACHE_MS, p, f"{plural(len(hit['offers']), 'offer')} from cache (age {minute - hit['at']} min)", hit["offers"]))
            continue
        if br["open_until"] > minute:
            totals["skipped"] += 1
            events.append((0, p, "skipped, breaker open", []))
            continue
        totals["live"] += 1
        timeout = min(TIMEOUT_FACTOR * prov["typical"], DEADLINE_MS)
        latency = prov["typical"] * (JITTER_MIN + random(JITTER_SPAN)) // 100
        down = p == OUTAGE["provider"] and OUTAGE["from"] <= minute < OUTAGE["to"]
        if down or latency > timeout:
            totals["timeouts"] += 1
            br["fails"] += 1
            text = f"no answer, gave up at {timeout} ms"
            if br["fails"] >= BREAKER_FAILS:
                br["open_until"] = minute + BREAKER_OPEN_MIN
                text += f"; breaker opens until minute {br['open_until']}"
            events.append((timeout, p, text, []))
            continue
        br["fails"] = 0
        offers = offers_of(p, minute)
        cache[p] = {"at": minute, "offers": offers}
        events.append((latency, p, f"{plural(len(offers), 'offer')} live", offers))
    events.sort(key=lambda e: (e[0], e[1]))
    print(f"search at minute {minute}")
    for at, p, text, _ in events:  # streamed to the browser in this order
        print(f"  +{str(at).rjust(4)} ms  {PROVIDERS[p]['name'].ljust(9)} {text}")
    answered = [e for e in events if e[3]]
    first = answered[0][0] if answered else DEADLINE_MS
    complete = max([0] + [e[0] for e in events])
    print(f"  first prices after {first} ms, search complete after {complete} ms, {len(answered)} of {len(PROVIDERS)} providers answered")
    return merge([o for e in answered for o in e[3]])


# One row per itinerary, with every seller's price, sorted by the best price.
def merge(offers):
    rows = []
    for it in ITINERARIES:
        mine = sorted((o for o in offers if o["key"] == it["key"]), key=lambda o: (o["price"], o["seller"]))
        if mine:
            rows.append({"it": it, "offers": mine})
    rows.sort(key=lambda r: (r["offers"][0]["price"], r["it"]["key"]))
    print(f"  merged {len(offers)} offers into {len(rows)} itineraries:")
    for r in rows:
        print(f"    {r['it']['label'].ljust(21)} {r['offers'][0]['price']} at {PROVIDERS[r['offers'][0]['seller']]['name']}, {len(r['offers'])} sellers")
    return rows


chosen = None
for minute in SEARCHES:
    rows = search(minute)
    if minute == SELECT_AT:
        chosen = {"minute": minute, "row": rows[0]}

# The traveller clicks the top result. The shown price may come from the cache, so ask the seller for the live price first.
best = chosen["row"]["offers"][0]
it = chosen["row"]["it"]
live = fare(it, chosen["minute"]) + PROVIDERS[best["seller"]]["markup"]
print(f"selected {it['key']} at {best['price']} from {PROVIDERS[best['seller']]['name']}; live price check says {live}")
print("price confirmed, handing over to the seller" if live == best["price"] else f"price changed by {live - best['price']}, shown to the traveller before handing over")
print(f"provider calls {totals['live']}, answered from cache {totals['cached']}, timed out {totals['timeouts']}, skipped by breaker {totals['skipped']}")

if totals["cached"] == 0 or totals["skipped"] == 0 or live == best["price"]:
    sys.exit(1)
