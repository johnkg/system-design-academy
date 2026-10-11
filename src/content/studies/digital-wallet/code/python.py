# A cross-shard wallet transfer in Python:
# every shard applies each operation once (keyed by transfer id), and a durable transfer record lets a crashed transfer be finished, never repeated or lost.
import sys

SHARDS, ACCOUNTS, START = 4, 8, 100


def shard_of(account):
    return account % SHARDS


class Shard:
    def __init__(self):
        self.balance = {}
        self.applied = {}

    # Add delta to an account exactly once per operation id. Repeating the id returns the first answer. A balance never goes below zero.
    def apply(self, op, account, delta):
        if op in self.applied:
            return self.applied[op]
        ok = self.balance[account] + delta >= 0
        if ok:
            self.balance[account] += delta
        self.applied[op] = ok
        return ok


def make_shards():
    shards = [Shard() for _ in range(SHARDS)]
    for s, shard in enumerate(shards):
        for a in range(s, ACCOUNTS, SHARDS):
            shard.balance[a] = START
    return shards


def total(shards):
    return sum(sum(s.balance.values()) for s in shards)


# The naive way: debit on one shard, then credit on another, with nothing recorded in between.
def naive(transfers):
    shards = make_shards()
    times = {}
    for t in transfers:
        for run in range(2 if t['again'] else 1):  # a client that timed out sends it again
            if not shards[shard_of(t['from'])].apply(f"{t['id']}:{run}:d", t['from'], -t['amt']):
                break
            times[t['id']] = times.get(t['id'], 0) + 1
            if t['crash'] and run == 0:  # the process dies before the credit
                break
            shards[shard_of(t['to'])].apply(f"{t['id']}:{run}:c", t['to'], t['amt'])
    return total(shards), len([n for n in times.values() if n > 1])


class Wallet:
    def __init__(self):
        self.shards = make_shards()
        self.log = {}

    def transfer(self, t):
        rec = self.log.get(t['id'])
        if rec is None:  # the intent is saved first
            rec = dict(t, state='INIT')
            self.log[t['id']] = rec
        if rec['state'] == 'INIT':
            ok = self.shards[shard_of(rec['from'])].apply(f"{t['id']}:d", rec['from'], -rec['amt'])
            rec['state'] = 'DEBITED' if ok else 'REJECTED'
        if rec['state'] == 'DEBITED' and t['crash']:
            return  # crash: the money is "in flight", recorded in the log
        if rec['state'] == 'DEBITED':
            self.shards[shard_of(rec['to'])].apply(f"{t['id']}:c", rec['to'], rec['amt'])
            rec['state'] = 'DONE'

    def in_flight(self):
        return sum(r['amt'] for r in self.log.values() if r['state'] == 'DEBITED')

    def recover(self):
        for r in list(self.log.values()):
            self.transfer(dict(r, crash=False))

    def count(self, state):
        return len([r for r in self.log.values() if r['state'] == state])


seed = 7


def random_below(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


transfers = []
for tid in range(24):
    frm = random_below(ACCOUNTS)
    to = (frm + 1 + random_below(ACCOUNTS - 1)) % ACCOUNTS
    transfers.append({'id': tid, 'from': frm, 'to': to, 'amt': 20 + random_below(80), 'crash': tid % 5 == 2, 'again': tid % 4 == 1})

bad_sum, twice = naive(transfers)
print(f"naive debit then credit: total {ACCOUNTS * START} -> {bad_sum}, {ACCOUNTS * START - bad_sum} lost, {twice} transfers charged twice")

wallet = Wallet()
for t in transfers:
    wallet.transfer(t)
    if t['again']:
        wallet.transfer(t)  # repeats are ignored
stuck = wallet.count('DEBITED')
print(f"ledger after crashes: balances {total(wallet.shards)} + in flight {wallet.in_flight()} = {total(wallet.shards) + wallet.in_flight()}, {stuck} transfers waiting")
wallet.recover()
print(f"ledger after recovery: balances {total(wallet.shards)}, in flight {wallet.in_flight()}, done {wallet.count('DONE')}, rejected {wallet.count('REJECTED')}")

negative = any(b < 0 for s in wallet.shards for b in s.balance.values())
if total(wallet.shards) != ACCOUNTS * START or wallet.in_flight() != 0 or negative or stuck == 0 or bad_sum >= ACCOUNTS * START:
    sys.exit(1)
