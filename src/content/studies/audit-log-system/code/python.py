# A tamper-evident audit log in Python: every entry is chained to the one before it,
# and signed checkpoints hold a Merkle root over each block, so even a clean rewrite is caught.
# FNV-1a stands in for a cryptographic hash here; a real log uses SHA-256 and signs the checkpoints.
import sys


def fnv(text):
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return format(h, "08x")


seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 8) % n


ACTORS = ["alice", "bob", "carol", "dan"]
ACTIONS = ["login", "read", "update", "delete", "export"]
BLOCK = 250
GENESIS = "00000000"


def data_of(e):
    return f"{e['seq']}|{e['actor']}|{e['action']}|{e['target']}|{e['time']}"


def link(prev, e):
    return fnv(f"{prev}|{data_of(e)}")


def build(count):  # append-only: each entry stores the hash of the entry before it
    log = []
    prev = GENESIS
    for seq in range(count):
        e = {"seq": seq, "actor": ACTORS[random(4)], "action": ACTIONS[random(5)], "target": f"doc-{random(50)}"}
        e["time"] = 1700000000 + seq * 3 + random(3)
        e["hash"] = link(prev, e)
        prev = e["hash"]
        log.append(e)
    return log


def merkle(level, index=0, proof=None):  # an odd node is paired with itself
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            right = level[i + 1] if i + 1 < len(level) else level[i]
            nxt.append(fnv(level[i] + right))
            if proof is not None and index in (i, i + 1):
                proof.append(("R", right) if index == i else ("L", level[i]))
        if proof is not None:
            index >>= 1
        level = nxt
    return level[0]


def hashes(log, start, end):
    return [e["hash"] for e in log[start:end]]


def checkpoints(log):  # kept outside the log, signed in real life
    return [{"end": end, "head": log[end - 1]["hash"], "root": merkle(hashes(log, end - BLOCK, end))}
            for end in range(BLOCK, len(log) + 1, BLOCK)]


def verify_chain(log):  # index of the first entry whose hash does not match, or -1
    prev = GENESIS
    for e in log:
        if e["hash"] != link(prev, e):
            return e["seq"]
        prev = e["hash"]
    return -1


def verify_checkpoints(log, cps):  # end of the first checkpoint that disagrees, or -1
    for c in cps:
        if len(log) < c["end"] or log[c["end"] - 1]["hash"] != c["head"]:
            return c["end"]
        if merkle(hashes(log, c["end"] - BLOCK, c["end"])) != c["root"]:
            return c["end"]
    return -1


def prove_entry(log, seq):
    start = seq - (seq % BLOCK)
    proof = []
    merkle(hashes(log, start, start + BLOCK), seq - start, proof)
    return proof


def check_proof(h, proof, root):
    for side, sibling in proof:
        h = fnv(h + sibling) if side == "R" else fnv(sibling + h)
    return h == root


def lower(flag):
    return "true" if flag else "false"


log = build(1000)
cps = checkpoints(log)
print(f"entries: {len(log)}, checkpoints at: {', '.join(str(c['end']) for c in cps)}")
print(f"head {log[999]['hash']}, last root {cps[3]['root']}")
print(f"intact: chain {verify_chain(log)}, checkpoints {verify_checkpoints(log, cps)}")

edited = [dict(e) for e in log]
edited[300]["actor"] = "mallory"
edit_chain = verify_chain(edited)
print(f"edit entry 300: chain breaks at {edit_chain}")

prev = edited[299]["hash"]  # a clean rewrite: recompute every later hash
for i in range(300, len(edited)):
    edited[i]["hash"] = link(prev, edited[i])
    prev = edited[i]["hash"]
rewrite_chain = verify_chain(edited)
rewrite_cp = verify_checkpoints(edited, cps)
print(f"rewrite from 300: chain {rewrite_chain}, checkpoints disagree at {rewrite_cp}")

dropped = log[:900]
drop_cp = verify_checkpoints(dropped, cps)
print(f"truncate to 900: chain {verify_chain(dropped)}, checkpoints disagree at {drop_cp}")

proof = prove_entry(log, 777)
ok_proof = check_proof(log[777]["hash"], proof, cps[3]["root"])
bad_proof = check_proof(fnv("forged"), proof, cps[3]["root"])
print(f"proof for entry 777: {len(proof)} hashes, genuine {lower(ok_proof)}, forged {lower(bad_proof)}")

if edit_chain != 300 or rewrite_chain != -1 or rewrite_cp != 500 or drop_cp != 1000 or not ok_proof or bad_proof:
    sys.exit(1)
