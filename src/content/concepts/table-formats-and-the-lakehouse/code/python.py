# A tiny table format: immutable data files, snapshots listing them, and one atomic
# pointer swap (compare-and-swap) in the catalog. Concurrent writers use optimistic retries.


class Catalog:
    def __init__(self):
        self.head = 0
        self.snapshots = {0: []}  # version -> sorted file names (an immutable snapshot)
        self.rows = {}  # file name -> row count (data files are never modified)

    def cas(self, expected, files):
        if self.head != expected:
            return False  # someone else committed first
        self.head += 1
        self.snapshots[self.head] = files
        return True

    def row_count(self, version):
        return sum(self.rows[f] for f in self.snapshots[version])


def commit(cat, who, base, adds, removes, max_retries=4):
    """Optimistic commit built on snapshot `base`; on a lost race, validate and retry."""
    attempts = 0
    while True:
        attempts += 1
        current = cat.snapshots[base]
        missing = [r for r in removes if r not in current]
        if missing:
            print(f"{who}: abort, {missing[0]} was already replaced")
            return 0
        files = sorted([f for f in current if f not in removes] + adds)
        if cat.cas(base, files):
            print(f"{who}: committed v{cat.head} in {attempts} attempt(s) -> [{','.join(files)}]")
            return cat.head
        if attempts > max_retries:
            print(f"{who}: gave up")
            return 0
        base = cat.head  # re-read the new head, then validate and rebuild


def write_file(cat, name, rows):
    cat.rows[name] = rows  # step 1 of every write: data files first, invisible until committed


cat = Catalog()
for n, r in [("f1", 100), ("f2", 100)]:
    write_file(cat, n, r)
commit(cat, "seed", 0, ["f1", "f2"], [])

reader = cat.head  # a long query pins this snapshot
a_base = b_base = cat.head
write_file(cat, "f3", 50)
write_file(cat, "f4", 70)
commit(cat, "A append f3", a_base, ["f3"], [])
commit(cat, "B append f4", b_base, ["f4"], [])  # loses the race, rebases, wins

write_file(cat, "c1", 320)
c_base = cat.head
write_file(cat, "f5", 30)
commit(cat, "C append f5", cat.head, ["f5"], [])
commit(cat, "compact c1", c_base, ["c1"], ["f1", "f2", "f3", "f4"])  # replays on top of C

write_file(cat, "f5b", 30)
write_file(cat, "c2", 350)
d_base = cat.head
commit(cat, "D rewrite f5", d_base, ["f5b"], ["f5"])
commit(cat, "compact c2", d_base, ["c2"], ["c1", "f5"])  # f5 is gone: real conflict

for v in [1, 3, 5, cat.head]:
    print(f"v{v}: {len(cat.snapshots[v])} files, {cat.row_count(v)} rows")
assert cat.row_count(3) == 320 and cat.row_count(5) == 350
assert cat.row_count(reader) == 200  # the pinned reader never saw any of it

keep = [cat.head - 1, cat.head]  # expire all but the last two snapshots
live = set(f for v in keep for f in cat.snapshots[v])
dead = sorted(f for f in cat.rows if f not in live)
print(f"expire keeps v{keep[0]},v{keep[1]}; deletes {len(dead)} files: {','.join(dead)}")
assert dead == ["c2", "f1", "f2", "f3", "f4"]
