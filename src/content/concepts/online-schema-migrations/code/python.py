# Splitting users.full_name into first_name|last_name while live writes keep arriving.
# Four migration orders run on the same seeded write stream; only the safe ones end equal to the old table.
import sys

N, CHUNK, WRITES = 1000, 50, 12  # rows, rows per backfill batch, live writes between steps
seed = 12345


def rand(n):
    global seed
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
    return (seed >> 8) % n


def split(name):
    i = name.index(" ")
    return name[:i] + "|" + name[i + 1:]


def migrate(mode):
    global seed
    seed = 12345
    old = [f"f{i} l{i}" for i in range(N)]  # the live table: full_name
    new = [None] * N                         # the new columns (or the shadow table)
    state = {"dual": mode != "backfill-first", "version": 0}  # is the app writing both shapes yet?

    def live_writes():                       # the application keeps renaming users
        for _ in range(WRITES):
            i = rand(N)
            state["version"] += 1
            old[i] = f"f{i}w{state['version']} l{i}"
            if state["dual"] or mode == "shadow":
                new[i] = split(old[i])       # dual-write, or REPLACE from the change log

    for start in range(0, N, CHUNK):
        if mode == "backfill-first" and start == N // 2:
            state["dual"] = True             # dual-write deployed too late
        end = start + CHUNK
        if mode in ("rmw", "shadow"):
            snapshot = old[start:end]        # read the batch ...
            live_writes()                    # ... a live write lands in between ...
            for i in range(start, end):
                derived = split(snapshot[i - start])
                if mode == "rmw":
                    new[i] = derived         # ... blind write-back clobbers it
                elif new[i] is None:
                    new[i] = derived         # INSERT IGNORE: the log already won
        else:
            live_writes()
            for i in range(start, end):
                if new[i] is None:
                    new[i] = split(old[i])   # UPDATE ... WHERE first_name IS NULL
        live_writes()
    wrong = sum(1 for i in range(N) if new[i] != split(old[i]))
    return wrong, state["version"]


modes = [
    ("dual-write first, then backfill", "dual", True),
    ("backfill first, dual-write late", "backfill-first", False),
    ("backfill reads, then blind writes", "rmw", False),
    ("shadow copy + change log", "shadow", True),
]
for label, mode, must_be_safe in modes:
    wrong, version = migrate(mode)
    print(f"{label}: {wrong} of {N} rows wrong after {version} live writes")
    if must_be_safe != (wrong == 0):
        print("invariant violated: " + label, file=sys.stderr)
        sys.exit(1)
print("safe orders match the old table; unsafe orders lose updates")
