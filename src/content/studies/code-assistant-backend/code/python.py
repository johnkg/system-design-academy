# A code assistant's two core pieces in Python: debouncing with cancellation, and a context ranker.
# Times are in milliseconds and the model's delay is fixed, so the output is the same on every run.
KEYS = [0, 100, 200, 300, 700, 1500]  # when the developer presses a key
DEBOUNCE, LATENCY = 250, 400          # wait for a pause this long, then the model needs this long

events = []
for i, t in enumerate(KEYS):
    next_key = KEYS[i + 1] if i + 1 < len(KEYS) else float("inf")
    fire = t + DEBOUNCE
    if next_key < fire:
        continue  # typing went on before the pause was long enough: no request
    events.append((fire, f"request fired (after key at {t})"))
    done = fire + LATENCY
    if next_key < done:
        events.append((next_key, "key: request cancelled"))  # a newer key cancels the request in flight
    else:
        events.append((done, "answer shown"))
for time, text in sorted(events, key=lambda e: e[0]):
    print(f"t={time} {text}")

# Context: take pieces in priority order, skip any that do not fit in the token budget.
BUDGET = 1000
PIECES = [  # (name, tokens, priority)
    ("current file, before cursor", 400, 100),
    ("current file, after cursor", 150, 90),
    ("symbol definition: parse_order", 120, 80),
    ("recent edit: models.py", 250, 70),
    ("open tab: utils.py", 300, 60),
    ("similar code: legacy/orders.py", 500, 40),
    ("README.md", 600, 10),
]
print(f"budget {BUDGET} tokens")
used = 0
for name, tokens, _ in sorted(PIECES, key=lambda p: -p[2]):
    if used + tokens <= BUDGET:
        used += tokens
        print(f"+ {name} ({tokens})")
    else:
        print(f"- skipped {name} ({tokens}), over budget")
print(f"used {used} of {BUDGET} tokens")
