# A mini OAuth 2.0 authorization server (authorization code + PKCE S256) and the checks that matter.
# Time is passed in by hand so the demo is deterministic.
import base64
import hashlib
import sys


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def s256(verifier: str) -> str:
    return b64url(hashlib.sha256(verifier.encode("ascii")).digest())


class AuthServer:
    CODE_TTL = 60  # seconds; RFC 6749 recommends a maximum of 10 minutes, shorter is better

    def __init__(self, registered):
        self.registered = registered  # client_id -> the one registered redirect_uri (exact match)
        self.codes = {}
        self.tokens = {}  # access token -> still valid?
        self.n = 0

    def authorize(self, client_id, redirect_uri, challenge, method, now):
        if self.registered.get(client_id) != redirect_uri:
            return False, "invalid_request: redirect_uri is not registered"  # never redirect to it
        if method != "S256" or not challenge:
            return False, "invalid_request: code_challenge with S256 is required"
        self.n += 1
        code = f"code-{self.n}"
        self.codes[code] = {"client": client_id, "redirect": redirect_uri, "challenge": challenge,
                            "exp": now + self.CODE_TTL, "used": False, "token": None}
        return True, code

    def token(self, code, client_id, redirect_uri, verifier, now):
        rec = self.codes.get(code)
        if rec is None:
            return False, "invalid_grant: unknown code"
        if rec["used"]:
            self.tokens[rec["token"]] = False  # replay: revoke what the first redemption produced
            return False, "invalid_grant: code already used, its token is revoked"
        if now > rec["exp"]:
            return False, "invalid_grant: code expired"
        if rec["client"] != client_id or rec["redirect"] != redirect_uri:
            return False, "invalid_grant: client or redirect_uri differs from the authorization request"
        if not verifier or s256(verifier) != rec["challenge"]:
            return False, "invalid_grant: code_verifier does not match code_challenge"
        rec["used"] = True
        rec["token"] = f"at-{code[5:]}"
        self.tokens[rec["token"]] = True
        return True, rec["token"]


failures = 0


def check(label, got, want_ok):
    global failures
    print(f"{label}: {'ok' if got[0] else 'refused'} {got[1]}")
    if got[0] != want_ok:
        failures += 1


def callback_state_ok(expected, received):  # the client's own check against login CSRF
    return expected is not None and expected == received


VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"  # RFC 7636 appendix B
CHALLENGE = s256(VERIFIER)
REDIRECT = "printshop://cb"
print("challenge:", CHALLENGE)
if CHALLENGE != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM":
    failures += 1

server = AuthServer({"printshop": REDIRECT})
ok, code1 = server.authorize("printshop", REDIRECT, CHALLENGE, "S256", 0)
check("legit redeem", server.token(code1, "printshop", REDIRECT, VERIFIER, 5), True)
check("replay of the same code", server.token(code1, "printshop", REDIRECT, VERIFIER, 6), False)
print("first token still valid:", str(server.tokens["at-1"]).lower())

ok, code2 = server.authorize("printshop", REDIRECT, CHALLENGE, "S256", 10)
check("stolen code, no verifier", server.token(code2, "printshop", REDIRECT, "", 11), False)
check("stolen code, guessed verifier", server.token(code2, "printshop", REDIRECT, "x" * len(VERIFIER), 11), False)
check("redeem with other redirect_uri", server.token(code2, "printshop", "https://evil.test/cb", VERIFIER, 12), False)
check("legit client still succeeds", server.token(code2, "printshop", REDIRECT, VERIFIER, 13), True)

check("authorize with forged redirect_uri", server.authorize("printshop", "printshop://cb/../evil", CHALLENGE, "S256", 20), False)
check("authorize without PKCE", server.authorize("printshop", REDIRECT, "", "S256", 20), False)
ok, code3 = server.authorize("printshop", REDIRECT, CHALLENGE, "S256", 30)
check("redeem after 61 s", server.token(code3, "printshop", REDIRECT, VERIFIER, 91), False)

print("state matches:", str(callback_state_ok("k3j9", "k3j9")).lower())
print("state forged:", str(callback_state_ok("k3j9", "attacker")).lower())
print("state missing from session:", str(callback_state_ok(None, "attacker")).lower())
if failures or server.tokens["at-1"] or not callback_state_ok("k3j9", "k3j9") or callback_state_ok("k3j9", "attacker"):
    sys.exit(1)
