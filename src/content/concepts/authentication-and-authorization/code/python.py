# Signed tokens in Python: create, verify the signature and expiry, then authorize.
# A fixed secret and clock make the demo deterministic. Real systems use a vetted library and managed keys.
import base64
import hashlib
import hmac
import json

SECRET = b"demo-secret-do-not-use-in-production"
NOW = 1000  # the demo clock, in seconds
EXPIRES_AT = 2000  # when the demo tokens expire
AFTER_EXPIRY = 2500


def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).rstrip(b"=").decode()


def sign(data: str) -> str:
    digest = hmac.new(SECRET, data.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def create_token(user: str, role: str, expires_at: int) -> str:
    header = b64('{"alg":"HS256","typ":"JWT"}')
    payload = b64(f'{{"sub":"{user}","role":"{role}","exp":{expires_at}}}')
    return f"{header}.{payload}.{sign(f'{header}.{payload}')}"


# Authentication: is this token genuine and still valid? Returns the claims, or raises.
def authenticate(token: str, now: int) -> dict:
    header, payload, signature = (token.split(".") + ["", ""])[:3]
    expected = sign(f"{header}.{payload}").encode()
    given = signature.encode()
    if not hmac.compare_digest(expected, given):  # constant-time comparison
        raise PermissionError("401 invalid signature")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    if claims["exp"] <= now:
        raise PermissionError("401 token expired")
    return claims


# Authorization: may this known caller do this?
def authorize(claims: dict, action: str, owner_of_resource: str | None) -> str:
    if action == "list-users" and claims["role"] != "admin":
        raise PermissionError("403 admins only")
    if action == "read-order" and claims["role"] != "admin" and claims["sub"] != owner_of_resource:
        raise PermissionError("403 not your order")
    return "200 ok"


def call(label: str, token: str, action: str, owner: str | None = None, now: int = NOW) -> None:
    try:
        claims = authenticate(token, now)
        print(f"{label}: {authorize(claims, action, owner)} ({claims['sub']})")
    except PermissionError as e:
        print(f"{label}: {e}")


alice = create_token("alice", "customer", EXPIRES_AT)
bob = create_token("bob", "admin", EXPIRES_AT)

call("alice reads her order   ", alice, "read-order", "alice")
call("alice reads bob's order ", alice, "read-order", "bob")
call("alice lists all users   ", alice, "list-users")
call("bob lists all users     ", bob, "list-users")
call("alice, after expiry     ", alice, "read-order", "alice", AFTER_EXPIRY)

# Alice edits her own token to say she is an admin, but she cannot re-sign it
h, _, s = alice.split(".")
forged = f'{h}.{b64('{"sub":"alice","role":"admin","exp":2000}')}.{s}'
call("alice with a forged role", forged, "list-users")
