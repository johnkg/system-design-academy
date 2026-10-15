# A tiny identity provider in Python:
# a login session, signed tokens, key rotation, MFA step-up, back-channel logout and one set of keys per tenant.
# The "signature" is FNV-1a over a shared secret so the sample is deterministic; a real IdP signs with an RSA or EC private key.
import sys

TTL = 600  # token lifetime in seconds

def fnv(s):
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h

def hexed(n): return format(n, '08x')

class Idp:
    def __init__(self, tenant):
        self.tenant = tenant
        self.sessions, self.next = {}, 1
        self.keys = [{'kid': 'k1', 'secret': fnv(tenant + '/k1'), 'retired': None}]
    def active(self): return self.keys[-1]
    def rotate(self, now):
        self.active()['retired'] = now
        kid = 'k' + str(len(self.keys) + 1)
        self.keys.append({'kid': kid, 'secret': fnv(self.tenant + '/' + kid), 'retired': None})
    # The published key set: the active key, plus a retired key until every token it signed has expired.
    def jwks(self, now):
        return {k['kid']: k['secret'] for k in self.keys if k['retired'] is None or now < k['retired'] + TTL}
    def login(self, sub, now, mfa):
        sid = f'{self.tenant}-s{self.next}'
        self.next += 1
        self.sessions[sid] = {'sub': sub, 'acr': 2 if mfa else 1, 'auth_time': now, 'rps': []}
        return sid
    def step_up(self, sid, now):
        self.sessions[sid].update(acr=2, auth_time=now)
    def issue(self, sid, aud, now):
        s = self.sessions.get(sid)
        if s is None:
            return None
        if aud not in s['rps']:
            s['rps'].append(aud)  # remember which apps to notify at logout
        k = self.active()
        body = '|'.join([k['kid'], s['sub'], aud, sid, str(s['acr']), str(s['auth_time']), str(now + TTL)])
        return f"{body}|{hexed(fnv(str(k['secret']) + '|' + body))}"
    def logout(self, sid, rps):
        s = self.sessions.pop(sid)
        for a in s['rps']:
            rps[a].revoke(sid)
        return len(s['rps'])

class Rp:  # a relying party: an application that trusts one IdP
    def __init__(self, aud, idp):
        self.aud, self.idp, self.revoked = aud, idp, set()
    def revoke(self, sid): self.revoked.add(sid)  # the back-channel logout endpoint
    def check(self, token, now, min_acr=1, max_age=1000000):
        f = token.split('|')
        secret = self.idp.jwks(now).get(f[0])  # a real RP caches the key set and refetches on an unknown kid
        if secret is None:
            return 'unknown_kid'
        if hexed(fnv(str(secret) + '|' + '|'.join(f[:7]))) != f[7]:
            return 'bad_signature'
        if f[2] != self.aud:
            return 'wrong_audience'
        if now >= int(f[6]):
            return 'expired'
        if f[3] in self.revoked:
            return 'revoked'
        if int(f[4]) < min_acr or now - int(f[5]) > max_age:
            return 'step_up_required'
        return 'ok'


fails = []
def expect(label, got, want):
    print(f'{label}: {got}')
    fails.extend([label] * (got != want))

acme, globex = Idp('acme'), Idp('globex')
mail, wiki = Rp('mail', acme), Rp('wiki', acme)
rps = {'mail': mail, 'wiki': wiki}
sid = acme.login('alice', 0, False)

expect('mail at 100', mail.check(acme.issue(sid, 'mail', 100), 100), 'ok')
expect('admin page at 150 (needs mfa)', wiki.check(acme.issue(sid, 'wiki', 150), 150, 2, 300), 'step_up_required')
acme.step_up(sid, 160)
admin = acme.issue(sid, 'wiki', 160)
expect('admin page at 170 after mfa', wiki.check(admin, 170, 2, 300), 'ok')
expect('admin page at 500 (mfa too old)', wiki.check(admin, 500, 2, 300), 'step_up_required')

old = acme.issue(sid, 'mail', 900)
acme.rotate(1000)
expect('old token after rotation, 1100', mail.check(old, 1100), 'ok')
fresh = acme.issue(sid, 'mail', 1100)
print(f"signing keys: {','.join(acme.jwks(1100))} at 1100, {','.join(acme.jwks(1600))} at 1600")
expect('old token at 1600', mail.check(old, 1600), 'unknown_kid')
expect('new token at 1200', mail.check(fresh, 1200), 'ok')

forged = fresh.split('|')
forged[4] = '3'
expect('token with acr edited', mail.check('|'.join(forged), 1200), 'bad_signature')
expect('globex token at acme mail', mail.check(globex.issue(globex.login('bob', 0, True), 'mail', 1300), 1300), 'bad_signature')

live = acme.issue(sid, 'wiki', 1250)
print(f'logout notified {acme.logout(sid, rps)} apps')
expect('mail token after logout', mail.check(fresh, 1301), 'revoked')
expect('wiki token after logout', wiki.check(live, 1301), 'revoked')
expect('new token after logout', str(acme.issue(sid, 'mail', 1302)).replace('None', 'null'), 'null')
if fails:
    sys.exit(1)
