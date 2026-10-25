# A calendar core in Python: a weekly series stored once as a rule in wall time plus a time zone, expanded only inside the
# window a reader asks for (with a cancelled and a moved occurrence), free/busy by merging busy intervals, and a room that
# rejects overlapping bookings the way an exclusion constraint does. Times are whole minutes since 1970-01-01 UTC.
import sys

DAY, HOUR = 1440, 60


# Calendar arithmetic on day numbers (days since 1970-01-01), so no library or machine time zone is involved.
def days_from_civil(y, m, d):
    y -= 1 if m <= 2 else 0
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    return era * 146097 + yoe * 365 + yoe // 4 - yoe // 100 + doy - 719468


def civil_from_days(z):
    z += 719468
    era = z // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + (3 if mp < 10 else -9)
    return yoe + era * 400 + (1 if m <= 2 else 0), m, d


def weekday(days):  # 0 = Sunday; 1970-01-01 was a Thursday
    return (days + 4) % 7


def nth_sunday(y, m, n):
    first = days_from_civil(y, m, 1)
    return first + (7 - weekday(first)) % 7 + 7 * (n - 1)


def last_sunday(y, m):
    last = days_from_civil(y, m + 1, 1) - 1
    return last - weekday(last)


# Two zones with today's rules: the start and end of summer time as UTC instants for a given year.
ZONES = {
    # second Sunday of March 02:00 local to first Sunday of November 02:00 local
    "America/New_York": {"std": -5 * HOUR, "dst": -4 * HOUR,
                         "range": lambda y: (nth_sunday(y, 3, 2) * DAY + 7 * HOUR, nth_sunday(y, 11, 1) * DAY + 6 * HOUR)},
    # last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC
    "Europe/London": {"std": 0, "dst": HOUR,
                      "range": lambda y: (last_sunday(y, 3) * DAY + HOUR, last_sunday(y, 10) * DAY + HOUR)},
}


def offset_at(zone, utc):
    z = ZONES[zone]
    start, end = z["range"](civil_from_days(utc // DAY)[0])
    return z["dst"] if start <= utc < end else z["std"]


# Wall time to UTC. A time that happens twice means the first one; a time skipped by the clock change is read with the
# offset from before the gap, so it lands one hour later (both as RFC 5545 says).
def to_utc(zone, local_time):
    z = ZONES[zone]
    for off in (z["dst"], z["std"]):
        if offset_at(zone, local_time - off) == off:
            return local_time - off
    return local_time - z["std"]


def date(t):
    y, m, d = civil_from_days(t // DAY)
    return f"{y}-{m:02d}-{d:02d}"


def clock(t):
    m = t % DAY
    return f"{m // HOUR:02d}:{m % HOUR:02d}"


def in_zone(zone, utc):
    return utc + offset_at(zone, utc)


def local(y, m, d, h, minute=0):
    return days_from_civil(y, m, d) * DAY + h * HOUR + minute


# The series: stored once, never copied into rows. EXDATE cancels an occurrence; an override replaces one, keyed by its original start.
series = {
    "zone": "America/New_York", "start": local(2026, 3, 2, 9), "minutes": 60, "every_days": 7, "count": 6,
    "exdates": {local(2026, 3, 16, 9)},
    "overrides": {local(2026, 3, 23, 9): {"start": local(2026, 3, 23, 10)}},
}


# Expand only the occurrences that touch [start, end). Steps are taken in wall time, then each one is converted to UTC.
def expand(s, window_from, window_to):
    out = []
    for i in range(s["count"]):
        original = s["start"] + i * s["every_days"] * DAY
        if original in s["exdates"]:
            continue
        moved = original in s["overrides"]
        start_local = s["overrides"][original]["start"] if moved else original
        start = to_utc(s["zone"], start_local)
        end = start + s["minutes"]
        if start < window_to and end > window_from:
            out.append({"start": start, "end": end, "moved": moved})
    return out


print("series: Mondays 09:00 America/New_York from 2026-03-02, 6 times, 2026-03-16 cancelled, 2026-03-23 moved to 10:00")
naive_utc = to_utc(series["zone"], series["start"])  # the mistake: keep the first instant and add 7 days of UTC
instances = expand(series, local(2026, 3, 9, 0), local(2026, 4, 6, 0))
for x in instances:
    weeks = (x["start"] - naive_utc + 7 * DAY // 2) // (7 * DAY)
    wrong = naive_utc + weeks * 7 * DAY
    tail = "moved by an override" if x["moved"] else f"stored as one UTC instant: {clock(in_zone(series['zone'], wrong))} in New York"
    print(f"{date(x['start'])} New York {clock(in_zone(series['zone'], x['start']))}, UTC {clock(x['start'])}, "
          f"London {clock(in_zone('Europe/London', x['start']))}; {tail}")
gap = to_utc("America/New_York", local(2026, 3, 8, 2, 30))
print(f"2026-03-08 02:30 does not exist in New York: read as {clock(in_zone('America/New_York', gap))} local, {clock(gap)} UTC")

# Free/busy on Monday 9 March: each calendar's busy intervals (UTC), merged, then gaps of at least 60 minutes in 09:00-17:00 New York.
day = days_from_civil(2026, 3, 9) * DAY


def at(h, m=0):
    return day + h * HOUR + m


busy = {
    "Alice": [[x["start"], x["end"]] for x in instances if x["start"] < at(24)] + [[at(15), at(16)]],
    "Ben": [[at(14, 30), at(15, 30)], [at(17), at(18)]],
    "Room 4B": [[at(19), at(20)]],
}
everything = sorted((iv for ivs in busy.values() for iv in ivs), key=lambda iv: iv[0])
merged = []
for s, e in everything:
    if merged and s <= merged[-1][1]:
        merged[-1][1] = max(merged[-1][1], e)
    else:
        merged.append([s, e])
work_from = to_utc("America/New_York", local(2026, 3, 9, 9))
work_to = to_utc("America/New_York", local(2026, 3, 9, 17))
need = 60
free = []
cursor = work_from
for s, e in merged:
    if s - cursor >= need:
        free.append((cursor, s))
    cursor = max(cursor, e)
if work_to - cursor >= need:
    free.append((cursor, work_to))


def ny(t):
    return clock(in_zone("America/New_York", t))


print(f"busy intervals: {len(everything)}, merged: {' '.join(f'{ny(s)}-{ny(e)}' for s, e in merged)} (New York)")
print(f"free for {need} min: {' '.join(f'{ny(s)}-{ny(e)}' for s, e in free)}")

# Room 4B: three bookings arrive together. Ranges are half-open [start, end), so 11:00-12:00 does not clash with 10:00-11:00.
midnight = to_utc("America/New_York", local(2026, 3, 10, 0))  # Tuesday 10 March
requests = [{"who": who, "start": midnight + int(a * HOUR), "end": midnight + int(b * HOUR)}
            for who, a, b in [("Dana", 10, 11), ("Eli", 10.5, 11.5), ("Fay", 11, 12)]]


def overlaps(a, b):
    return a["start"] < b["end"] and b["start"] < a["end"]


# Read then write: all three check the same empty snapshot, then all insert.
clashes = sum(1 for i in range(len(requests)) for j in range(i + 1, len(requests)) if overlaps(requests[i], requests[j]))
print(f"read then write: {len(requests)} booked, {clashes} overlapping pairs")
# Exclusion constraint: the database checks each insert against the rows already committed, one at a time.
table, results = [], []
for r in requests:
    hit = next((b for b in table if overlaps(b, r)), None)
    if hit:
        results.append(f"{r['who']} rejected (overlaps {hit['who']})")
    else:
        table.append(r)
        results.append(f"{r['who']} booked")
print(f"exclusion constraint: {', '.join(results)}")

if clashes == 0 or len(table) != 2 or len(free) != 3:
    sys.exit(1)
