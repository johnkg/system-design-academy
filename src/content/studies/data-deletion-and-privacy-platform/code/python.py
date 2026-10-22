# A deletion orchestrator in Python: a data map lists every store, each request fans out one task per store,
# failed tasks retry the next day, a legal hold pauses a request, and the lake is erased by destroying a per-user key.
import copy
import sys

STORES = ['users-db', 'search-index', 'cache', 'lake', 'warehouse', 'processor-crm']
METHOD = {'users-db': 'delete rows', 'search-index': 'delete docs', 'cache': 'evict keys', 'lake': 'shred key', 'warehouse': 'delete rows', 'processor-crm': 'api call'}
GRACE = 2  # days between the soft delete and the hard delete
DEADLINE = 30  # days allowed by law
USERS, MAX_ROWS = 6, 3  # each user has 1..3 rows in every store
CRM_FAIL_MOD = 3  # the CRM processor fails (user % 3) times before it succeeds
RESTORE_DAY = 20  # the day a backup is restored


def fnv(text):
    h = 0x811C9DC5
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def xor_stream(key, data_bytes):  # a toy stream cipher, only to show the idea of crypto-shredding
    s = key
    out = []
    for b in data_bytes:
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
        out.append(b ^ (s >> 24))
    return out


keyring = {}  # user -> key; destroying the entry is the erasure
data = {s: {} for s in STORES}
for user in range(1, USERS + 1):
    keyring[user] = fnv('key|' + str(user))
    for i, store in enumerate(STORES):
        rows = []
        for n in range(1 + (user + i) % MAX_ROWS):
            text = f'{store}:{user}:{n}'
            rows.append(xor_stream(keyring[user], [ord(c) for c in text]) if store == 'lake' else text)
        data[store][user] = rows


def readable(store, user):
    rows = data[store].get(user, [])
    if store != 'lake':
        return len(rows)
    if user not in keyring:
        return 0
    return sum(1 for r in rows if ''.join(chr(b) for b in xor_stream(keyring[user], r)).startswith('lake:'))


def total(user):
    return sum(readable(s, user) for s in STORES)


def erase(store, user):
    if store == 'lake':
        del keyring[user]  # the ciphertext stays in the immutable files, unreadable
    else:
        del data[store][user]


holds = {4: 10}  # user 4 is under a legal hold until day 10
backup = copy.deepcopy(data['users-db'])  # the day 0 snapshot is never edited
requests = [{'id': 'r1', 'user': 2, 'filed': 0}, {'id': 'r2', 'user': 4, 'filed': 0}, {'id': 'r3', 'user': 5, 'filed': 1}]
for r in requests:
    r['tasks'] = {s: 0 for s in STORES}
    r['done'] = None
audit = []

for r in requests:
    parts = ', '.join(f'{s} {readable(s, r["user"])}' for s in STORES)
    print(f'export {r["id"]} (user {r["user"]}) day {r["filed"]}: {parts} = {total(r["user"])} records')
for day in range(DEADLINE + 1):
    for r in requests:
        if r['done'] is not None or day < r['filed'] + GRACE:
            continue
        if r['user'] in holds and day < holds[r['user']]:
            continue  # blocked, and nothing is deleted
        for store in STORES:
            if r['tasks'][store] == -1:
                continue
            r['tasks'][store] += 1
            if store == 'processor-crm' and r['tasks'][store] <= r['user'] % CRM_FAIL_MOD:
                print(f'day {day}: {r["id"]} {store} failed, will retry')
                continue
            erase(store, r['user'])
            r['tasks'][store] = -1
            audit.append({'id': r['id'], 'store': store, 'method': METHOD[store], 'day': day, 'who': format(fnv('salt|' + str(r['user'])), '08x')})
        if all(r['tasks'][s] == -1 for s in STORES):
            r['done'] = day
            print(f'day {day}: {r["id"]} complete after {day - r["filed"]} days')
print(f'audit entries: {len(audit)}, first: {audit[0]["method"]} in {audit[0]["store"]} for {audit[0]["who"]}')
lake_kept = sum(len(data['lake'][r['user']]) for r in requests)
print(f'lake rows still in the files: {lake_kept}, readable: {sum(readable("lake", r["user"]) for r in requests)}')


def present(rows):
    return sum(1 for r in requests if r['user'] in rows)


replay = [r['user'] for r in requests if r['done'] is not None and r['done'] <= RESTORE_DAY]
restored = copy.deepcopy(backup)
print(f'restore on day 20 without the replay list: {present(restored)} deleted users are back')
for u in replay:
    del restored[u]
print(f'restore on day 20 with the replay list [{",".join(str(u) for u in replay)}]: {present(restored)} deleted users are back')

late = sum(1 for r in requests if r['done'] is None or r['done'] > DEADLINE)
if any(total(r['user']) != 0 for r in requests) or late or present(restored) != 0 or len(audit) != 18:
    sys.exit(1)
