# A moderation pipeline in Python: a perceptual-hash lookup, then a three-way triage by classifier score,
# then a review queue that is served most-suspicious first and has limited reviewer capacity.
import sys

seed = 2024


def next_state():
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed


def random(n):
    return (next_state() // 65536) % n  # the high 16 bits are the better ones


def hash32():
    return random(65536) * 65536 + random(65536)


def distance(a, b):
    return bin((a ^ b) & 0xFFFFFFFF).count('1')


HI, LO, MAX_DISTANCE, CAPACITY = 950, 200, 4, 100  # scores are in thousandths

# Build 3,000 uploads. A harmful upload scores high and a harmless one scores low, with an overlap in the middle.
known = []
uploads = []
for id in range(3000):
    harmful = random(100) < 6
    if harmful:
        score = 1000 - (random(1000) * random(1000)) // 1000
    else:
        score = (random(1000) * random(1000) * random(1000)) // 1000000
    h = hash32()
    if harmful and len(known) < 40:
        known.append(h)  # the first harmful uploads become the known-bad list
    elif harmful and random(100) < 40:  # a later harmful upload may be an edited copy of a known one
        h = known[random(len(known))]
        for _ in range(random(4)):
            h = (h ^ (1 << random(32))) & 0xFFFFFFFF  # flip up to 3 bits
    uploads.append({'id': id, 'harmful': harmful, 'score': score, 'hash': h})

fate = {'hash_blocked': [], 'removed': [], 'published': [], 'queued': []}
for u in uploads:
    if any(distance(k, u['hash']) <= MAX_DISTANCE for k in known):
        fate['hash_blocked'].append(u)
    elif u['score'] >= HI:
        fate['removed'].append(u)
    elif u['score'] < LO:
        fate['published'].append(u)
    else:
        fate['queued'].append(u)

# The most suspicious first, and the lower id first when scores are equal. A reviewer is assumed to judge correctly.
fate['queued'].sort(key=lambda u: (-u['score'], u['id']))
reviewed = fate['queued'][:CAPACITY]
overflow = fate['queued'][CAPACITY:]  # published unreviewed after the deadline
review_removed = [u for u in reviewed if u['harmful']]


def count(items):
    return sum(1 for u in items if u['harmful'])


def wrong(items):
    return len(items) - count(items)


missed = count(fate['published']) + count(overflow)
total_harmful = count(uploads)
removed_total = len(fate['hash_blocked']) + len(fate['removed']) + len(review_removed)
removed_right = count(fate['hash_blocked']) + count(fate['removed']) + len(review_removed)

print(f"{total_harmful} harmful uploads out of {len(uploads)}, {len(known)} of them on the known-bad list")
print(f"hash match: {len(fate['hash_blocked'])} blocked, {wrong(fate['hash_blocked'])} by mistake")
print(f"auto-removed: {len(fate['removed'])}, of which {wrong(fate['removed'])} were harmless")
print(f"auto-published: {len(fate['published'])}, of which {count(fate['published'])} were harmful")
print(f"review: {len(fate['queued'])} queued, {len(reviewed)} reviewed (lowest score reviewed {reviewed[-1]['score']}), {len(overflow)} published unreviewed")
print(f"missed harm: {missed}; precision {100 * removed_right // removed_total}%, recall {100 * removed_right // total_harmful}%")

everyone = len(fate['hash_blocked']) + len(fate['removed']) + len(fate['published']) + len(fate['queued'])
ordered = all(u['score'] >= o['score'] for u in reviewed for o in overflow)
if everyone != len(uploads) or not ordered or wrong(reviewed) + count(reviewed) != CAPACITY:
    sys.exit(1)
