# Merging two people's simultaneous edits with operational transformation, in Python:
# each edit is rewritten to account for the other one, so both copies of the text end up identical.
import sys


# An operation changes one character: {"type": "ins", "pos", "ch", "site"} or {"type": "del", "pos", "site"}. None means "nothing to do".
def apply(text, op):
    if not op:
        return text
    if op["type"] == "ins":
        return text[:op["pos"]] + op["ch"] + text[op["pos"]:]
    return text[:op["pos"]] + text[op["pos"] + 1:]


# Rewrite `a` so it makes the same change after `b` has already been applied.
def transform(a, b):
    if not a or not b:
        return a
    if a["type"] == "ins" and b["type"] == "ins":
        if a["pos"] < b["pos"] or (a["pos"] == b["pos"] and a["site"] < b["site"]):
            return a  # same spot: the lower site number goes first, so both sides agree
        return {**a, "pos": a["pos"] + 1}
    if a["type"] == "ins" and b["type"] == "del":
        return a if a["pos"] <= b["pos"] else {**a, "pos": a["pos"] - 1}
    if a["type"] == "del" and b["type"] == "ins":
        return a if a["pos"] < b["pos"] else {**a, "pos": a["pos"] + 1}
    if a["pos"] < b["pos"]:
        return a  # both delete: before the other one's position, nothing changes
    if a["pos"] > b["pos"]:
        return {**a, "pos": a["pos"] - 1}
    return None   # the same character was already deleted by the other edit


# A worked example: both people start with "CAT". Alice types X at the very start while Bob deletes the final T.
start = "CAT"
alice = {"type": "ins", "pos": 0, "ch": "X", "site": 1}
bob = {"type": "del", "pos": 2, "site": 2}
alice_sees = apply(apply(start, alice), transform(bob, alice))
bob_sees = apply(apply(start, bob), transform(alice, bob))
alice_naive = apply(apply(start, alice), bob)  # Bob's edit applied as written: position 2 is no longer the T
bob_naive = apply(apply(start, bob), alice)
print(f'start "{start}": Alice types X at the start, Bob deletes the last letter, at the same time')
print(f'with transformation: Alice sees "{alice_sees}", Bob sees "{bob_sees}"')
print(f'without it: Alice sees "{alice_naive}", Bob sees "{bob_naive}"')
if alice_sees != "XCA" or bob_sees != "XCA" or alice_naive == bob_naive:
    sys.exit(1)

# Try it on 5,000 random pairs of simultaneous edits.
seed = 99


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def make_op(text, site):
    if len(text) > 0 and random(2) == 0:
        return {"type": "del", "pos": random(len(text)), "site": site}
    return {"type": "ins", "pos": random(len(text) + 1), "ch": "abcdefgh"[random(8)], "site": site}


converged = diverged = 0
TRIALS = 5000
for _ in range(TRIALS):
    text = "".join("ABCDEFGH"[random(8)] for _ in range(random(9)))
    a = make_op(text, 1)
    b = make_op(text, 2)
    left = apply(apply(text, a), transform(b, a))
    right = apply(apply(text, b), transform(a, b))
    if left == right:
        converged += 1
    if apply(apply(text, a), b) != apply(apply(text, b), a):  # the same edits applied without any rewriting
        diverged += 1
print(f"with transformation: {converged} of {TRIALS} pairs ended with identical text")
print(f"without it: {diverged} of {TRIALS} pairs ended with different text")
if converged != TRIALS or diverged == 0:
    sys.exit(1)
