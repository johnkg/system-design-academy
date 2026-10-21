# A lease manager that issues increasing fencing tokens, and a storage that can reject stale tokens.
# The clock is a plain variable so the pause scenario is deterministic.

now = 0  # seconds, moved by hand
LEASE_TTL = 10  # seconds a lease lasts


class LeaseManager:
    def __init__(self, duration):
        self.duration = duration
        self.holder = None
        self.expires_at = 0
        self.latest_token = 0

    # Grant or renew. Another node's live lease blocks the request. A new owner gets a higher token.
    def acquire(self, who):
        live = self.holder is not None and now < self.expires_at
        if live and self.holder != who:
            return None
        if not live or self.holder != who:
            self.latest_token += 1
        self.holder = who
        self.expires_at = now + self.duration
        return {"token": self.latest_token, "expires_at": self.expires_at}


class Storage:
    def __init__(self, checks_tokens, manager):
        self.checks_tokens = checks_tokens
        self.manager = manager
        self.max_token = 0
        self.content = "(empty)"
        self.accepted = []
        self.corrupted = False

    def write(self, who, token, data):
        if self.checks_tokens and token < self.max_token:
            print(f"t={now} storage REJECTS {data} from {who}: token {token} < {self.max_token}")
            return False
        self.max_token = max(self.max_token, token)
        self.content = data
        self.accepted.append(data)
        # Omniscient check for the demo: was the writer still the newest owner?
        if token != self.manager.latest_token:
            self.corrupted = True
        print(f"t={now} storage accepts {data} from {who} (token {token})")
        return True


def scenario(checks_tokens):
    global now
    now = 0
    manager = LeaseManager(LEASE_TTL)
    storage = Storage(checks_tokens, manager)

    a = manager.acquire("A")
    print(f"t={now} A gets lease: token {a['token']}, expires at t={a['expires_at']}")
    now = 1
    storage.write("A", a["token"], "A1")
    now = 3
    print(f"t={now} A passes its lease check, then a GC pause freezes it until t=18")
    now = 5
    print(f"t={now} B asks for the lease: {'denied, A holds it' if manager.acquire('B') is None else 'granted'}")
    now = LEASE_TTL
    b = manager.acquire("B")
    print(f"t={now} B gets lease: token {b['token']}, expires at t={b['expires_at']}")
    storage.write("B", b["token"], "B1")
    now = 18
    print(f"t={now} A wakes and still believes it holds the lease")
    storage.write("A", a["token"], "A2")  # A's token is still 1
    return storage


def lower(flag):
    return "true" if flag else "false"


print("--- without fencing check ---")
plain = scenario(False)
print(f"file: {plain.content}, accepted: {','.join(plain.accepted)}, corrupted: {lower(plain.corrupted)}")
print("--- with fencing check ---")
fenced = scenario(True)
print(f"file: {fenced.content}, accepted: {','.join(fenced.accepted)}, corrupted: {lower(fenced.corrupted)}")

assert plain.corrupted and plain.content == "A2", "expected a stale write to corrupt the unfenced file"
assert not fenced.corrupted and fenced.content == "B1", "fencing must protect the file"
print("invariants hold")
