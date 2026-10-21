# A deterministic single-server queue (M/M/1, FIFO) simulated event by event, then checked against Little's law L = lambda * W.
# A seeded LCG supplies the random numbers, so every run (and every language) prints the same text.
import math
import sys


class Lcg:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):  # uniform in (0, 1]
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return (self.s + 1) / 4294967296

    def exp(self, mean):  # inverse transform sampling
        return -mean * math.log(self.next())


SERVICE_MS = 50
N = 20000
ARRIVAL_SEED = 12345
SERVICE_SEED = 67890
MS_PER_SECOND = 1000
TOLERANCE = 1e-6  # relative floating-point slack for Little's law


def simulate(rho):
    arrivals, services = Lcg(ARRIVAL_SEED), Lcg(SERVICE_SEED)
    mean_gap = SERVICE_MS / rho  # utilisation = service time / gap between arrivals
    arrive, depart = [], []
    t = free = wait = busy = 0.0
    for _ in range(N):
        t += arrivals.exp(mean_gap)
        service = services.exp(SERVICE_MS)
        start = max(t, free)  # the server takes the job when it arrives or when it frees up
        wait += start - t
        busy += service
        free = start + service
        arrive.append(t)
        depart.append(free)
    # Integrate the number in system over time by walking arrivals (+1) and departures (-1) in order.
    area = last = 0.0
    in_system = a = d = 0
    while d < N:
        is_arrival = a < N and arrive[a] <= depart[d]
        now = arrive[a] if is_arrival else depart[d]
        area += in_system * (now - last)
        last = now
        if is_arrival:
            in_system += 1
            a += 1
        else:
            in_system -= 1
            d += 1
    sojourn = 0.0
    for i in range(N):
        sojourn += depart[i] - arrive[i]
    return {"util": busy / last, "wait": wait / N, "L": area / last, "lambda": (N / last) * MS_PER_SECOND, "W": sojourn / N}


def f2(x):
    return f"{x:.2f}"


previous = -1
print("rho  util  wait_ms  theory_ms  L  lambda_per_s  W_ms  L-lambda*W")
for rho in [0.5, 0.7, 0.8, 0.9, 0.95]:
    r = simulate(rho)
    theory = (rho / (1 - rho)) * SERVICE_MS  # M/M/1 mean wait
    gap = abs(r["L"] - (r["lambda"] / MS_PER_SECOND) * r["W"])
    print(f"{f2(rho)} {f2(r['util'])} {f2(r['wait'])} {f2(theory)} {f2(r['L'])} {f2(r['lambda'])} {f2(r['W'])} {gap:.6f}")
    if gap > TOLERANCE * max(1, r["L"]):
        print("Little's law violated", file=sys.stderr)
        sys.exit(1)
    if r["wait"] <= previous:
        print("wait must grow with load", file=sys.stderr)
        sys.exit(1)
    previous = r["wait"]
# Sizing: concurrency = rate x latency, then add headroom so the pool is not a hockey stick.
rate, latency_ms, headroom = 1000, 50, 0.7
in_flight = rate * latency_ms / MS_PER_SECOND
print(f"in flight: {f2(in_flight)}, pool at {f2(headroom)} target: {math.ceil(in_flight / headroom)}")
