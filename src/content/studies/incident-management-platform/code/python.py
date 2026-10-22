# An incident core in Python: alerts are grouped into incidents, the on-call chain is paged until someone
# acknowledges, every step lands in an append-only timeline, and status updates fan out with retries and dedupe.
import sys

SEED, ALERTS, ALERT_SPACING = 4242, 24, 4  # one alert about every 4 minutes
SEVERITIES, PUBLIC_SEV = 3, 2  # sev 1..3; sev 1 and 2 get a status page update
MAX_ACK_DELAY = 9  # a paged person answers after 1..9 minutes
SEND_FAIL_PCT, ACK_LOST_PCT = 15, 5
seed = SEED


def rand(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


SERVICES = ['checkout', 'search', 'login']
CHAIN = ['primary', 'secondary', 'manager']
ACK_WINDOW = 5   # minutes to acknowledge before the next level is paged
GROUP_GAP = 10   # an alert within 10 minutes of the last one joins the open incident
SUBSCRIBERS, ATTEMPTS = 300, 4

timeline = []    # append-only: entries are never edited or removed


def log(t, text):
    timeline.append({'t': t, 'idx': len(timeline), 'text': text})


# 1. Group alerts into incidents. Severity 1 is the worst, and an incident takes the worst severity of its alerts.
incidents = []
for i in range(ALERTS):
    t = i * ALERT_SPACING + rand(ALERT_SPACING)
    service = SERVICES[rand(len(SERVICES))]
    sev = 1 + rand(SEVERITIES)
    open_inc = next((x for x in incidents if x['service'] == service and t - x['last'] <= GROUP_GAP), None)
    if open_inc:
        open_inc['last'] = t
        open_inc['alerts'] += 1
        open_inc['sev'] = min(open_inc['sev'], sev)
    else:
        incidents.append({'id': len(incidents) + 1, 'service': service, 'start': t, 'last': t, 'alerts': 1, 'sev': sev, 'commander': None})

# 2. Page the chain: each level has ACK_WINDOW minutes, and the first person to acknowledge becomes commander.
for inc in incidents:
    now, paged = inc['start'], 0
    log(now, f"INC-{inc['id']} declared on {inc['service']}, sev {inc['sev']}, from {inc['alerts']} alerts")
    for level in CHAIN:
        delay = 1 + rand(MAX_ACK_DELAY)
        paged += 1
        log(now, f"INC-{inc['id']} paged {level}")
        if delay <= ACK_WINDOW:
            now += delay
            inc['commander'] = level
            log(now, f"INC-{inc['id']} {level} acknowledged and is commander")
            break
        now += ACK_WINDOW
    inc['paged'] = paged
    inc['acked'] = now
    if not inc['commander']:
        log(now, f"INC-{inc['id']} nobody acknowledged: page the whole team")

# 3. Status page fan-out for serious incidents. A key per (incident, subscriber) lets the receiver drop repeats.
received = {}
attempts = duplicates = gave_up = total = 0
for inc in [x for x in incidents if x['sev'] <= PUBLIC_SEV]:
    for s in range(SUBSCRIBERS):
        key = f"{inc['id']}:{s}"
        total += 1
        done = False
        a = 0
        while a < ATTEMPTS and not done:
            a += 1
            attempts += 1
            if rand(100) < SEND_FAIL_PCT:
                continue                                  # the send failed: retry
            if key in received:
                duplicates += 1                           # delivered, and a repeat is ignored
            else:
                received[key] = True
            done = rand(100) >= ACK_LOST_PCT                        # 5%: the acknowledgement was lost, so we resend
        if not done and key not in received:
            gave_up += 1
    log(inc['acked'], f"INC-{inc['id']} status page update sent to {SUBSCRIBERS} subscribers")

ordered = sorted(timeline, key=lambda e: (e['t'], e['idx']))
print(f"alerts 24 -> incidents {len(incidents)}")
for inc in incidents:
    print(f"INC-{inc['id']} {inc['service']} sev {inc['sev']} alerts {inc['alerts']} paged {inc['paged']} commander {inc['commander'] or 'none'} acked at {inc['acked']}")
print(f"timeline entries {len(ordered)}, first: {ordered[0]['text']}")
print(f"fan-out: {total} messages, {attempts} attempts, {duplicates} duplicates dropped, {gave_up} gave up, {len(received)} delivered")

times = all(i == 0 or ordered[i - 1]['t'] <= e['t'] for i, e in enumerate(ordered))
alert_sum = sum(x['alerts'] for x in incidents)
kept = alert_sum == ALERTS
accounted = len(received) + gave_up == total
print(f"checks: ordered {str(times).lower()}, alerts kept {str(kept).lower()}, delivered + gave up = total {str(accounted).lower()}")
if not (times and kept and accounted):
    sys.exit(1)
