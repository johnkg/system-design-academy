# A miniature of the Google File System (SOSP 2003), in Python (a teaching model, not Google's code):
# one master keeps the namespace and the chunk map in memory, files are cut into fixed-size chunks, every chunk lives on
# three chunkservers, record append pads a chunk that cannot hold the record, a dead chunkserver's chunks are copied again,
# and a restarted master learns where chunks are by asking the chunkservers. Everything is deterministic.

CHUNK, COPIES = 10, 3  # bytes per chunk (GFS uses 64 MB) and replicas per chunk
SERVERS = ["S1", "S2", "S3", "S4", "S5", "S6"]
disks = {s: {} for s in SERVERS}  # chunk id -> bytes held
alive = set(SERVERS)
master = {"files": {}, "where": {}, "next": 1, "oplog": []}


def pick(count, exclude=()):  # least-loaded live chunkservers, ties by name
    ok = [s for s in SERVERS if s in alive and s not in exclude]
    return sorted(ok, key=lambda s: (len(disks[s]), s))[:count]


def new_chunk(file):
    cid = f"c{master['next']}"
    master["next"] += 1
    master["files"][file].append(cid)
    master["oplog"].append(f"add {file} {cid}")  # the namespace and file-to-chunk map are logged; locations are not
    servers = pick(COPIES)
    master["where"][cid] = servers
    for s in servers:
        disks[s][cid] = ""
    return cid


def record_append(file, record):  # the primary picks the offset; a record that does not fit pads the chunk and the client retries on the next one
    chunks = master["files"][file]
    cid = chunks[-1] if chunks else new_chunk(file)
    used = len(disks[master["where"][cid][0]][cid])
    if used + len(record) > CHUNK:
        for s in master["where"][cid]:
            disks[s][cid] += "." * (CHUNK - used)
        print(f"append {record}: does not fit in {cid} ({CHUNK - used} bytes left), chunk padded, retry on a new chunk")
        cid = new_chunk(file)
    for s in master["where"][cid]:
        disks[s][cid] += record
    print(f"append {record}: stored in {cid} on {','.join(master['where'][cid])}")


master["files"]["/logs/web"] = []
for record in ["AAAA", "BBBBBB", "CCCCCCC", "DDDDD"]:
    record_append("/logs/web", record)
print("chunks: " + " ".join(f"{cid}={disks[master['where'][cid][0]][cid]}" for cid in master["files"]["/logs/web"]))

alive.discard("S2")
disks["S2"].clear()
print("S2 stops sending heartbeats and is treated as dead")
need = [(cid, [s for s in servers if s in alive]) for cid, servers in master["where"].items()]
need = sorted([n for n in need if len(n[1]) < COPIES], key=lambda n: len(n[1]))
print(f"chunks with fewer than {COPIES} replicas: " + ", ".join(f"{cid} ({len(live)})" for cid, live in need))
for cid, live in need:
    target = pick(1, live)[0]
    disks[target][cid] = disks[live[0]][cid]  # clone from a surviving replica
    master["where"][cid] = live + [target]
    print(f"re-replicate {cid}: {live[0]} -> {target}")

print("the master restarts and forgets where chunks are")
master["where"] = {}
for s in [x for x in SERVERS if x in alive]:
    for cid in disks[s]:
        master["where"].setdefault(cid, []).append(s)  # each chunkserver reports its chunks
replicas = sum(len(v) for v in master["where"].values())
print(f"rebuilt from reports: {len(master['where'])} chunks, {replicas} replicas, namespace from the operation log: {len(master['oplog'])} entries")

content = "".join(disks[master["where"][cid][0]][cid] for cid in master["files"]["/logs/web"])
print(f"reader sees: {content} -> without padding: {content.replace('.', '')}")
