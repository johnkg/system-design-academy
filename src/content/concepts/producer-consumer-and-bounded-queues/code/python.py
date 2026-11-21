# Producer-consumer: a tick simulation (no real threads, no clock) of one producer feeding 3 consumers through a queue.
# The producer offers `rate` items per tick for 60 ticks. Each consumer needs 2 ticks per item, so the consumers can
# take 1.5 items per tick. The queue is unbounded or holds at most `bound` items, and when it is full the producer is
# blocked, or the new item is dropped, or the oldest queued item is dropped.
# With `retry` on, every 4th item fails once and its consumer puts it back on the SAME queue to try again.
# Look for: rate 2 is more than the consumers can take, so an unbounded queue just grows; a bound turns that into
# waiting (block) or loss (drop); blocking plus retry-on-the-same-queue can deadlock.
TICKS = 60
CONSUMERS = 3
SERVICE = 2


def simulate(rate, bound, policy, retry):
    total = rate * TICKS
    queue = []
    cons = [{'state': 'idle', 'rem': 0, 'item': None} for _ in range(CONSUMERS)]
    s = {'first_lost': -1, 'produced': 0, 'processed': 0, 'lost': 0, 'peak': 0, 'max_wait': 0, 'blocked': 0, 'ticks': 0, 'deadlock': False}

    def full():
        return bound > 0 and len(queue) >= bound

    # Offers an item to the queue under the policy. Returns True if it was handled (queued or dropped), False if blocked.
    def offer(item, t):
        if not full():
            item['enq'] = t
            queue.append(item)
            return True
        if policy == 'block':
            return False
        if policy == 'dropNew':
            s['lost'] += 1
            if s['first_lost'] < 0:
                s['first_lost'] = item['id']
            return True
        old = queue.pop(0)
        s['lost'] += 1
        if s['first_lost'] < 0:
            s['first_lost'] = old['id']
        item['enq'] = t
        queue.append(item)
        return True

    for t in range(3000):
        for c in cons:
            if c['state'] == 'busy':
                c['rem'] -= 1
                if c['rem'] == 0:
                    if retry and c['item']['id'] % 4 == 3 and not c['item']['failed']:
                        c['item']['failed'] = True
                        c['state'] = 'putting'
                    else:
                        s['processed'] += 1
                        c['state'] = 'idle'
                        c['item'] = None
        for c in cons:
            if c['state'] == 'putting' and offer(c['item'], t):
                c['state'] = 'idle'
                c['item'] = None
        for c in cons:
            if c['state'] == 'idle' and queue:
                c['item'] = queue.pop(0)
                c['state'] = 'busy'
                c['rem'] = SERVICE
                if t - c['item']['enq'] > s['max_wait']:
                    s['max_wait'] = t - c['item']['enq']
        k = 0
        while k < rate and s['produced'] < total:
            if offer({'id': s['produced'], 'enq': t, 'failed': False}, t):
                s['produced'] += 1
            else:
                s['blocked'] += 1
                break
            k += 1
        if len(queue) > s['peak']:
            s['peak'] = len(queue)
        s['ticks'] = t + 1
        if s['produced'] == total and not queue and all(c['state'] == 'idle' for c in cons):
            break
        if policy == 'block' and full() and all(c['state'] == 'putting' for c in cons):
            s['deadlock'] = True
            break
    return s


def show(label, r):
    head = f"DEADLOCK at tick {r['ticks']:<3}" if r['deadlock'] else f"finished at tick {r['ticks']:<3}"
    first = '-' if r['first_lost'] < 0 else str(r['first_lost'])
    print(f"{label:<22} {head} processed={r['processed']:<3} lost={r['lost']:<3} first lost={first:<3} high-water={r['peak']:<3} longest wait={r['max_wait']:<3} producer blocked={r['blocked']}")


print('== producer offers 1 item per tick (the consumers can take 1.5)')
show('unbounded', simulate(1, 0, 'block', False))
print('== producer offers 2 items per tick, 120 items in all')
show('unbounded', simulate(2, 0, 'block', False))
show('bound 10, block', simulate(2, 10, 'block', False))
show('bound 10, drop newest', simulate(2, 10, 'dropNew', False))
show('bound 10, drop oldest', simulate(2, 10, 'dropOld', False))
show('bound 1, block', simulate(2, 1, 'block', False))
print('== same, but every 4th item fails once and is put back on the same queue')
show('unbounded', simulate(2, 0, 'block', True))
show('bound 10, block', simulate(2, 10, 'block', True))
show('bound 10, drop newest', simulate(2, 10, 'dropNew', True))
