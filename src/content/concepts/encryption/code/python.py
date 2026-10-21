# Authenticated encryption (AES-256-GCM) in Python, with tamper detection.
# The key and nonce are fixed so the output is deterministic. Real code uses a random key from a key service
# and a NEW random nonce for every message: reusing a nonce with the same key breaks the security.
# The Python standard library has no AES, so a small teaching implementation is included below.
# Real code uses a vetted library (for example "cryptography"), never hand-written ciphers.
import hmac

# ---- AES-256 block encryption (teaching version) ----
def _build_sbox():
    sbox, p, q = [0] * 256, 1, 1
    while True:
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)  # multiply p by 3
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xFF       # divide q by 3
        if q & 0x80:
            q ^= 0x09
        rot = lambda x, n: ((x << n) | (x >> (8 - n))) & 0xFF
        sbox[p] = q ^ rot(q, 1) ^ rot(q, 2) ^ rot(q, 3) ^ rot(q, 4) ^ 0x63
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox

SBOX = _build_sbox()
xtime = lambda a: ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1


def expand_key(key):  # 32-byte key -> 15 round keys (as 16-byte lists)
    words = [list(key[i:i + 4]) for i in range(0, 32, 4)]
    rcon = 1
    for i in range(8, 60):
        w = list(words[i - 1])
        if i % 8 == 0:
            w = [SBOX[b] for b in w[1:] + w[:1]]
            w[0] ^= rcon
            rcon = xtime(rcon)
        elif i % 8 == 4:
            w = [SBOX[b] for b in w]
        words.append([a ^ b for a, b in zip(words[i - 8], w)])
    return [sum(words[r * 4:r * 4 + 4], []) for r in range(15)]


def encrypt_block(round_keys, block):
    s = [b ^ k for b, k in zip(block, round_keys[0])]
    for r in range(1, 15):
        s = [SBOX[b] for b in s]
        s = [s[(i + 4 * (i % 4)) % 16] for i in range(16)]  # ShiftRows
        if r < 14:  # MixColumns
            mixed = []
            for c in range(0, 16, 4):
                a = s[c:c + 4]
                t = a[0] ^ a[1] ^ a[2] ^ a[3]
                mixed += [a[i] ^ t ^ xtime(a[i] ^ a[(i + 1) % 4]) for i in range(4)]
            s = mixed
        s = [b ^ k for b, k in zip(s, round_keys[r])]
    return bytes(s)


# ---- GCM mode: counter-mode encryption plus a GHASH authentication tag ----
def gf_multiply(x, y):  # multiplication in GF(2^128), bit-reflected as GCM defines it
    z, v = 0, y
    for i in range(128):
        if (x >> (127 - i)) & 1:
            z ^= v
        v = (v >> 1) ^ (0xE1 << 120) if v & 1 else v >> 1
    return z


def ghash(h, data):
    y = 0
    for i in range(0, len(data), 16):
        y = gf_multiply(y ^ int.from_bytes(data[i:i + 16], "big"), h)
    return y


def pad16(data):
    return data + bytes(-len(data) % 16)


def gcm_crypt(key, nonce, data):  # returns (output, tag-mask, hash key); counter mode is symmetric
    round_keys = expand_key(key)
    h = int.from_bytes(encrypt_block(round_keys, bytes(16)), "big")
    mask = encrypt_block(round_keys, nonce + (1).to_bytes(4, "big"))
    out = bytearray()
    for i in range(0, len(data), 16):
        stream = encrypt_block(round_keys, nonce + (2 + i // 16).to_bytes(4, "big"))
        out += bytes(a ^ b for a, b in zip(data[i:i + 16], stream))
    return bytes(out), mask, h


def make_tag(h, mask, ciphertext):
    lengths = (0).to_bytes(8, "big") + (len(ciphertext) * 8).to_bytes(8, "big")  # no associated data
    digest = ghash(h, pad16(ciphertext) + lengths).to_bytes(16, "big")
    return bytes(a ^ b for a, b in zip(digest, mask))


KEY_BYTES = 32  # 256-bit key
NONCE_BYTES = 12  # 96-bit nonce, the size GCM is designed for

key = bytes(range(KEY_BYTES))
nonce = bytes(100 + i for i in range(NONCE_BYTES))


def encrypt(plaintext):
    ciphertext, mask, h = gcm_crypt(key, nonce, plaintext.encode())
    return ciphertext, make_tag(h, mask, ciphertext)  # the tag proves the data was not changed


def decrypt(sealed):
    ciphertext, tag = sealed
    plaintext, mask, h = gcm_crypt(key, nonce, ciphertext)
    if not hmac.compare_digest(make_tag(h, mask, ciphertext), tag):
        raise ValueError("authentication failed")  # raised if tampered
    return plaintext.decode()


sealed = encrypt("meet at noon")
print(f"ciphertext: {sealed[0].hex()}")
print(f"tag:        {sealed[1].hex()}")
print(f"decrypted:  {decrypt(sealed)}")

tampered = bytearray(sealed[0])
tampered[0] ^= 1  # an attacker flips one bit
try:
    decrypt((bytes(tampered), sealed[1]))
except ValueError:
    print("tampered:   authentication failed, data rejected")
