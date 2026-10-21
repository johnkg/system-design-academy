# Minimal JWT (HS256) sign and verify using only the standard library.
# Verification pins the algorithm, checks the signature in constant time, then checks exp, iss and aud.
import base64
import hashlib
import hmac
import json
import sys


def b64(data):
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def mac(secret, data):
    return hmac.new(secret.encode(), data.encode(), hashlib.sha256).digest()


def sign(claims, secret, header='{"alg":"HS256","typ":"JWT"}'):
    payload = '{"iss":"%s","sub":"%s","aud":"%s","exp":%d}' % (claims["iss"], claims["sub"], claims["aud"], claims["exp"])
    inp = b64(header) + "." + b64(payload)
    return inp + "." + b64(mac(secret, inp))


def verify(token, secret, expect):
    parts = token.split(".")
    if len(parts) != 3:
        return "reject: malformed"
    try:
        header = json.loads(unb64(parts[0]))
    except ValueError:
        return "reject: malformed"
    if header.get("alg") != "HS256":  # pin it, never trust the header (blocks none)
        return "reject: alg is not HS256"
    want = mac(secret, parts[0] + "." + parts[1])
    got = unb64(parts[2])
    if not hmac.compare_digest(got, want):
        return "reject: bad signature"
    try:
        claims = json.loads(unb64(parts[1]))
    except ValueError:
        return "reject: malformed"
    if claims["exp"] <= expect["now"]:
        return "reject: expired"
    if claims["iss"] != expect["iss"]:
        return "reject: wrong issuer"
    if claims["aud"] != expect["aud"]:
        return "reject: wrong audience"
    return "ok"


SECRET = "demo-secret-at-least-32-bytes-long!"
NOW = 1000
TOKEN_TTL_S = 300  # access tokens live 5 minutes
expect = {"now": NOW, "iss": "auth.shop", "aud": "orders-api"}
good = {"iss": "auth.shop", "sub": "alice", "aud": "orders-api", "exp": NOW + TOKEN_TTL_S}

token = sign(good, SECRET)
print("token: " + token[:36] + "...")

h, p, s = token.split(".")
tampered_payload = b64('{"iss":"auth.shop","sub":"admin","aud":"orders-api","exp":1300}')
cases = [
    ("valid token", token, "ok"),
    ("alg=none, empty signature", b64('{"alg":"none","typ":"JWT"}') + "." + p + ".", "reject: alg is not HS256"),
    ("tampered payload (sub=admin)", h + "." + tampered_payload + "." + s, "reject: bad signature"),
    ("signed with another key", sign(good, "some-other-secret-of-32-bytes-xxxx"), "reject: bad signature"),
    ("expired", sign({**good, "exp": NOW - 1}, SECRET), "reject: expired"),
    ("wrong audience", sign({**good, "aud": "billing-api"}, SECRET), "reject: wrong audience"),
    ("wrong issuer", sign({**good, "iss": "evil.example"}, SECRET), "reject: wrong issuer"),
    ("two parts only", h + "." + p, "reject: malformed"),
]

failed = 0
for name, tok, want in cases:
    got = verify(tok, SECRET, expect)
    okay = got == want
    if not okay:
        failed += 1
    print("%-30s -> %s%s" % (name, got, "" if okay else " (EXPECTED " + want + ")"))
if failed:
    print("%d case(s) wrong" % failed)
    sys.exit(1)
print("all %d cases behave as expected" % len(cases))
