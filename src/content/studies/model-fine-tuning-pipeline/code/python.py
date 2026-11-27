# A promotion gate and a training run that resumes from a checkpoint, in Python.
# Scores are whole thousandths (800 means 0.800) so that every language prints the same numbers.
MARGIN, TOLERANCE = 20, 10  # promote only if overall gains at least 0.020 and no slice drops by more than 0.010
SLICES = ["short", "long", "non-english"]
CURRENT = {"overall": 800, "short": 820, "long": 760, "non-english": 700}
CANDIDATES = {
    "A": {"overall": 840, "short": 860, "long": 800, "non-english": 680},
    "B": {"overall": 815, "short": 830, "long": 770, "non-english": 705},
    "C": {"overall": 850, "short": 870, "long": 810, "non-english": 710},
}


def fmt(delta):
    return ("-" if delta < 0 else "+") + "0." + str(abs(delta)).zfill(3)


def gate(candidate):
    gain = candidate["overall"] - CURRENT["overall"]
    if gain < MARGIN:
        return False, f"overall {fmt(gain)} below the margin"
    for name in SLICES:
        delta = candidate[name] - CURRENT[name]
        if delta < -TOLERANCE:
            return False, f"overall {fmt(gain)} ok, slice {name} {fmt(delta)} regressed"
    return True, f"overall {fmt(gain)} ok, no slice regressed"


print("gate: needs an overall gain of at least 0.020 and no slice down by more than 0.010")
for name, scores in CANDIDATES.items():
    promoted, reason = gate(scores)
    print(f"candidate {name}: {reason} -> {'promoted' if promoted else 'rejected'}")

# A run that is interrupted resumes from its newest complete checkpoint.
TOTAL_STEPS, CHECKPOINT_EVERY, CRASH_AFTER = 10, 4, 7
storage = {}


def save_checkpoint(step):
    storage[f"ckpt-{step}"] = {"step": step}  # 1. write the data
    storage["latest"] = f"ckpt-{step}"        # 2. write the manifest last: a half-written checkpoint is never used


def train(first, crash_after=None):
    for step in range(first, TOTAL_STEPS + 1):
        if step % CHECKPOINT_EVERY == 0:
            save_checkpoint(step)
        if step == crash_after:
            raise RuntimeError("node lost")


print(f"training {TOTAL_STEPS} steps, checkpoint every {CHECKPOINT_EVERY}, crash after step {CRASH_AFTER}")
try:
    train(1, crash_after=CRASH_AFTER)
except RuntimeError:
    saved = storage[storage["latest"]]["step"]
    print(f"run 1: steps 1-{CRASH_AFTER}, crashed, last checkpoint at step {saved}")
    train(saved + 1)
    print(f"run 2: resumed at step {saved + 1}, finished at step {TOTAL_STEPS}")
    print(f"work redone: {CRASH_AFTER - saved} steps")
