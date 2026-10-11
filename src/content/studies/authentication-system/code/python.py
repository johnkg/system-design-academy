# The core of a login service, in Python (standard library only):
# a slow salted password hash, a one-time code (TOTP, RFC 6238), and refresh tokens that rotate and detect theft.
import hashlib
import hmac
import struct
import sys


def sha256(s):
    return hashlib.sha256(s.encode()).hexdigest()


# 1. Slow salted hash. Every user has their own salt, and the iteration count is the price an attacker pays per guess.
ITERATIONS = 20000


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), ITERATIONS, 32).hex()


def verify_password(password, salt, stored):
    return hmac.compare_digest(hash_password(password, salt), stored)


# 2. TOTP: HMAC of the number of 30-second steps since 1970, cut down to a few digits (dynamic truncation).
def totp(secret, seconds, digits):
    mac = hmac.new(secret, struct.pack('>Q', seconds // 30), hashlib.sha1).digest()
    offset = mac[19] & 15
    code = (struct.unpack('>I', mac[offset:offset + 4])[0] & 0x7FFFFFFF) % 10 ** digits
    return str(code).zfill(digits)


# Accept the previous, current and next step, because phone clocks drift.
def verify_totp(secret, seconds, given):
    return any(totp(secret, seconds + d, 6) == given for d in (-30, 0, 30))


# 3. Refresh tokens rotate: each one is used once and replaced. Using an old one means a copy was stolen, so the whole family dies.
class TokenService:
    def __init__(self, key):
        self.key = key
        self.counter = 0
        self.by_hash = {}
        self.families = {}

    def mint(self, family):  # the server stores only the hash of a token, like a password
        self.counter += 1
        token = sha256(f'{self.key}:{self.counter}')[:12]
        self.by_hash[sha256(token)] = {'family': family, 'used': False}
        return token

    def login(self, user):
        self.families[user] = 'alive'
        return self.mint(user)

    def refresh(self, token):
        rec = self.by_hash.get(sha256(token))
        if rec is None:
            return {'ok': False, 'why': 'unknown'}
        if self.families.get(rec['family']) != 'alive':
            return {'ok': False, 'why': 'family revoked'}
        if rec['used']:
            self.families[rec['family']] = 'revoked'
            return {'ok': False, 'why': 'reuse detected, family revoked'}
        rec['used'] = True
        return {'ok': True, 'token': self.mint(rec['family'])}


def lower(b):
    return 'true' if b else 'false'


salt = 'a1b2c3d4e5f60718'
stored = hash_password('correct horse battery', salt)
print(f'hash: {stored[:16]}')
print(f"right password: {lower(verify_password('correct horse battery', salt, stored))}, wrong password: {lower(verify_password('correct horse batterz', salt, stored))}")
print(f"same password, another salt gives another hash: {lower(hash_password('correct horse battery', 'ffffffffffffffff') != stored)}")

secret = b'12345678901234567890'
print(f'totp rfc vectors: {totp(secret, 59, 8)} {totp(secret, 1111111109, 8)} {totp(secret, 1234567890, 8)}')
now = 1700000010
code = totp(secret, now, 6)
print(f'code {code}: now {lower(verify_totp(secret, now, code))}, 30s late {lower(verify_totp(secret, now + 30, code))}, 90s late {lower(verify_totp(secret, now + 90, code))}')

svc = TokenService('server-key')
r1 = svc.login('ann')
r2 = svc.refresh(r1)['token']
r3 = svc.refresh(r2)['token']
replay = svc.refresh(r1)
after = svc.refresh(r3)
print(f"replay of r1: {replay['why']}; newest token afterwards: {after['why']}")
other = svc.refresh(svc.login('bob'))
print(f"another user is unaffected: {lower(other['ok'])}")

if totp(secret, 59, 8) != '94287082' or totp(secret, 1111111109, 8) != '07081804' or totp(secret, 1234567890, 8) != '89005924':
    sys.exit(1)
if replay['ok'] or after['ok'] or not other['ok'] or verify_password('correct horse batterz', salt, stored):
    sys.exit(1)
