# Scaled dot-product attention in Python, for three tokens with a causal mask.
import math

NAMES = ["the", "trophy", "it"]
QUERIES = [[1, 0], [0, 1], [0, 2]]      # what each token is looking for
KEYS = [[1, 0], [0, 1], [0.5, 0.5]]     # what each token offers
VALUES = [[1, 0], [0, 2], [3, 3]]       # what each token passes on
D = 2                                   # size of a key

scores, weights, outputs = [], [], []
for i in range(len(NAMES)):
    row = [sum(q * k for q, k in zip(QUERIES[i], KEYS[j])) / math.sqrt(D) for j in range(i + 1)]  # causal: only j <= i
    peak = max(row)
    exps = [math.exp(s - peak) for s in row]
    total = sum(exps)
    w = [e / total for e in exps]  # softmax: weights that add up to 1
    out = [sum(w[j] * VALUES[j][c] for j in range(i + 1)) for c in range(2)]
    scores.append(row)
    weights.append(w)
    outputs.append(out)

print("scores (row = token asking, column = token it can look at):")
for name, row in zip(NAMES, scores):
    print(f"{name + ':':<8}" + " ".join(f"{x:.3f}" for x in row))
print("weights (each row adds up to 1):")
for name, row in zip(NAMES, weights):
    print(f"{name + ':':<8}" + " ".join(f"{x:.3f}" for x in row))
print("outputs (weighted mix of the value vectors):")
for name, out in zip(NAMES, outputs):
    print(f"{name + ':':<8}[{out[0]:.3f}, {out[1]:.3f}]")
