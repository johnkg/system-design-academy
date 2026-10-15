# A volume check with a seasonality-aware baseline, and a circuit breaker, in Python:
# a table's hourly row count is compared with the same hour of the week in earlier weeks, using median and MAD (integers only).
import sys

seed = 4242


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


HOURS_PER_WEEK = 168
WEEKS = 5
# Rows loaded per hour (in thousands) for each hour of the day: quiet at night, busy in the afternoon.
SHAPE = [120, 90, 70, 60, 60, 80, 150, 300, 520, 700, 820, 900, 880, 860, 900, 940, 880, 760, 600, 480, 380, 300, 220, 160]

series = []
incident = []
for t in range(HOURS_PER_WEEK * WEEKS):
    hour = t % 24
    day = (t // 24) % 7
    v = SHAPE[hour] * (40 if day >= 5 else 100) // 100  # weekends carry 40% of the weekday volume
    v = v * (950 + random(101)) // 1000                 # noise of about plus or minus 5%
    week = t // HOURS_PER_WEEK
    bad = False
    if week == WEEKS - 1 and day == 2 and 13 <= hour <= 16:
        v = v * 35 // 100  # a source stops sending
        bad = True
    if week == WEEKS - 1 and day == 4 and hour == 3:
        v *= 4  # a job loads the data twice
        bad = True
    series.append(v)
    incident.append(bad)


def median(xs):
    a = sorted(xs)
    n = len(a)
    return a[(n - 1) // 2] if n % 2 else (a[n // 2 - 1] + a[n // 2]) // 2


# Naive baseline: the mean of everything, and three standard deviations (compared as squares, so no square root).
history = series[:HOURS_PER_WEEK * (WEEKS - 1)]
mean = sum(history) // len(history)
variance = sum((x - mean) * (x - mean) for x in history) // len(history)


def naive_flag(x):
    return (x - mean) * (x - mean) > 9 * variance


# Seasonal baseline: the median of the same hour of the week in the 4 earlier weeks, with a spread from the MAD.
def seasonal_flag(t):
    same = [series[t - w * HOURS_PER_WEEK] for w in range(1, WEEKS)]
    med = median(same)
    mad = median([abs(x - med) for x in same])
    sigma100 = max(mad * 148, med * 3)  # 1.48 * MAD estimates sigma, with a floor of 3% of the median (times 100)
    return abs(series[t] - med) * 100 > 4 * sigma100


start = HOURS_PER_WEEK * (WEEKS - 1)


def score(flag):
    hit = false_alarm = missed = 0
    for t in range(start, len(series)):
        f = flag(t)
        if f and incident[t]:
            hit += 1
        elif f:
            false_alarm += 1
        elif incident[t]:
            missed += 1
    return hit, false_alarm, missed


naive = score(lambda t: naive_flag(series[t]))
fixed = score(lambda t: series[t] < 200)
seasonal = score(seasonal_flag)
print(f"incidents: {sum(incident)}; mean {mean}, last-week low {min(series[start:])}")
print(f"naive: hit {naive[0]}, false alarms {naive[1]}, missed {naive[2]}")
print(f"fixed floor of 200: hit {fixed[0]}, false alarms {fixed[1]}, missed {fixed[2]}")
print(f"seasonal: hit {seasonal[0]}, false alarms {seasonal[1]}, missed {seasonal[2]}")

# Circuit breaker: 2 alerting hours in a row open it (new hours are held back), 3 healthy hours in a row close it.
is_open = False
bad_run = good_run = held = opened = 0
for t in range(start, len(series)):
    if seasonal_flag(t):
        bad_run += 1
        good_run = 0
    else:
        good_run += 1
        bad_run = 0
    if not is_open and bad_run >= 2:
        is_open = True
        opened += 1
    elif is_open and good_run >= 3:
        is_open = False
    if is_open:
        held += 1
print(f"breaker opened {opened} time(s), held back {held} hour(s)")
if seasonal[0] <= naive[0] or seasonal[1] >= fixed[1] or seasonal[2] > 0 or is_open:
    sys.exit(1)
