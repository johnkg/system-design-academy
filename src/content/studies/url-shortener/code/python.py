# Generating short codes in Python: a counter, scrambled so it is not guessable, encoded in base62.

ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
LENGTH = 7
SPACE = 62 ** LENGTH  # 3,521,614,606,208 distinct 7-character codes
MULTIPLIER = 1442695040888963407  # odd and not a multiple of 31, so it shares no factor with 62^7


def encode(number):
    code = ""
    while number > 0:
        code = ALPHABET[number % 62] + code
        number //= 62
    return code.rjust(LENGTH, "0")


def decode(code):
    n = 0
    for ch in code:
        n = n * 62 + ALPHABET.index(ch)
    return n


# Multiplying by a number that shares no factor with SPACE maps every id to a different value,
# so codes stay unique but consecutive ids no longer look consecutive.
def scramble(id):
    return (id * MULTIPLIER) % SPACE


def short_code(id):
    return encode(scramble(id))


print(f"plain base62 of 125:   {encode(125)}")
print(f"round trip of 125:     {decode(encode(125))}")
for id in [1, 2, 3]:
    print(f"id {id} becomes code:   {short_code(id)}")

codes = set()
for id in range(1, 100001):
    codes.add(short_code(id))
print(f"100000 ids gave {len(codes)} distinct codes")
print(f"7 characters allow {SPACE} links")
