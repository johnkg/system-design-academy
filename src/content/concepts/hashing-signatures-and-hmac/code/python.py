# Hash vs MAC vs signature, in a toy model. WARNING: the "hash" below is a 32-bit FNV-1a, a STAND-IN so that every language
# prints the same numbers. It is NOT secure, and neither are the 4-byte tags or the textbook RSA with tiny primes.
# The point is the structure: what each construction lets an attacker do, not the strength of the numbers.


def to_bytes(s):
    return [ord(c) for c in s]


def step(h, bs):
    # The output of this hash is its internal state, with no final step. That is the property length extension needs.
    for b in bs:
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def H(bs):
    return step(2166136261, bs)


def hexs(h):
    return f"{h:08x}"


def yn(b):
    return "yes" if b else "no"


def hmac(key, msg):
    # HMAC: the real construction (an inner and an outer hash, with the key mixed in twice), over the toy hash. Block size 16.
    k = to_bytes(key)
    while len(k) < 16:
        k.append(0)
    inner = H([b ^ 0x36 for b in k] + to_bytes(msg))
    return H([b ^ 0x5C for b in k] + [inner >> 24, (inner >> 16) & 255, (inner >> 8) & 255, inner & 255])


def naive_mac(secret, msg):
    return H(to_bytes(secret + msg))  # hash(secret + message): NOT an HMAC


# Textbook RSA with tiny primes (61 * 53): the public key is (3233, 17), the private exponent is 2753.
N, E, D = 3233, 17, 2753


def modpow(b, e, m):
    r = 1
    b %= m
    while e > 0:
        if e & 1:
            r = (r * b) % m
        b = (b * b) % m
        e >>= 1
    return r


def sign(msg):
    return modpow(H(to_bytes(msg)) % N, D, N)  # needs the private exponent


def verify_sig(msg, sig):
    return modpow(sig, E, N) == H(to_bytes(msg)) % N  # needs only the public key


SECRET, BODY, EDITED = "k3y-s3cret", "id=evt77&order=1001&amount=500", "id=evt77&order=1001&amount=9999"


def ok_hash(body, h):
    return H(to_bytes(body)) == h


def ok_hmac(body, t):
    return hmac(SECRET, body) == t


print("-- 1. a plain hash: integrity against accidents, nothing about who")
print(f"hash(body) = {hexs(H(to_bytes(BODY)))}")
print(f"attacker edits the amount and sends the hash of the edited body: server accepts = {yn(ok_hash(EDITED, H(to_bytes(EDITED))))}")

print("-- 2. HMAC: only a holder of the key can make a tag")
tag = hmac(SECRET, BODY)
print(f"hmac(key, body) = {hexs(tag)}")
print(f"edited body with the old tag: server accepts = {yn(ok_hmac(EDITED, tag))}")
print(f"edited body with a tag made from a guessed key: server accepts = {yn(ok_hmac(EDITED, hmac('guess', EDITED)))}")

print("-- 3. length extension: hash(secret + message) is not an HMAC")
EXTRA = "&amount=9999"
n_tag = naive_mac(SECRET, BODY)
forged_tag = step(n_tag, to_bytes(EXTRA))  # the attacker never sees the secret: they just keep hashing from the tag
print(f'naive tag of the original = {hexs(n_tag)}; forged tag for body + "{EXTRA}" = {hexs(forged_tag)}')
print(f"server recomputes hash(secret + longer body): accepts = {yn(naive_mac(SECRET, BODY + EXTRA) == forged_tag)}")
print(f"same trick on the HMAC tag: accepts = {yn(hmac(SECRET, BODY + EXTRA) == step(tag, to_bytes(EXTRA)))}")

print("-- 4. non-repudiation: who could have made this message?")
mine = "id=evt78&order=1002&amount=1"
print(f"receiver makes its own message with the shared HMAC key: verifies = {yn(ok_hmac(mine, hmac(SECRET, mine)))} (so the tag cannot prove the sender made it)")
sig = sign(BODY)
print(f"signature of the body = {sig}; verifies with the public key = {yn(verify_sig(BODY, sig))}")
print(f"receiver signs its own message without the private exponent (best guess 1234): verifies = {yn(verify_sig(mine, 1234))}")
print(f"edited body with the old signature: verifies = {yn(verify_sig(EDITED, sig))}")

print("-- 5. comparing tags: early exit leaks, constant time does not (comparisons stand in for time)")


def early(a, b):
    n = 0
    for i in range(len(a)):
        n += 1
        if a[i] != b[i]:
            return False, n
    return True, n


def constant(a, b):
    diff = 0
    for i in range(len(a)):
        diff |= a[i] ^ b[i]
    return diff == 0, len(a)


target = [tag >> 24, (tag >> 16) & 255, (tag >> 8) & 255, tag & 255]


def recover(compare):
    known = []
    guesses = 0
    for i in range(4):
        best, best_score, same, first = -1, -1, True, -1
        for v in range(256):
            g = (known + [v, 0, 0, 0])[:4]
            guesses += 1
            ok, n = compare(g, target)
            score = 99 if ok else n
            if first < 0:
                first = score
            if score != first:
                same = False
            if score > best_score:
                best_score, best = score, v
        if same:
            return False, guesses, 0
        known.append(best)
    t = 0
    for b in known:
        t = t * 256 + b
    return True, guesses, t


for name, cmp in [("early exit", early), ("constant time", constant)]:
    done, guesses, t = recover(cmp)
    if done:
        print(f"{name}: tag {hexs(t)} recovered in {guesses} guesses (brute force: 4294967296 possible tags)")
    else:
        print(f"{name}: no signal after {guesses} guesses: every guess costs the same")

print("-- 6. replay: a captured, correctly signed webhook sent again")


def replay_run(label, window, remember, covers):
    # window = seconds a timestamp may be old (0 = not checked), remember = keep the ids already seen, covers = the signature covers the timestamp.
    def signed_text(ts, body):
        return f"{ts}.{body}" if covers else body

    seen = set()
    credited = [0]

    def receive(now, ts, body, s):
        if hmac(SECRET, signed_text(ts, body)) != s:
            return "rejected: bad signature"
        if window > 0 and now - ts > window:
            return "rejected: too old"
        if remember:
            if "evt77" in seen:
                return "rejected: already processed"
            seen.add("evt77")
        credited[0] += 1
        return "accepted"

    s0 = hmac(SECRET, signed_text(1000, BODY))
    out = [f"first delivery {receive(1000, 1000, BODY, s0)}"]
    out.append(f"replay after 10 s {receive(1010, 1000, BODY, s0)}")
    out.append(f"replay after 600 s {receive(1600, 1000, BODY, s0)}")
    out.append(f"replay after 600 s with a fresh timestamp {receive(1600, 1600, BODY, s0)}")
    print(f"{label}: {'; '.join(out)}. Times credited: {credited[0]}.")


replay_run("no checks", 0, False, True)
replay_run("300 s window only", 300, False, True)
replay_run("300 s window and seen ids", 300, True, True)
replay_run("window only, timestamp not signed", 300, False, False)
