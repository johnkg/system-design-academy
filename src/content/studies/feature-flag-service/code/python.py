# A feature flag SDK in Python: it evaluates from a cached ruleset with no network call,
# buckets users with a hash of the flag's salt and the user id, and keeps its last ruleset when the service is down.
import sys


# A 32-bit hash (FNV-1a followed by a final mix) of text, so the same user and flag always give the same number.
def hash_text(text):
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    h ^= h >> 16
    h = (h * 2246822507) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 3266489909) & 0xFFFFFFFF
    h ^= h >> 16
    return h


def bucket(salt, user_id):
    return hash_text(f"{salt}:{user_id}") % 10000  # 0..9999, in hundredths of a percent


# The order is: kill switch, then targeting rules, then the percentage rollout. A flag that does not exist is off.
def evaluate(ruleset, key, user):
    flag = ruleset['flags'].get(key) if ruleset else None
    if flag is None or flag['killed']:
        return False
    for rule in flag['rules']:
        if user.get(rule['attr']) == rule['equals']:
            return rule['value']
    return bucket(flag['salt'], user['id']) < flag['rollout_bp']


class Sdk:
    def __init__(self):
        self.ruleset = None

    # A poll or a pushed message. A failed fetch (None) and an older version are both ignored, so the last good ruleset stays.
    def apply(self, nxt):
        if nxt is not None and (self.ruleset is None or nxt['version'] > self.ruleset['version']):
            self.ruleset = nxt

    def is_on(self, key, user):
        return evaluate(self.ruleset, key, user)


def make_ruleset(version, rollout_bp, salt, killed):
    return {'version': version, 'flags': {'new-checkout': {
        'salt': salt, 'killed': killed, 'rollout_bp': rollout_bp,
        'rules': [{'attr': 'plan', 'equals': 'internal', 'value': True}]}}}


users = [{'id': f"user-{i}", 'plan': 'internal' if i % 100 == 0 else 'free'} for i in range(20000)]


def count(sdk, key):
    return sum(1 for u in users if sdk.is_on(key, u))


sdk = Sdk()
print(f"no ruleset yet, fail closed: {count(sdk, 'new-checkout')} users on")
sdk.apply(make_ruleset(1, 1000, 'nc-7f3a', False))
at10 = [u for u in users if sdk.is_on('new-checkout', u)]
print(f"10% rollout: {len(at10)} users on")
sdk.apply(make_ruleset(2, 3000, 'nc-7f3a', False))
at30 = [u for u in users if sdk.is_on('new-checkout', u)]
kept = sum(1 for u in at10 if sdk.is_on('new-checkout', u))
print(f"30% rollout: {len(at30)} users on, {kept} of the first {len(at10)} kept it")

resalted = Sdk()
resalted.apply(make_ruleset(3, 3000, 'nc-new-salt', False))
lost = sum(1 for u in at10 if not resalted.is_on('new-checkout', u))
print(f"same 30% with a new salt: {lost} of the first {len(at10)} lose it")

other = sum(1 for u in users if bucket('other-flag', u['id']) < 3000)
both = sum(1 for u in users if bucket('other-flag', u['id']) < 3000 and bucket('nc-7f3a', u['id']) < 3000)
print(f"two flags at 30% with different salts: {both} of {other} share users")

sdk.apply(None)                                    # the service is down: the last ruleset stays
sdk.apply(make_ruleset(1, 9000, 'nc-7f3a', False))  # an old version arrives late: ignored
print(f"service down, old copy kept: version {sdk.ruleset['version']}, {count(sdk, 'new-checkout')} users on")
sdk.apply(make_ruleset(4, 3000, 'nc-7f3a', True))
print(f"kill switch: {count(sdk, 'new-checkout')} users on")

monotone = kept == len(at10) and len(at30) > len(at10)
killed = count(sdk, 'new-checkout') == 0
if not monotone or not killed or lost == 0 or len(at10) < 1500:
    sys.exit(1)
