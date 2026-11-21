# Event loop: one thread, many tasks, simulated in ticks (no real timers, no clock).
# Part 1: handlers that read a shared counter, await some I/O, then write it back. One thread, yet updates are lost,
#         because other tasks run while a handler waits at an await.
# Part 2: 8 requests each wait 5 ticks for I/O and then need CPU time. A "ping" arrives at tick 6. How long do the
#         requests and the ping take when I/O blocks the loop, when it is awaited, when the CPU work is cut into slices,
#         and when it is moved to 2 worker threads?
# Look for: the lost update needs the await between read and write; a long CPU task delays everything queued behind it.
IO = 5

# R read the counter into a local copy, A await I/O (the task leaves the loop for IO ticks), W write copy+1,
# L take an async mutex (wait in line if it is held), U release it and wake the next waiter.
HANDLERS = {'gap': ['R', 'A', 'W'], 'tight': ['A', 'R', 'W'], 'mutex': ['L', 'R', 'A', 'W', 'U']}


def handlers(variant, n):
    prog = HANDLERS[variant]
    pc = [0] * n
    tmp = [0] * n
    ready = list(range(n))
    timers = []
    waiting = []
    counter = now = seq = 0
    owner = -1
    while ready or timers:
        if not ready:
            now = min(x['at'] for x in timers)
            due = sorted([x for x in timers if x['at'] <= now], key=lambda x: (x['at'], x['seq']))
            for d in due:
                ready.append(d['task'])
                timers.remove(d)
        i = ready.pop(0)
        running = True
        while running and pc[i] < len(prog):
            op = prog[pc[i]]
            if op == 'R':
                tmp[i] = counter
                pc[i] += 1
            elif op == 'W':
                counter = tmp[i] + 1
                pc[i] += 1
            elif op == 'A':
                timers.append({'at': now + IO, 'seq': seq, 'task': i})
                seq += 1
                pc[i] += 1
                running = False
            elif op == 'L':
                if owner == -1:
                    owner = i
                    pc[i] += 1
                else:
                    waiting.append(i)
                    pc[i] += 1
                    running = False
            elif op == 'U':
                owner = -1
                pc[i] += 1
                if waiting:
                    owner = waiting.pop(0)
                    ready.append(owner)
    return counter, now


# Part 2. The loop runs one item at a time and an item is never interrupted unless it is cut into slices.
# blocking: the loop waits for each request's I/O itself. await: I/O overlaps, CPU runs on the loop in arrival order.
# chunked: like await, but CPU runs `slice` ticks at a time and the rest goes to the back of the queue.
# workers: CPU runs on `W` worker threads (one per core) and the loop stays free.
def loop_sim(variant, R, io, cpu, slice_, W, ping_at):
    loop_q = []
    work_q = []
    cur = None
    st = {'remaining': R + 1, 'ping': -1, 'total': 0, 'sum': 0}
    busy = 0
    workers = [None] * W

    def finish(i, t):
        st['remaining'] -= 1
        if i < 0:
            st['ping'] = t
        else:
            st['sum'] += t
            if t > st['total']:
                st['total'] = t

    t = 0
    while st['remaining'] > 0:
        if variant == 'blocking':
            if t == 0:
                for r in range(R):
                    loop_q.append({'id': r, 'rem': io + cpu})
        elif t == io:
            for r in range(R):
                (work_q if variant == 'workers' else loop_q).append({'id': r, 'rem': cpu})
        if t == ping_at:
            loop_q.append({'id': -1, 'rem': 1})
        if cur and cur['end'] == t:
            cur['item']['rem'] -= cur['len']
            if cur['item']['rem'] > 0:
                loop_q.append(cur['item'])
            else:
                finish(cur['item']['id'], t)
            cur = None
        for w in range(W):
            if workers[w] and workers[w]['end'] == t:
                finish(workers[w]['id'], t)
                workers[w] = None
        if not cur and loop_q:
            item = loop_q.pop(0)
            ln = min(item['rem'], slice_) if variant == 'chunked' and item['id'] >= 0 else item['rem']
            cur = {'item': item, 'len': ln, 'end': t + ln}
        for w in range(W):
            if not workers[w] and work_q:
                item = work_q.pop(0)
                workers[w] = {'id': item['id'], 'end': t + item['rem']}
        if cur:
            busy += 1
        if st['remaining'] == 0:
            st['total'] = max(st['total'], st['ping'])
        t += 1
    total = st['total']
    return {'total': total, 'mean': st['sum'] // R, 'ping': st['ping'] - ping_at, 'busy': (busy * 100) // total}


print('== shared counter, one thread, each handler awaits 5 ticks of I/O')
for n in [2, 4]:
    for v in ['gap', 'tight', 'mutex']:
        c, ticks = handlers(v, n)
        print(f'handlers={n} {v:<6} final={c} expected={n} ticks={ticks}')
print('== 8 requests, 5 ticks of I/O each, then CPU; ping at tick 6; slice 5, 2 workers')
for cpu in [2, 40]:
    for v in ['blocking', 'await', 'chunked', 'workers']:
        r = loop_sim(v, 8, IO, cpu, 5, 2, 6)
        print(f"cpu={cpu:<3} {v:<9} total={r['total']:<4} mean={r['mean']:<4} ping={r['ping']:<4} loop busy%={r['busy']}")
