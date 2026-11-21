# A strangler migration, request by request. 200 customers, 4,000 requests. A share of customers is routed to a new
# service with its own database; the monolith keeps the rest. Reads and writes hit one store or the other, and the
# two stores are kept in step by one of four methods. Legacy reports (30% of reads) always read the monolith's
# database. Everything is integers from a seeded generator, so the output never changes.
CUSTOMERS, TICKS = 200, 4000
WRITE_PCT = 30       # share of requests that update a customer
LEGACY_PCT = 30      # share of reads done by legacy modules that only know the monolith database
DUAL_FAIL_PCT = 10   # dual writes: the second write silently fails this often
LAG = 12             # outbox relay: requests between a write and its copy arriving
CHECK_EVERY = 1000   # parity check: compare and repair every this many requests
ROLLBACK_AT = 2400   # the request at which a rollback happens, if asked for
CHANGES, CHANGE_LEN = [800, 1600, 2400, 3200], 80  # schema changes: owners alternate, the other side breaks


def run(name, pct, mode, parity, rollback):
    seed = 12345

    def rnd():
        nonlocal seed
        seed = (seed * 48271) % 2147483647
        return seed

    truth, old_db, new_db = [0] * CUSTOMERS, [0] * CUSTOMERS, [0] * CUSTOMERS
    relay = []  # [due, c, v, to_new]
    reads = wrong = failed = found = last_rate = behind = 0
    rolled = False
    for t in range(TICKS):
        c = rnd() % CUSTOMERS
        is_write = rnd() % 100 < WRITE_PCT
        legacy = rnd() % 100 < LEGACY_PCT
        lose = rnd() % 100 < DUAL_FAIL_PCT
        for i in range(len(relay) - 1, -1, -1):
            due, rc, rv, to_new = relay[i]
            if due <= t:
                db = new_db if to_new else old_db
                db[rc] = max(db[rc], rv)
                del relay[i]
        if rollback and t == ROLLBACK_AT:
            rolled = True
            behind = sum(1 for i in range(CUSTOMERS) if old_db[i] != truth[i])
        on_new = (not rolled) and (c * 7919) % 100 < pct
        side = 'old' if (not is_write and legacy) else ('new' if on_new else 'old')
        k = next((i for i, s in enumerate(CHANGES) if s <= t < s + CHANGE_LEN), -1)
        if mode == 'shared' and pct > 0 and k >= 0 and side == ('new' if k % 2 == 0 else 'old'):
            failed += 1
        elif is_write:
            truth[c] += 1
            v = truth[c]
            own, other = (new_db, old_db) if on_new else (old_db, new_db)
            own[c] = v
            if pct == 0:
                pass  # nothing to keep in step
            elif mode == 'shared':
                other[c] = v
            elif mode == 'none':
                pass  # the new service owns the data, nothing is copied
            elif mode == 'dual':
                if not lose:
                    other[c] = max(other[c], v)
            else:
                relay.append([t + LAG, c, v, not on_new])
        else:
            reads += 1
            seen = new_db[c] if side == 'new' else old_db[c]
            if seen != truth[c]:
                wrong += 1
        if parity and pct > 0 and (t + 1) % CHECK_EVERY == 0:
            diff = 0
            for i in range(CUSTOMERS):
                if old_db[i] != new_db[i]:
                    diff += 1
                    old_db[i] = new_db[i] = max(old_db[i], new_db[i])
            found += diff
            last_rate = (diff * 100) // CUSTOMERS
    drift = sum(1 for i in range(CUSTOMERS) if old_db[i] != new_db[i])  # with nothing moved there is no second store to compare
    if pct == 0:
        drift = 0
    coordinated = len(CHANGES) if mode == 'shared' and pct > 0 else 0
    print(f'-- {name}')
    print(f'  wrong reads: {wrong} of {reads}; failed requests during schema changes: {failed} ({coordinated} releases needed both teams)')
    print(f'  customers out of sync at the end: {drift} of {CUSTOMERS}; parity checks found {found} (last check {last_rate}%)')
    print(f'  rollback: {str(behind) + " customers had updates the monolith never received" if rollback else "not used"}')


run('nothing moved', 0, 'dual', False, False)
run('50% moved, no copy between the databases', 50, 'none', False, False)
run('50% moved, dual writes, no checks', 50, 'dual', False, False)
run('50% moved, shared database kept for now', 50, 'shared', False, False)
run('50% moved, outbox relay', 50, 'outbox', False, False)
run('50% moved, dual writes, parity check and repair', 50, 'dual', True, False)
run('50% moved, dual writes, rollback at 2400', 50, 'dual', False, True)
run('100% moved, outbox relay, parity check, rollback at 2400', 100, 'outbox', True, True)
