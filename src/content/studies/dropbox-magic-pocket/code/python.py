# A miniature of the technique behind Dropbox's Magic Pocket, in Python (a teaching model, not Dropbox's code):
# blocks named by a hash go into append-only volumes, a full volume is closed, a closed volume is re-encoded from
# three copies to three data shards plus one XOR parity shard, a read rebuilds a lost shard from the others,
# and repair commits its new layout by raising a generation number.
# Everything is deterministic, so every run prints the same thing.
import sys
from functools import reduce

SLOT = 16  # bytes in one block slot (real blocks are up to 4 MB)
K = 3  # data slots per volume; a volume closes when they are full
NODES = 6  # storage nodes in the toy cell
COPIES = 3  # replicas of a volume while it is young


# Stand-in for the SHA-256 name of a block: 32-bit FNV-1a, printed as 8 hex digits.
def name_of(text):
    h = 0x811C9DC5
    for b in text.encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def xor(a, b):
    return bytes(x ^ y for x, y in zip(a, b))


def xor_all(items):
    return reduce(xor, items)


def text_of(data, length):
    return data[:length].decode()


index = {}  # block name -> {vol, slot, len, deleted}
volumes = []  # {id, open, slots, mode, nodes, shards, generation}


def put(content):
    name = name_of(content)
    known = index.get(name)
    if known and not known["deleted"]:
        print(f"put {content:<12} {name} already stored, nothing written")
        return
    vol = volumes[-1] if volumes else None
    if vol is None or not vol["open"]:
        vol = {"id": len(volumes), "open": True, "slots": [], "mode": "replicated",
               "nodes": [(len(volumes) + i) % NODES for i in range(3)], "shards": None, "generation": 0}
        volumes.append(vol)
    data = content.encode()
    vol["slots"].append(data + bytes(SLOT - len(data)))  # append only: slots are never rewritten
    index[name] = {"vol": vol["id"], "slot": len(vol["slots"]) - 1, "len": len(data), "deleted": False}
    line = f"put {content:<12} {name} volume {vol['id']} slot {len(vol['slots']) - 1}"
    if len(vol["slots"]) == K:
        vol["open"] = False
        line += ", volume full and closed"
    print(line)


# Cool a closed volume: three full copies become K data shards and one parity shard on different nodes.
def encode(vol):
    before = COPIES * K * SLOT
    vol["shards"] = vol["slots"] + [xor_all(vol["slots"])]
    vol["nodes"] = [(vol["id"] + i) % NODES for i in range(4)]
    vol["mode"] = "encoded"
    vol["generation"] += 1
    nodes = ",".join(map(str, vol["nodes"]))
    print(f"volume {vol['id']} encoded: {before} bytes as {COPIES} copies, {len(vol['shards']) * SLOT} bytes as {K}+1 shards on nodes {nodes}, generation {vol['generation']}")


def read(name, down):
    e = index[name]
    vol = volumes[e["vol"]]
    if vol["mode"] == "replicated":
        node = next(n for n in vol["nodes"] if n != down)
        return text_of(vol["slots"][e["slot"]], e["len"]), f"replica on node {node}"
    if vol["nodes"][e["slot"]] != down:
        return text_of(vol["shards"][e["slot"]], e["len"]), f"shard {e['slot']} on node {vol['nodes'][e['slot']]}"
    others = [s for i, s in enumerate(vol["shards"]) if i != e["slot"] and vol["nodes"][i] != down]
    return text_of(xor_all(others), e["len"]), f"shard {e['slot']} lost, rebuilt from {len(others)} other shards"


# The coordinator's repair: only a closed volume is moved, and the move commits by raising the generation.
def repair(vol, down):
    lost = vol["nodes"].index(down)
    spare = next(n for n in range(NODES) if n not in vol["nodes"])
    vol["shards"][lost] = xor_all([s for i, s in enumerate(vol["shards"]) if i != lost])
    vol["nodes"][lost] = spare
    vol["generation"] += 1
    print(f"repair volume {vol['id']}: shard {lost} rebuilt on node {spare}, generation now {vol['generation']}")


for c in ["report-v1", "photo-001", "report-v1", "notes-draft", "invoice-0316", "tax-1997"]:
    put(c)
print("open volumes: " + ",".join(str(v["id"]) for v in volumes if v["open"]))

encode(volumes[0])
photo = name_of("photo-001")
data, how = read(photo, -1)
print(f'read photo-001: "{data}" via {how}')

down = volumes[0]["nodes"][index[photo]["slot"]]
print(f"node {down} stops answering")
data, how = read(photo, down)
print(f'read photo-001: "{data}" via {how}')
repair(volumes[0], down)
print(f"node {down} comes back with generation {volumes[0]['generation'] - 1} of volume 0; the table says {volumes[0]['generation']}, so its shard is ignored")

index[name_of("notes-draft")]["deleted"] = True
print("deleted notes-draft: volume 0 is unchanged, 2 of 3 slots are live, compaction will reclaim the rest")

ok = data == "photo-001" and volumes[0]["generation"] == 2
print(f"blocks {len(index)}, volumes {len(volumes)}, checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
