# Failure detection from heartbeat arrivals only: a fixed timeout vs a phi accrual detector.
# Integer milliseconds everywhere; the only floats are phi values, formatted explicitly.
import math
import sys

CRASH_BEAT = 140   # the sender dies after beat 139 (t = 139 s)
END_MS = 160000    # the monitor stops watching here
TICK_MS = 100      # the monitor checks every 100 ms
BEAT_MS = 1000     # one heartbeat per second
PER_MILLE = 1000   # random draws are 0..999 per mille
BASE_DELAY_MS, SPIKE_MIN_MS, SPIKE_EXTRA_MS = 20, 400, 2000
PAUSE_FIRST_BEAT, PAUSE_END_BEAT = 60, 65  # GC pause: these beats are never sent
LOSSY_FIRST_BEAT, LOSSY_END_BEAT, LOSS_PER_MILLE = 100, 104, 700
TRACE_SEED, JITTER_MS, SPIKE_PER_MILLE = 1, 50, 50


def lcg(seed):     # 32-bit linear congruential generator, same in every language
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state[0] >> 16
    return nxt


# One heartbeat per second. Delay = 20 ms + jitter, with a 5% chance of a 0.4-2.4 s spike.
# Beats 60-64 are never sent (a GC pause that silences the sender for about 6 s); beats 100-103 are lost with 70% probability.
def make_trace(seed, jitter, spike_per_mille):
    nxt = lcg(seed * 7919 + 13)
    arrivals = []
    for k in range(CRASH_BEAT):
        total = nxt() % PER_MILLE + nxt() % PER_MILLE + nxt() % PER_MILLE + nxt() % PER_MILLE
        spike, extra, loss = nxt() % PER_MILLE, nxt() % SPIKE_EXTRA_MS, nxt() % PER_MILLE
        if PAUSE_FIRST_BEAT <= k < PAUSE_END_BEAT:
            continue
        if LOSSY_FIRST_BEAT <= k < LOSSY_END_BEAT and loss < LOSS_PER_MILLE:
            continue
        delay = BASE_DELAY_MS + (jitter * total) // PER_MILLE
        if spike < spike_per_mille:
            delay += SPIKE_MIN_MS + extra
        arrivals.append(BEAT_MS * k + delay)
    return sorted(arrivals)


class FixedTimeout:
    def __init__(self, timeout_ms):
        self.timeout_ms = timeout_ms

    def arrive(self, interval_ms):
        pass

    def suspect(self, silence_ms):
        return silence_ms > self.timeout_ms


PRIOR_LOW_MS, PRIOR_HIGH_MS = 750, 1250  # seed guess: 1 s +- 250 ms
LOGISTIC_A, LOGISTIC_B = 1.5976, 0.070566  # logistic fit to the normal tail
MIN_P, MAX_PHI = 1e-16, 16.0  # cap phi where the probability underflows


class PhiAccrual:  # Akka-style: logistic approximation of the normal tail
    def __init__(self, threshold, window_size=100, min_std_ms=100):
        self.threshold, self.window_size, self.min_std_ms = threshold, window_size, min_std_ms
        self.window = [PRIOR_LOW_MS, PRIOR_HIGH_MS]
        self.total = PRIOR_LOW_MS + PRIOR_HIGH_MS
        self.sum_sq = PRIOR_LOW_MS * PRIOR_LOW_MS + PRIOR_HIGH_MS * PRIOR_HIGH_MS

    def arrive(self, interval_ms):
        self.window.append(interval_ms)
        self.total += interval_ms
        self.sum_sq += interval_ms * interval_ms
        if len(self.window) > self.window_size:
            old = self.window.pop(0)
            self.total -= old
            self.sum_sq -= old * old

    def phi(self, silence_ms):
        n = len(self.window)
        mean = self.total / n
        std = max(math.sqrt(max(0.0, self.sum_sq / n - mean * mean)), self.min_std_ms)
        y = (silence_ms - mean) / std
        e = math.exp(-y * (LOGISTIC_A + LOGISTIC_B * y * y))
        p = e / (1 + e) if silence_ms > mean else 1 - 1 / (1 + e)  # P(heartbeat arrives later than now)
        return MAX_PHI if p < MIN_P else -math.log10(p)

    def suspect(self, silence_ms):
        return self.phi(silence_ms) >= self.threshold


# A suspicion that a later heartbeat clears is a false alarm; the one still standing at the end is the detection.
def evaluate(arrivals, detector):
    i, last, suspected, since = 0, -1, False, 0
    false_alarms = []
    for t in range(0, END_MS + 1, TICK_MS):
        while i < len(arrivals) and arrivals[i] <= t:
            if last >= 0:
                detector.arrive(arrivals[i] - last)
            last = arrivals[i]
            i += 1
            if suspected:
                false_alarms.append(since)
                suspected = False
        if last >= 0 and not suspected and detector.suspect(t - last):
            suspected, since = True, t
    return false_alarms, (since - last if suspected else -1), detector


def fmt2(x):
    n = math.floor(x * 100 + 0.5)
    return f"{n // 100}.{n % 100:02d}"


trace = make_trace(TRACE_SEED, JITTER_MS, SPIKE_PER_MILLE)
print(f"trace: {len(trace)} heartbeats, last at {trace[-1]} ms")
results = {}
for name, det in [("fixed 2000 ms", FixedTimeout(2000)), ("fixed 5000 ms", FixedTimeout(5000)), ("fixed 10000 ms", FixedTimeout(10000)),
                  ("phi >= 4", PhiAccrual(4)), ("phi >= 8", PhiAccrual(8)), ("phi >= 12", PhiAccrual(12))]:
    fa, detect, d = evaluate(trace, det)
    results[name] = (fa, detect, d)
    print(f"{name.ljust(14)} false alarms {len(fa)} [{' '.join(str(x) for x in fa)}]  crash detected after {detect} ms")
phi8 = results["phi >= 8"][2]
print("phi at the end, after 1000/2000/3000/5000 ms of silence: " + " / ".join(fmt2(phi8.phi(s)) for s in (1000, 2000, 3000, 5000)))

f2, f10, p8 = results["fixed 2000 ms"], results["fixed 10000 ms"], results["phi >= 8"]
ok = (p8[1] > 0 and f2[1] > 0 and f10[1] > 0              # every detector catches the crash
      and len(p8[0]) <= len(f2[0])                         # phi is no worse than a 2 s timeout on the jittery trace
      and len(f10[0]) == 0 and f10[1] > p8[1])             # the long timeout buys accuracy with detection time
sys.exit(0 if ok else 1)
