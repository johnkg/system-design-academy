# Temperature and top-p in Python, on fixed scores so that the output is the same every run.
import math

TOKENS = ["a", "b", "c", "d", "e"]
LOGITS = [4, 3, 2, 1, 0]


def softmax(logits, temperature):
    exps = [math.exp(x / temperature) for x in logits]
    total = sum(exps)
    return [e / total for e in exps]


for temperature in (0.5, 1, 2):
    probs = softmax(LOGITS, temperature)
    print(f"temperature {temperature}: " + ", ".join(f"{t} {p:.3f}" for t, p in zip(TOKENS, probs)))

probs = softmax(LOGITS, 1)
order = sorted(range(len(TOKENS)), key=lambda i: -probs[i])  # most likely first
kept, total = [], 0.0
for i in order:  # top-p: the smallest set whose probabilities add up to at least p
    kept.append(i)
    total += probs[i]
    if total >= 0.9:
        break
print(f"top-p 0.9 at temperature 1 keeps {', '.join(TOKENS[i] for i in kept)} (together {total:.3f})")
print("renormalised: " + ", ".join(f"{TOKENS[i]} {probs[i] / total:.3f}" for i in kept))
