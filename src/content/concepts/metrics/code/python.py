"""Latency metrics in Python: why the average hides the slow tail, and how percentiles reveal it."""
import math

# 98 ordinary requests between 80 and 120 ms, plus two very slow ones
ORDINARY_REQUESTS, MIN_MS, SPREAD_MS = 98, 80, 41
SCATTER_STEP = 37  # coprime with SPREAD_MS, so the values scatter over the range
latencies = [MIN_MS + ((i * SCATTER_STEP) % SPREAD_MS) for i in range(1, ORDINARY_REQUESTS + 1)]
latencies += [2400, 2900]


# Nearest-rank percentile: the smallest value that at least p% of the observations do not exceed
def percentile(sorted_values, p):
    rank = math.ceil((p / 100) * len(sorted_values))
    return sorted_values[rank - 1]


sorted_latencies = sorted(latencies)
mean = sum(latencies) / len(latencies)

print(f"requests: {len(latencies)}")
print(f"mean: {mean:.1f} ms   <- looks fine")
print(f"p50:  {percentile(sorted_latencies, 50)} ms")
print(f"p95:  {percentile(sorted_latencies, 95)} ms")
print(f"p99:  {percentile(sorted_latencies, 99)} ms   <- what 1 request in 100 experiences")

# A histogram keeps only a count per bucket, which is how metrics systems store latency cheaply
bounds = [100, 250, 1000, math.inf]
counts = [0] * len(bounds)
for value in latencies:
    counts[next(i for i, limit in enumerate(bounds) if value <= limit)] += 1
buckets = "  ".join(f"<={'inf' if limit == math.inf else limit}: {counts[i]}" for i, limit in enumerate(bounds))
print(f"histogram: {buckets}")
