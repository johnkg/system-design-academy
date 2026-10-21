# Rollups and an alert rule with a "for" duration in Python:
# raw samples are squeezed into coarser buckets for long-term storage, and an alert only fires when a problem lasts.
import math
import sys


# Turn many raw samples into one value per bucket, so months of history stay small.
def rollup(samples, bucket_seconds, aggregate):
    buckets = {}
    for t, value in samples:
        key = math.floor(t / bucket_seconds) * bucket_seconds
        buckets.setdefault(key, []).append(value)
    return [(t, aggregate(values)) for t, values in buckets.items()]


def average(v):
    return sum(v) / len(v)


maximum = max


# An alert rule is a small state machine: ok -> pending (condition true, but not for long enough yet) -> firing.
def evaluate(samples, threshold, for_seconds):
    state, since = 'ok', 0
    events = []
    for t, value in samples:
        if value > threshold:
            if state == 'ok':
                state = 'pending'
                since = t
            if state == 'pending' and t - since >= for_seconds:
                state = 'firing'
                events.append(f'{t}s firing')
        else:
            if state == 'firing':
                events.append(f'{t}s resolved')
            state = 'ok'
    return events


SAMPLES = 40
SCRAPE_S = 15  # seconds between readings
SPIKE_AT = 60
SPIKE_CPU = 97
INCIDENT_FROM = 300
INCIDENT_TO = 420
INCIDENT_CPU = 90
BASE_CPU = 40  # normal load wobbles 40, 43, 46
WOBBLE_STEPS = 3
WOBBLE_PCT = 3
MINUTE_S = 60
HOUR_S = 60 * MINUTE_S
THRESHOLD = 80  # alert when CPU is above 80%
ALERT_FOR_S = 60  # for at least this long

# Ten minutes of CPU readings, one every 15 seconds: a one-sample spike at 60 s, and a real problem from 300 s to 420 s.
def cpu_value(i, t):
    if t == SPIKE_AT:
        return SPIKE_CPU
    if INCIDENT_FROM <= t <= INCIDENT_TO:
        return INCIDENT_CPU
    return BASE_CPU + (i % WOBBLE_STEPS) * WOBBLE_PCT


samples = [(i * SCRAPE_S, cpu_value(i, i * SCRAPE_S)) for i in range(SAMPLES)]  # (t, value)

minutes = rollup(samples, MINUTE_S, maximum)
print(f'{len(samples)} raw samples became {len(minutes)} one-minute points (max per minute)')
print(f'hourly average CPU: {rollup(samples, HOUR_S, average)[0][1]:.1f}')

noisy = evaluate(samples, THRESHOLD, 0)
calm = evaluate(samples, THRESHOLD, ALERT_FOR_S)
print(f"alert without a duration: {', '.join(noisy)}")
print(f"alert that must last 60 s: {', '.join(calm)}")
if len(noisy) != 4 or len(calm) != 2:
    sys.exit(1)  # the spike alone must not page anyone, the real problem must
