# Live comments and reactions, in Python:
# edge nodes count reactions and keep only their best few comments each second, and a root merges the small summaries.
import sys

EDGES, SECONDS, KEEP, TYPES = 8, 5, 4, 4
FLAG_ONE_IN = 11  # every 11th comment is flagged by moderation
TYPE_SCALE = 10  # reaction mix out of 10: heart 5, laugh 3, clap 1, wow 1
HEART_UPTO = 5
LAUGH_UPTO = 8
CLAP_UPTO = 9
REACTIONS_MIN = 200  # per edge per second: 200..299 reactions, 20..29 comments
REACTIONS_SPREAD = 100
COMMENTS_MIN = 20
COMMENTS_SPREAD = 10
NAMES = ['heart', 'laugh', 'clap', 'wow']

seed = 7


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


def priority(id_):
    """A fixed hash gives every comment the same priority on every node, so sampling needs no coordination."""
    x = ((id_ ^ (id_ >> 16)) * 2246822519) & 0xFFFFFFFF
    x = ((x ^ (x >> 13)) * 3266489917) & 0xFFFFFFFF
    return (x ^ (x >> 16)) & 0xFFFFFFFF


def flagged(id_):
    return id_ % FLAG_ONE_IN == 0  # stands in for the moderation verdict


def by_priority(c):
    return (-c['pri'], c['id'])


class Edge:
    def __init__(self):
        self.counts = [0] * TYPES
        self.best = []
        self.dropped = 0

    def react(self, kind):
        self.counts[kind] += 1

    def comment(self, id_):
        if flagged(id_):  # moderation happens before anything is published
            self.dropped += 1
            return
        self.best.append({'id': id_, 'pri': priority(id_)})
        self.best.sort(key=by_priority)
        del self.best[KEEP:]  # memory stays at KEEP comments, however many arrive


def pick_type():
    r = rnd(TYPE_SCALE)
    return 0 if r < HEART_UPTO else 1 if r < LAUGH_UPTO else 2 if r < CLAP_UPTO else 3


total, truth_total = [0] * TYPES, [0] * TYPES
next_id = events_in = messages_out = accepted = shown_count = 0
ok = True
for s in range(SECONDS):
    edges = [Edge() for _ in range(EDGES)]
    everything = []  # the slow, obvious record of every accepted comment, to check against
    for edge in edges:
        reactions, comments = REACTIONS_MIN + rnd(REACTIONS_SPREAD), COMMENTS_MIN + rnd(COMMENTS_SPREAD)
        for _ in range(reactions):
            t = pick_type()
            edge.react(t)
            truth_total[t] += 1
        for _ in range(comments):
            next_id += 1
            edge.comment(next_id)
            if not flagged(next_id):
                everything.append({'id': next_id, 'pri': priority(next_id)})
        events_in += reactions + comments
    second = [0] * TYPES
    for e in edges:
        for t, c in enumerate(e.counts):
            second[t] += c
            total[t] += c
    shown = sorted((c for e in edges for c in e.best), key=by_priority)[:KEEP]  # merging top lists is exact
    expected = sorted(everything, key=by_priority)[:KEEP]
    accepted += len(everything)
    shown_count += len(shown)
    same = shown == expected
    ok = ok and same
    messages_out += 1  # one message per second to every viewer carries the tally and the sampled comments
    dropped = sum(e.dropped for e in edges)
    print(f"t={s} reactions=[{','.join(map(str, second))}] shown=[{','.join(str(c['id']) for c in shown)}] blocked={dropped} exact={str(same).lower()}")
sum_ok = total == truth_total
print('totals: ' + ' '.join(f'{n}={total[t]}' for t, n in enumerate(NAMES)) + f' match={str(sum_ok).lower()}')
print(f'events in: {events_in}, messages out per viewer: {messages_out}, reduction: {events_in // messages_out}x')
# Every viewer sees only the sampled comments, so the stream a phone must read is small and the same for everyone.
tenths = shown_count * 1000 // accepted
print(f'comments accepted: {accepted}, shown to viewers: {shown_count}, share shown: {tenths // 10}.{tenths % 10}%')
if not ok or not sum_ok:
    sys.exit(1)
