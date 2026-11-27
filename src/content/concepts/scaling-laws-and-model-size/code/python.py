# Compute-optimal model size in Python, using C = 6 * N * D and D = 20 * N, so N = sqrt(C / 120).
import math

TOKENS_PER_PARAMETER = 20

for compute in (1e21, 1e23, 1e25):
    parameters = math.sqrt(compute / (6 * TOKENS_PER_PARAMETER))
    tokens = TOKENS_PER_PARAMETER * parameters
    print(f"compute {compute:.0e} FLOPs: {parameters / 1e9:.1f} billion parameters, {tokens / 1e9:.1f} billion tokens")

# Check against a published run: 70 billion parameters, 1.4 trillion tokens.
chinchilla = 6 * 70e9 * 1.4e12
print(f"6 x 70 billion x 1.4 trillion = {chinchilla / 1e21:.1f} x 1e21 FLOPs, {1.4e12 / 70e9:.1f} tokens per parameter")
