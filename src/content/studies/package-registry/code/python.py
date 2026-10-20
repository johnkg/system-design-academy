# A package registry in Python:
# immutable publishes stored by content hash, semver range resolution over a dependency graph, and an integrity check on install.
import hashlib
import sys


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def parse(v):
    return [int(x) for x in v.split('.')]


def cmp(a, b):
    for i in range(3):
        if a[i] != b[i]:
            return -1 if a[i] < b[i] else 1
    return 0


# Turn a range such as "^1.2.0", "~1.4.0" or ">=1.1.0 <2.0.0" into a list of (operator, version) tests that must all pass.
def comparators(range_):
    tests = []
    for tok in [t for t in range_.split(' ') if t]:
        if tok == '*':
            continue
        if tok[0] == '^':  # compatible: the left-most non-zero number may not change
            v = parse(tok[1:])
            hi = [v[0] + 1, 0, 0] if v[0] > 0 else [0, v[1] + 1, 0] if v[1] > 0 else [0, 0, v[2] + 1]
            tests += [('>=', v), ('<', hi)]
        elif tok[0] == '~':  # patch updates only
            v = parse(tok[1:])
            tests += [('>=', v), ('<', [v[0], v[1] + 1, 0])]
        else:
            n = 2 if tok.startswith('>=') or tok.startswith('<=') else 1 if tok[0] in '<>' else 0
            tests.append((tok[:n] if n else '=', parse(tok[n:])))
    return tests


def satisfies(version, range_):
    v = parse(version)
    for op, w in comparators(range_):
        c = cmp(v, w)
        ok = c >= 0 if op == '>=' else c > 0 if op == '>' else c <= 0 if op == '<=' else c < 0 if op == '<' else c == 0
        if not ok:
            return False
    return True


class Registry:
    def __init__(self):
        self.index = {}  # name -> version -> metadata
        self.blobs = {}  # hash -> tarball

    def publish(self, name, version, deps):
        body = f"{name}@{version}|{','.join(f'{n}:{r}' for n, r in deps)}"  # stands in for the tarball bytes
        integrity = 'sha256-' + sha(body)[:16]
        versions = self.index.setdefault(name, {})
        old = versions.get(version)
        if old:  # a version is immutable: the same bytes are a no-op, different bytes are refused
            if old['integrity'] != integrity:
                raise ValueError(f'{name}@{version} already exists with different content')
            return False
        versions[version] = {'deps': deps, 'integrity': integrity, 'yanked': False}
        self.blobs[integrity] = body
        return True

    def yank(self, name, version):  # hidden from new resolutions, still downloadable
        self.index[name][version]['yanked'] = True

    # Pick the highest allowed version of every package. A lock entry that still fits the range wins, even if it was yanked.
    def resolve(self, root, lock=None):
        lock = lock or {}
        chosen = {}
        queue = [(n, r, 'app') for n, r in root]
        while queue:
            name, range_, origin = queue.pop(0)
            if name in chosen:
                if not satisfies(chosen[name], range_):
                    raise ValueError(f'{origin} needs {name} {range_}, but {name}@{chosen[name]} is already chosen')
                continue
            versions = self.index.get(name)
            if versions is None:
                raise ValueError(f'unknown package {name}')
            pick = lock[name] if name in lock and satisfies(lock[name], range_) else None
            if not pick:
                ok = sorted((v for v, m in versions.items() if not m['yanked'] and satisfies(v, range_)), key=parse)
                pick = ok[-1] if ok else None
            if not pick:
                raise ValueError(f'no version of {name} matches {range_}')
            chosen[name] = pick
            for d, r in versions[pick]['deps']:
                queue.append((d, r, f'{name}@{pick}'))
        return chosen

    # Download each tarball by hash and check that the bytes still hash to the value in the lock.
    def install(self, chosen):
        bad = []
        for name, version in chosen.items():
            integrity = self.index[name][version]['integrity']
            if 'sha256-' + sha(self.blobs[integrity])[:16] != integrity:
                bad.append(f'{name}@{version}')
        return bad


def show(m):
    return ', '.join(f'{n}@{v}' for n, v in sorted(m.items()))


def lower(b):
    return 'true' if b else 'false'


reg = Registry()
releases = [
    ('colorize', '1.0.0', []), ('colorize', '1.1.0', []), ('colorize', '1.1.5', []), ('colorize', '2.0.0', []),
    ('pathx', '1.0.0', []), ('pathx', '1.2.0', []), ('pathx', '1.3.0', []), ('pathx', '2.0.0', []),
    ('tinyutil', '0.3.0', []), ('tinyutil', '0.3.4', []), ('tinyutil', '0.4.0', []),
    ('loglite', '1.4.0', [('colorize', '^1.0.0')]), ('loglite', '1.4.2', [('colorize', '>=1.1.0 <2.0.0')]), ('loglite', '1.5.0', [('colorize', '^1.1.0')]),
    ('webkit', '2.1.0', [('pathx', '^1.2.0'), ('tinyutil', '^0.3.0')]), ('webkit', '2.2.0', [('pathx', '^1.2.0'), ('tinyutil', '^0.3.1')]),
    ('webkit', '3.0.0', [('pathx', '^2.0.0')]),
]
for n, v, d in releases:
    reg.publish(n, v, d)

app = [('webkit', '^2.0.0'), ('loglite', '~1.4.0'), ('pathx', '^1.2.0')]
lock = reg.resolve(app)
print(f'resolved: {show(lock)}')
try:
    reg.resolve([('webkit', '^3.0.0'), ('pathx', '^1.0.0')])
except ValueError as e:
    print(f'conflict: {e}')

reg.yank('webkit', '2.2.0')
print(f'after yank, new install: {show(reg.resolve(app))}')
print(f'after yank, locked install: {show(reg.resolve(app, lock))}')

print(f"webkit@2.1.0 integrity {reg.index['webkit']['2.1.0']['integrity']}")
print(f"republish same bytes: {lower(reg.publish('webkit', '2.1.0', [('pathx', '^1.2.0'), ('tinyutil', '^0.3.0')]))}")
refused = False
try:
    reg.publish('webkit', '2.1.0', [('evil', '*')])
except ValueError as e:
    refused = True
    print(f'republish other bytes: {e}')

clean = len(reg.install(lock))
reg.blobs[reg.index['pathx']['1.3.0']['integrity']] = 'pathx@1.3.0|evil:*'  # someone swaps the stored bytes
bad = reg.install(lock)
print(f"install before tamper: {clean} bad; after tamper: {', '.join(bad)}")
if not refused or clean != 0 or len(bad) != 1 or show(lock) != 'colorize@1.1.5, loglite@1.4.2, pathx@1.3.0, tinyutil@0.3.4, webkit@2.2.0':
    sys.exit(1)
