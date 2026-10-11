# Synthetic probes with an N-of-M rule, and the p75 of a RUM sample, on one seeded day of 1440 minutes.
DAY, FAULT_START, FAULT_END, BRAZIL = 1440, 180, 360, 4
STATE = 9

def rand(n):  # small integer LCG so every language prints the same numbers
    global STATE
    STATE = (STATE * 1664525 + 1013904223) & 0xFFFFFFFF
    return (STATE >> 16) % n

# The world is drawn once, in a fixed order, so every probe setting sees the same day.
BLIP = [[0] * DAY for _ in range(5)]   # 1 = single-probe network blip (0.4%)
FAILS = [[0] * DAY for _ in range(5)]  # 1 = a probe in the faulted region fails (90%)
for t in range(DAY):
    for loc in range(5):
        BLIP[loc][t] = 1 if rand(1000) < 4 else 0
        FAILS[loc][t] = 1 if rand(100) < 90 else 0

def synthetic(interval, locations, need):
    need = min(need, locations)
    latest = [None] * locations          # (failed, real) from each location's latest check
    detect, false_alarms, checks, was_false = -1, 0, 0, False
    for t in range(DAY):
        ran = False
        for k in range(locations):
            offset = k * interval // locations   # staggered start per location
            if t >= offset and (t - offset) % interval == 0:
                ran, checks = True, checks + 1
                real = k == BRAZIL and FAULT_START <= t < FAULT_END and FAILS[k][t] == 1
                latest[k] = (real or BLIP[k][t] == 1, real)
        if not ran:
            continue
        failing = [s for s in latest if s and s[0]]
        met = len(failing) >= need
        caused_by_fault = any(s[1] for s in failing)
        if met and caused_by_fault and detect < 0:
            detect = t - FAULT_START
        is_false = met and not caused_by_fault
        if is_false and not was_false:
            false_alarms += 1
        was_false = is_false
    return detect, false_alarms, checks

def p75(values):  # nearest rank: the ceil(0.75 * n)-th smallest
    s = sorted(values)
    return s[(3 * len(s) + 3) // 4 - 1]

def rum_day(sampling_pct):
    per_minute = []
    for t in range(DAY):
        slow = FAULT_START <= t < FAULT_END
        minute = []
        for _ in range(40):                       # 40 Brazil page views per minute
            if rand(100) < sampling_pct:          # the sampling decision
                lcp = 900 + rand(800) + rand(800)  # 900..2500 ms, about 1.7 s median
                minute.append(lcp * 3 if slow else lcp)
        per_minute.append(minute)
    return per_minute

def rum_detect(per_minute):  # 15-minute window, at least 20 samples, p75 above 4000 ms
    for t in range(15, DAY):
        window = [v for m in per_minute[t - 15:t] for v in m]
        if len(window) >= 20 and p75(window) > 4000:
            return t - FAULT_START
    return -1

results = {}
for interval, locations, need in [(5, 3, 1), (5, 5, 1), (5, 5, 2), (1, 5, 1), (15, 5, 1), (1, 5, 3)]:
    d, f, c = synthetic(interval, locations, need)
    print(f"every {interval:>2} min, {locations} locations, need {need}: detected after {d if d >= 0 else 'never'}, false alarms {f}, checks {c}")
    results[(interval, locations, need)] = (d, f)

days = rum_day(10)
fault = [v for m in days[FAULT_START:FAULT_END] for v in m]
normal = [v for m in days[:FAULT_START] for v in m]
mean = sum(fault) // len(fault)
print(f"RUM at 10%: normal p75 {p75(normal)} ms, outage p75 {p75(fault)} ms, outage mean {mean} ms")
print(f"RUM alert after {rum_detect(days)} min with 10% sampling, after {rum_detect(rum_day(1))} with 1%")

assert results[(5, 3, 1)][0] == -1, "no probe in Brazil: the regional fault is invisible"
assert 0 <= results[(5, 5, 1)][0] < 5, "a Brazil probe, any 1: found within one interval"
assert results[(5, 5, 2)][0] == -1 or results[(5, 5, 2)][0] > results[(5, 5, 1)][0], "2 of 5 hides a one-region fault"
assert results[(1, 5, 3)][0] == -1 and results[(1, 5, 3)][1] == 0, "3 of 5 never fires on blips or on one region"
assert results[(1, 5, 1)][1] > results[(5, 5, 1)][1] > results[(15, 5, 1)][1], "shorter interval, more false alarms"
assert p75(normal) < 2500 < 4000 < p75(fault), "p75 moves from good to poor"
assert 0 <= rum_detect(days) < 30 and rum_detect(rum_day(1)) == -1, "1% sampling is too thin to alert"
print("ok")
