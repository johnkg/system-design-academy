// Latency metrics in JavaScript: why the average hides the slow tail, and how percentiles reveal it.

// 98 ordinary requests between 80 and 120 ms, plus two very slow ones
const latencies = [];
for (let i = 1; i <= 98; i++) latencies.push(80 + ((i * 37) % 41));
latencies.push(2400, 2900);

// Nearest-rank percentile: the smallest value that at least p% of the observations do not exceed
function percentile(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1];
}

const sorted = [...latencies].sort((a, b) => a - b);
const mean = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;

console.log(`requests: ${latencies.length}`);
console.log(`mean: ${mean.toFixed(1)} ms   <- looks fine`);
console.log(`p50:  ${percentile(sorted, 50)} ms`);
console.log(`p95:  ${percentile(sorted, 95)} ms`);
console.log(`p99:  ${percentile(sorted, 99)} ms   <- what 1 request in 100 experiences`);

// A histogram keeps only a count per bucket, which is how metrics systems store latency cheaply
const bounds = [100, 250, 1000, Infinity];
const counts = bounds.map(() => 0);
for (const value of latencies) counts[bounds.findIndex((limit) => value <= limit)]++;
console.log(`histogram: ${bounds.map((limit, i) => `<=${limit === Infinity ? "inf" : limit}: ${counts[i]}`).join("  ")}`);
