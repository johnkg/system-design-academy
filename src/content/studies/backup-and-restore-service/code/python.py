# Full plus incremental backups with retention, a vault that refuses deletes, and restore verification, in Python.
# A toy database of 32 pages is backed up daily. Ransomware starts garbling pages on day 18, and on day 23 it tries to delete every backup.
import sys

PAGES, DAYS, FULL_EVERY, KEEP, ATTACK_DAY = 32, 24, 7, 14, 18
LOCK = KEEP + FULL_EVERY

seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


# A 32-bit FNV style hash of the whole database, recorded with each backup so a restore can be compared with the original.
def fingerprint(pages):
    h = 2166136261
    for v in pages:
        h = ((h ^ v) * 16777619) & 0xFFFFFFFF
    return h


# The vault refuses to delete a backup before its lock expires, even for an administrator.
class Vault:
    def __init__(self):
        self.items = {}

    def put(self, backup):
        self.items[backup['day']] = {'backup': backup, 'lock_until': backup['day'] + LOCK}

    def remove(self, day, today):
        if today < self.items[day]['lock_until']:
            return False
        del self.items[day]
        return True


# Keep every backup younger than KEEP days and the chain it needs: the last full backup and each incremental after it.
def prune(vault, today):
    needed = set()
    for day in vault.items:
        if today - day < KEEP:
            needed.update(range(day - day % FULL_EVERY, day + 1))
    for day in list(vault.items):
        if day not in needed:
            vault.remove(day, today)


# Rebuild the database as it was on a given day: start from the full backup, then apply each incremental in order.
def restore(vault, day):
    state = [0] * PAGES
    for d in range(day - day % FULL_EVERY, day + 1):
        if d not in vault.items:
            return None
        for i, v in vault.items[d]['backup']['pages']:
            state[i] = v
    return state


prod = [(i + 1) * 97 for i in range(PAGES)]  # every valid page value is a multiple of 97
dirty = [True] * PAGES


def touch(i, v):
    prod[i] = v
    dirty[i] = True


vault = Vault()
fulls = written = 0

for day in range(DAYS):
    for _ in range(6):
        touch(random(PAGES), random(1000) * 97)
    if day >= ATTACK_DAY:
        for _ in range(8):
            touch(random(PAGES), random(1000) * 97 + 1 + random(96))  # garbled
    full = day % FULL_EVERY == 0
    pages = [[i, v] for i, v in enumerate(prod) if full or dirty[i]]
    vault.put({'day': day, 'full': full, 'pages': pages, 'hash': fingerprint(prod)})
    dirty = [False] * PAGES
    if full:
        fulls += 1
    written += len(pages)
    prune(vault, day)

print(f"{fulls} full and {DAYS - fulls} incremental backups wrote {written} pages (daily fulls would write {PAGES * DAYS})")
days = sorted(vault.items)
print(f"the vault holds {len(days)} backups, from day {days[0]} to day {days[-1]}")

refused = len([d for d in days if not vault.remove(d, DAYS - 1)])
print(f"attacker deletes {len(days) - refused} of {len(days)} backups, the vault refuses {refused}")

clean = -1
day = DAYS - 1
while day >= 0 and clean < 0:
    state = restore(vault, day)
    hash_ok = fingerprint(state) == vault.items[day]['backup']['hash']
    data_ok = all(v % 97 == 0 for v in state)
    print(f"restore test day {day}: hash {'ok' if hash_ok else 'BAD'}, data check {'passed' if data_ok else 'FAILED'}")
    if hash_ok and data_ok:
        clean = day
    day -= 1
print(f"newest clean restore point: day {clean}, so {DAYS - 1 - clean} days of changes are lost")
if refused != len(days) or clean != ATTACK_DAY - 1:
    sys.exit(1)
