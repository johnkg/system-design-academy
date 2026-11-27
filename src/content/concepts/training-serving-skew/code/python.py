# Training-serving skew in Python: one feature, days since signup, computed in two places.
PAIRS = [(0, 48), (0, 50), (10, 130), (5, 100), (0, 24)]  # (signup hour, now hour)


def training_days(signup, now):
    return (now - signup) // 24  # the batch pipeline counts whole days


def serving_days(signup, now):
    return (now - signup + 23) // 24  # the live service rounds up


mismatches = 0
for signup, now in PAIRS:
    train, serve = training_days(signup, now), serving_days(signup, now)
    differ = train != serve
    mismatches += 1 if differ else 0
    print(f"signup {signup}h, now {now}h: training {train}, serving {serve}, {'MISMATCH' if differ else 'match'}")
print(f"mismatches: {mismatches} of {len(PAIRS)} ({mismatches * 100 // len(PAIRS)}%)")
