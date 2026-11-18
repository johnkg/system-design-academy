# Tokenization and audit scope: which of your systems ever see a card number, and what a token is.
# A fixed list of 8 components, three ways to take a card, and a toy token vault. Only integers and fixed text are printed.
COMPONENTS = ["Checkout page", "Web server", "App API", "Payment service", "Database", "Log pipeline", "Backups", "Analytics warehouse"]


def analyze(design, o):
    """design: 'form' (your page has the card form and posts the number to your server), 'hosted' (your page embeds fields
    served by the provider; the number goes from the browser to the provider), 'redirect' (the customer pays on the
    provider's own page). o: store, logBodies, backups, warehouse."""
    in_scope = [False] * len(COMPONENTS)
    at_rest = []
    if design == "form":
        for i in range(4):  # the number is typed into, sent through and processed by these
            in_scope[i] = True
        if o.get("store"):
            in_scope[4] = True
            at_rest.append(COMPONENTS[4])
        if o.get("logBodies"):
            in_scope[5] = True
            at_rest.append(COMPONENTS[5])
        if o.get("store") and o.get("backups"):
            in_scope[6] = True
            at_rest.append(COMPONENTS[6])
        if o.get("store") and o.get("warehouse"):
            in_scope[7] = True
            at_rest.append(COMPONENTS[7])
    elif design == "hosted":
        in_scope[0] = True  # your page serves the code around the provider's fields, so it can still affect them
    count = sum(in_scope)
    server_side = any(in_scope[1:])
    audit = "heavy" if server_side else ("light" if count > 0 else "lightest")
    return in_scope, count, at_rest, audit


def luhn_valid(digits):
    """Luhn check: catches a mistyped number before it is sent anywhere."""
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = ord(ch) - 48
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def mask(pan):
    return pan[:6] + "*" * (len(pan) - 10) + pan[-4:]


class Vault:
    """A toy vault: the token comes from a counter-like generator, so it has no mathematical link to the number."""

    def __init__(self, seed):
        self.state = seed
        self.map = {}

    def tokenize(self, pan):
        self.state = (self.state * 48271) % 2147483647
        token = "tok_" + str(self.state).zfill(10)
        self.map[token] = pan
        return token

    def detokenize(self, token):
        return self.map.get(token)


print("-- card number checks")
pan = "4111111111111111"  # a well-known test number
print(f"{mask(pan)} has {len(pan)} digits, last 4 {pan[-4:]}, Luhn valid {1 if luhn_valid(pan) else 0}")
print(f"one digit changed: Luhn valid {1 if luhn_valid('4111111111111112') else 0}")

print("-- token vault")
provider_vault, other_vault = Vault(987654), Vault(7)
t1 = provider_vault.tokenize(pan)
t2 = provider_vault.tokenize(pan)
print(f"two tokens for the same card: {t1} and {t2}, equal {1 if t1 == t2 else 0}")
print(f"provider resolves {t1}: {'the card' if provider_vault.detokenize(t1) == pan else 'nothing'}")
print(f"another merchant's vault resolves {t1}: {'nothing' if other_vault.detokenize(t1) is None else 'the card'}")
print(f"your database holds: token {t1}, last4 {pan[-4:]}, expiry 12/2030 (no number)")

print("-- scope for 8 components")
cases = [
    ("form, nothing stored or logged", "form", {}),
    ("form, number stored", "form", {"store": True}),
    ("form, number stored and request bodies logged", "form", {"store": True, "logBodies": True}),
    ("form, stored, logged, backed up, copied to analytics", "form", {"store": True, "logBodies": True, "backups": True, "warehouse": True}),
    ("hosted fields, token stored, bodies logged, backed up", "hosted", {"store": True, "logBodies": True, "backups": True, "warehouse": True}),
    ("redirect, token stored, bodies logged, backed up", "redirect", {"store": True, "logBodies": True, "backups": True, "warehouse": True}),
]
for label, design, o in cases:
    in_scope, count, at_rest, audit = analyze(design, o)
    names = ", ".join(c for c, s in zip(COMPONENTS, in_scope) if s) or "none"
    rest = ", ".join(at_rest) if at_rest else "none"
    print(f"{label}: {count} of {len(COMPONENTS)} in scope ({names}); numbers at rest in {rest}; audit {audit}")
