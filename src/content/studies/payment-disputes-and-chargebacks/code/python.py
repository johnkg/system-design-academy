# A dispute engine in Python: idempotent notices, a state machine, durable deadlines, evidence packing and ledger entries.
# Money is in cents and time is in whole days, so the run is deterministic.
import json
import sys

ALLOWED = {
    'opened': ['evidence_requested', 'accepted', 'lost'],
    'evidence_requested': ['evidence_submitted', 'accepted', 'lost'],
    'evidence_submitted': ['won', 'lost'],
    'won': [], 'lost': [], 'accepted': [],
}
FEE = 1500       # the network's dispute fee, charged when a dispute opens
LIMIT_KB = 4500  # the network's cap on the whole evidence packet


def new_store():
    return {'disputes': {}, 'seen': {}, 'ledger': [], 'refunded': {}}


def post(s, did, kind, cents):
    s['ledger'].append({'did': did, 'kind': kind, 'cents': cents})


# A state change is allowed only along the table. The ledger effect belongs to the change, so the two cannot drift apart.
def move(s, d, to):
    if to not in ALLOWED[d['state']]:
        return False
    d['state'] = to
    if to == 'won':
        post(s, d['id'], 'reversal', d['amount'])
    return True


def ingest(s, n):
    if n['nid'] in s['seen']:
        return 'duplicate, ignored'  # the same notice arrives by webhook and again in the batch file
    s['seen'][n['nid']] = True
    if n['type'] == 'opened':
        s['disputes'][n['did']] = {'id': n['did'], 'amount': n['amount'], 'state': 'opened', 'due': n['due'],
                                   'refunded': n['did'] in s['refunded'], 'evidence': []}
        post(s, n['did'], 'provisional debit', -n['amount'])
        post(s, n['did'], 'fee', -FEE)
        return f"created, respond by day {n['due']}"
    d = s['disputes'].get(n['did'])
    if d is None:
        return 'unknown dispute'
    return f"now {n['type']}" if move(s, d, n['type']) else f"rejected {n['type']} while {d['state']}"


# Fill the packet in priority order and skip whatever does not fit.
def pack(items):
    used, chosen = 0, []
    for it in items:
        if used + it['kb'] <= LIMIT_KB:
            used += it['kb']
            chosen.append(it['name'])
    return chosen, used


def submit(s, did, day, items):
    d = s['disputes'][did]
    if d['state'] != 'evidence_requested' or day > d['due']:
        return 'too late or wrong state'
    chosen, used = pack(items)
    d['evidence'] = chosen
    move(s, d, 'evidence_submitted')
    return f"{len(chosen)} of {len(items)} items, {used} KB of {LIMIT_KB}"


# A refund of a disputed charge would pay the customer twice, so it waits until the dispute is won.
def refund(s, did):
    d = s['disputes'].get(did)
    if d and d['state'] != 'won':
        return f"blocked, dispute is {d['state']}"
    s['refunded'][did] = True
    return 'allowed'


# The sweeper reads only stored deadlines, so it gives the same answer after a restart.
def sweep(s, today):
    out = []
    for d in s['disputes'].values():
        if d['state'] not in ('opened', 'evidence_requested'):
            continue
        if d['due'] < today:
            move(s, d, 'lost')
            out.append(f"{d['id']} lost, deadline day {d['due']} missed")
        elif d['due'] - today <= 2:
            out.append(f"{d['id']} reminder, {d['due'] - today} days left")
    return out


def say(label, text):
    print(f"{label}: {text}")


store = new_store()
say('refund dp_4 before any dispute', refund(store, 'dp_4'))
n1 = {'nid': 'n1', 'type': 'opened', 'did': 'dp_1', 'amount': 8000, 'due': 7}
feed = [
    n1, dict(n1),
    {'nid': 'n2', 'type': 'evidence_requested', 'did': 'dp_1'}, {'nid': 'n3', 'type': 'opened', 'did': 'dp_2', 'amount': 2500, 'due': 8},
    {'nid': 'n4', 'type': 'evidence_requested', 'did': 'dp_2'}, {'nid': 'n5', 'type': 'opened', 'did': 'dp_3', 'amount': 4000, 'due': 9},
    {'nid': 'n6', 'type': 'evidence_requested', 'did': 'dp_3'}, {'nid': 'n7', 'type': 'opened', 'did': 'dp_4', 'amount': 1200, 'due': 10},
]
for n in feed:
    say(f"{n['nid']} {n['did']}", ingest(store, n))
say('refund dp_1 while open', refund(store, 'dp_1'))
items = [{'name': 'receipt', 'kb': 300}, {'name': 'delivery proof', 'kb': 1200}, {'name': 'chat log', 'kb': 2800},
         {'name': 'device log', 'kb': 900}, {'name': 'photos', 'kb': 1500}]
say('submit dp_1 on day 3', submit(store, 'dp_1', 3, items))
say('accept dp_3', 'accepted' if move(store, store['disputes']['dp_3'], 'accepted') else 'refused')
say('n8 dp_3', ingest(store, {'nid': 'n8', 'type': 'won', 'did': 'dp_3'}))
store = json.loads(json.dumps(store))  # restart: everything comes back from stored rows
say('restart', f"{len(store['disputes'])} disputes reloaded")
for line in sweep(store, 6):
    say('sweep day 6', line)
for line in sweep(store, 11):
    say('sweep day 11', line)
say('n9 dp_1', ingest(store, {'nid': 'n9', 'type': 'won', 'did': 'dp_1'}))

net = {}
for e in store['ledger']:
    net[e['did']] = net.get(e['did'], 0) + e['cents']
for d in store['disputes'].values():
    print(f"{d['id']} {d['state']} net {net[d['id']]}{' (refunded first)' if d['refunded'] else ''}")
total = sum(net.values())
print(f"merchant balance change {total}")
ok = (net['dp_1'] == -FEE and net['dp_2'] == -2500 - FEE and net['dp_3'] == -4000 - FEE and net['dp_4'] == -1200 - FEE
      and total == -13700 and len(store['ledger']) == 9)
if not ok:
    sys.exit(1)
