# An alerting pipeline in Python:
# a rule fires only after its condition held for a while, then alerts are silenced, deduplicated, grouped into notifications and escalated.
import sys

SEED, MINUTES, THRESHOLD, QUICK_FOR, PATIENT_FOR = 7, 120, 60, 1, 3
RAW_ALERTS, INSTANCES = 400, 8
seed = SEED


def random_int(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# 1. Rule evaluation: fire when the value has been above the threshold for `for_minutes` samples in a row.
def evaluate(samples, threshold, for_minutes):
    fires = []
    run = 0
    for minute, value in enumerate(samples):
        run = run + 1 if value > threshold else 0
        if run == for_minutes:  # the moment it turns from pending into firing
            fires.append(minute)
    return fires


samples = [random_int(100) for _ in range(MINUTES)]
quick = len(evaluate(samples, THRESHOLD, QUICK_FOR))
patient = len(evaluate(samples, THRESHOLD, PATIENT_FOR))
print(f"rule value > 60 over 120 minutes: {quick} fires with for=1, {patient} fires with for=3")

# 2. Firing alerts from three services, with many repeats of the same alert.
SERVICES = ['checkout', 'search', 'batch']
NAMES = ['latency', 'errors']
raw = []
for i in range(RAW_ALERTS):
    minute = random_int(MINUTES)
    service = SERVICES[random_int(len(SERVICES))]
    name = NAMES[random_int(len(NAMES))]
    raw.append({'id': i, 'minute': minute, 'service': service, 'name': name, 'instance': random_int(INSTANCES)})
raw.sort(key=lambda a: (a['minute'], a['id']))

silences = [{'service': 'batch', 'from': 30, 'to': 90}]  # a maintenance window for the batch service
DEDUPE_MINUTES = 10
GROUP_MINUTES = 10
last_seen = {}
notifications = {}
silenced = duplicates = fresh = 0
for a in raw:
    if any(s['service'] == a['service'] and s['from'] <= a['minute'] < s['to'] for s in silences):
        silenced += 1
        continue
    fingerprint = f"{a['name']}/{a['service']}/{a['instance']}"
    previous = last_seen.get(fingerprint)
    last_seen[fingerprint] = a['minute']
    if previous is not None and a['minute'] - previous < DEDUPE_MINUTES:  # the same alert, still firing
        duplicates += 1
        continue
    fresh += 1
    group = f"{a['service']}/{a['name']}@{a['minute'] // GROUP_MINUTES}"  # one notification per service, alert name and time slot
    notifications[group] = notifications.get(group, 0) + 1
print(f"{len(raw)} raw alerts: {silenced} silenced, {duplicates} duplicates, {fresh} new")
print(f"{fresh} new alerts became {len(notifications)} notifications")

# 3. Escalation: page the primary, and if nobody acknowledges, the secondary, and then the manager.
ack_chance = [60, 70, 100]
pages = [0, 0, 0]
for _ in range(len(notifications)):
    for level in range(len(ack_chance)):
        pages[level] += 1
        if random_int(100) < ack_chance[level]:
            break
total_pages = sum(pages)
print(f"pages: primary {pages[0]}, secondary {pages[1]}, manager {pages[2]}")
print(f"{len(raw)} raw alerts became {total_pages} pages, a reduction of {(100 * (len(raw) - total_pages)) // len(raw)}%")

grouped = sum(notifications.values())
ok = (len(raw) == silenced + duplicates + fresh and grouped == fresh and len(notifications) <= fresh
      and pages[0] == len(notifications) and pages[0] >= pages[1] >= pages[2] and patient <= quick)
if not ok:
    sys.exit(1)
