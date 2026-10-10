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


# Ten minutes of CPU readings, one every 15 seconds: a one-sample spike at 60 s, and a real problem from 300 s to 420 s.
def cpu_value(i, t):
    if t == 60:
        return 97
    if 300 <= t <= 420:
        return 90
    return 40 + (i % 3) * 3


samples = [(i * 15, cpu_value(i, i * 15)) for i in range(40)]  # (t, value)

minutes = rollup(samples, 60, maximum)
print(f'{len(samples)} raw samples became {len(minutes)} one-minute points (max per minute)')
print(f'hourly average CPU: {rollup(samples, 3600, average)[0][1]:.1f}')

noisy = evaluate(samples, 80, 0)
calm = evaluate(samples, 80, 60)
print(f"alert without a duration: {', '.join(noisy)}")
print(f"alert that must last 60 s: {', '.join(calm)}")
if len(noisy) != 4 or len(calm) != 2:
    sys.exit(1)  # the spike alone must not page anyone, the real problem must
