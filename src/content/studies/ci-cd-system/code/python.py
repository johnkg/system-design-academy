# The core of a CI system in Python: a pipeline DAG, content-addressed cache keys,
# timing-based test sharding and a fair-share scheduler.
import sys

# 1. A pipeline is a DAG: each job lists the jobs it needs. Jobs in the same layer can run at the same time.
PIPELINE = {'lint': [], 'build': [], 'test': ['build'], 'package': ['test', 'lint']}


def layers(jobs):
    names = list(jobs)
    done = set()
    out = []
    while len(done) < len(names):
        ready = [j for j in names if j not in done and all(need in done for need in jobs[j])]
        if not ready:
            raise ValueError('the pipeline has a cycle')
        out.append(ready)
        done.update(ready)
    return out


# 2. A cache key is a hash of the content that decides the result, so equal inputs give the same key and any change gives a new one.
def fnv1a(text):  # FNV-1a, 32 bits
    h = 0x811C9DC5
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return format(h, '08x')


def cache_key(os_name, lockfile):
    return f'deps-{os_name}-{fnv1a(lockfile)}'


# 3. Test sharding: put the slowest test first on the least loaded shard (greedy), using the timings of earlier runs.
seed = 99


def rand(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


def shard(tests, k):
    loads = [0] * k
    for t in sorted(tests, key=lambda t: (-t['secs'], t['name'])):
        loads[loads.index(min(loads))] += t['secs']
    return loads


# 4. Scheduling: all jobs wait at time 0 and each takes 3 minutes. First come first served, or the team with the fewest running jobs goes next.
def schedule(jobs, runners, fair):
    free = [0] * runners
    pending = list(jobs)
    spans = []
    start = {}
    while pending:
        t = min(free)
        r = free.index(t)

        def running(team):
            return sum(1 for s in spans if s['team'] == team and s['start'] <= t < s['end'])

        pick = 0
        if fair:
            for i in range(1, len(pending)):
                if running(pending[i]['team']) < running(pending[pick]['team']):
                    pick = i
        job = pending.pop(pick)
        spans.append({'team': job['team'], 'start': t, 'end': t + 3})
        start[job['id']] = t
        free[r] = t + 3
    return start


lay = layers(PIPELINE)
print('pipeline layers: ' + ' > '.join('+'.join(l) for l in lay))

lock = 'left-pad 1.3.0\nreact 18.2.0\nzod 3.22.4\n'
same = cache_key('linux', lock) == cache_key('linux', 'left-pad 1.3.0\nreact 18.2.0\nzod 3.22.4\n')
changed = cache_key('linux', lock) == cache_key('linux', lock.replace('18.2.0', '18.3.1'))
print(f"cache key {cache_key('linux', lock)}; same lockfile same key: {str(same).lower()}; one version changed, same key: {str(changed).lower()}")

tests = [{'name': f't{i + 1:02d}', 'secs': 10 + rand(170)} for i in range(12)]
total = sum(t['secs'] for t in tests)
longest = max(t['secs'] for t in tests)
loads = shard(tests, 4)
round_robin = [0] * 4
for i, t in enumerate(tests):
    round_robin[i % 4] += t['secs']
print(f"one shard takes {total} s; 4 shards by timing: {', '.join(map(str, loads))} s; 4 shards by name: {', '.join(map(str, round_robin))} s")

jobs = [{'team': 'A', 'id': f'A{i + 1}'} for i in range(8)] + [{'team': 'B', 'id': 'B1'}, {'team': 'B', 'id': 'B2'}]


def wait_b(s):
    return max(s['B1'], s['B2'])


fifo = schedule(jobs, 2, False)
fair = schedule(jobs, 2, True)
print(f'team B waits at most {wait_b(fifo)} min first come first served, and {wait_b(fair)} min with fair share')

ok = (len(lay) == 3 and same and not changed
      and max(loads) * 4 <= total + longest * 3 and sum(loads) == total
      and wait_b(fair) < wait_b(fifo))
if not ok:
    sys.exit(1)
