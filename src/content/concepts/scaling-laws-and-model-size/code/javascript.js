// Compute-optimal model size in JavaScript, using C = 6 * N * D and D = 20 * N, so N = sqrt(C / 120).
const TOKENS_PER_PARAMETER = 20;

for (const [compute, label] of [[1e21, "1e+21"], [1e23, "1e+23"], [1e25, "1e+25"]]) {
  const parameters = Math.sqrt(compute / (6 * TOKENS_PER_PARAMETER));
  const tokens = TOKENS_PER_PARAMETER * parameters;
  console.log(`compute ${label} FLOPs: ${(parameters / 1e9).toFixed(1)} billion parameters, ${(tokens / 1e9).toFixed(1)} billion tokens`);
}

// Check against a published run: 70 billion parameters, 1.4 trillion tokens.
const chinchilla = 6 * 70e9 * 1.4e12;
console.log(`6 x 70 billion x 1.4 trillion = ${(chinchilla / 1e21).toFixed(1)} x 1e21 FLOPs, ${(1.4e12 / 70e9).toFixed(1)} tokens per parameter`);
