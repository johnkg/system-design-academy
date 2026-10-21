# A developer API platform core: hashed API keys with scopes, plan quotas, version pinning and a breaking-change check.
import json
import sys


def fnv(s):  # stands in for SHA-256
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


PLANS = {'free': 5, 'pro': 8}  # calls per month
WARN_PCT = 80  # warn when this share of the quota is used
EXTRA_CALLS = 5  # enough calls to exhaust the free quota
NEED = {'GET /payments': 'payments:read', 'POST /payments': 'payments:write', 'GET /refunds': 'refunds:read'}
store = {}  # hash of the key -> record. The key itself is never stored.


def issue_key(name, plan, scopes, version):
    secret = 'sk_' + format(fnv(name + ':a'), '08x') + format(fnv(name + ':b'), '08x')
    store[fnv(secret)] = {'name': name, 'plan': plan, 'scopes': scopes, 'version': version, 'used': 0}
    return secret  # shown to the developer once


def handle(secret, route):
    rec = store.get(fnv(secret))
    if rec is None:
        return '401 unknown key'
    need = NEED[route]
    if need not in rec['scopes']:
        return f'403 needs {need}'
    limit = PLANS[rec['plan']]
    if rec['used'] >= limit:
        return '429 monthly quota used'
    rec['used'] += 1
    warn = ' (80% of quota used)' if rec['used'] * 100 >= limit * WARN_PCT else ''
    return f"200 ok, version {rec['version']}{warn}"


# A spec is a flat map: "METHOD /path req|res name" -> type (requests also say optional or required).
def diff(old_spec, new_spec):
    out = []
    for key in sorted(set(old_spec) | set(new_spec)):
        o, n, kind = old_spec.get(key), new_spec.get(key), key.split(' ')[2]
        if o is None:
            verb, breaking = 'added', kind == 'req' and n.endswith('|required')
        elif n is None:
            verb, breaking = 'removed', True
        elif o != n:
            verb = f'changed {o} -> {n}'
            breaking = o.split('|')[0] != n.split('|')[0] or (o.endswith('|optional') and n.endswith('|required'))
        else:
            continue
        out.append({'key': key, 'verb': verb, 'breaking': breaking})
    return out


v1 = {
    'GET /payments req limit': 'int|optional', 'GET /payments res id': 'string', 'GET /payments res amount': 'int', 'GET /payments res status': 'string',
    'POST /payments req amount': 'int|required', 'POST /payments req currency': 'string|required', 'POST /payments res id': 'string', 'GET /refunds res id': 'string',
}
v2 = {
    'GET /payments req limit': 'int|optional', 'GET /payments req cursor': 'string|optional', 'GET /payments res id': 'string', 'GET /payments res amount': 'string',
    'GET /payments res created': 'string', 'POST /payments req amount': 'int|required', 'POST /payments req currency': 'string|required',
    'POST /payments req idempotency_key': 'string|required', 'POST /payments req note': 'string|optional', 'POST /payments res id': 'string',
}

web = issue_key('acme-web', 'free', ['payments:read'], '2025-03-01')
admin = issue_key('acme-admin', 'pro', ['payments:read', 'payments:write'], '2026-01-15')
print(f'web key {web[:7]}..., admin key {admin[:7]}...')
calls = [(web, 'GET /payments'), (web, 'POST /payments'), (web, 'GET /refunds'), ('sk_bad', 'GET /payments'), (admin, 'POST /payments')]
calls += [(web, 'GET /payments')] * EXTRA_CALLS
for key, route in calls:
    who = 'web  ' if key == web else 'admin' if key == admin else 'other'
    print(f'{who} {route.ljust(14)} -> {handle(key, route)}')

changes = diff(v1, v2)
for c in changes:
    print(f"{'BREAKING' if c['breaking'] else 'safe    '} {c['key']}: {c['verb']}")
breaking = sum(1 for c in changes if c['breaking'])
print(f"{breaking} breaking, {len(changes) - breaking} safe: release {'blocked, ship it as a new version' if breaking > 0 else 'allowed'}")

plaintext = any(web in json.dumps(r) or admin in json.dumps(r) for r in store.values())
if plaintext or breaking != 4 or len(changes) != 7 or handle(web, 'GET /payments') != '429 monthly quota used':
    sys.exit(1)
