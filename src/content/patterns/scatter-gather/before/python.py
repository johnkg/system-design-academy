# Without the pattern: vendors are asked one after another, so the waiting times add up.

VENDORS = [
    ("A", 120, False),
    ("B", 80, False),
    ("C", 450, False),
    ("D", 200, False),
    ("E", 60, True),  # fails
]

waited = 0
print(f"Asking {len(VENDORS)} vendors one by one")
for name, latency, fails in VENDORS:
    waited += latency  # each call must finish before the next one starts
    print(f"  {name} {'failed' if fails else 'answered'}, total waited {waited} ms")
print(f"Total wait: {waited} ms")  # the slow vendor C holds up everything after it
