# Property-Based Testing and Fuzzing: a run-length encoder with a bug that only appears for runs of 10 or more equal characters.
# Look for: hand-written examples all pass; generated inputs find the bug only if the generator can produce long runs;
# a weak property never fails; and shrinking turns a failing input of 13 to 19 characters into the smallest one that still fails.


def encode(s):  # "aaab" -> "3a1b". BUG: a run of 10 or more is written as run % 10, so 10 a's become "0a"
    out, i = '', 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]:
            j += 1
        out += str((j - i) % 10) + s[i]
        i = j
    return out


def decode(e):
    out, i = '', 0
    while i < len(e):
        n = 0
        while '0' <= e[i] <= '9':
            n = n * 10 + (ord(e[i]) - 48)
            i += 1
        out += e[i] * n
        i += 1
    return out


EXAMPLES = ['', 'a', 'aaabcc', 'abab', 'zzzzzzzzz']  # the longest run is 9: the bug is out of sight
PROPERTIES = [
    ('round trip: decode(encode(s)) equals s', lambda s: decode(encode(s)) == s),
    ('weak: encode(s) is not empty when s is not', lambda s: len(s) == 0 or len(encode(s)) > 0),
]
LETTERS = 'abcdefghijklmnopqrstuvwxyz'


def gen_letters(rand):
    s = ''
    for _ in range(rand(21)):
        s += LETTERS[rand(26)]
    return s


def gen_ab(rand):
    s = ''
    for _ in range(rand(21)):
        s += 'ab'[rand(2)]
    return s


def gen_repeats(rand):
    s = ''
    for _ in range(rand(21)):
        s += s[-1] if len(s) > 0 and rand(10) < 8 else 'abc'[rand(3)]
    return s


GENERATORS = [('letters a to z, uniform', gen_letters), ('letters a and b, uniform', gen_ab), ('biased toward repeats', gen_repeats)]


def seeded(seed):  # MINSTD generator: the same integers in every language
    state = [seed]

    def rand(n):
        state[0] = (state[0] * 48271) % 2147483647
        return state[0] % n
    return rand


def shrink(s, prop):  # keep deleting one character while the property still fails
    steps, again = 0, True
    while again:
        again = False
        for i in range(len(s)):
            smaller = s[:i] + s[i + 1:]
            if not prop(smaller):
                s, steps, again = smaller, steps + 1, True
                break
    return s, steps


def search(gen, prop, seed, cases):
    rand = seeded(seed)
    for c in range(1, cases + 1):
        s = gen(rand)
        if not prop(s):
            small, steps = shrink(s, prop)
            return c, len(s), small, steps
    return None


print(f"examples passing: {len([s for s in EXAMPLES if PROPERTIES[0][1](s)])}/{len(EXAMPLES)}")
for pname, prop in PROPERTIES:
    for gname, gen in GENERATORS:
        for seed in (101, 202, 303):
            r = search(gen, prop, seed, 1000)
            if r:
                text = f'failed at case {r[0]} ({r[1]} chars), shrunk to {len(r[2])} chars "{r[2]}" in {r[3]} steps'
            else:
                text = 'no failure in 1000 cases'
            print(f"{pname} | {gname} | seed {seed}: {text}")
first = search(GENERATORS[2][1], PROPERTIES[0][1], 101, 1000)
again = search(GENERATORS[2][1], PROPERTIES[0][1], 101, 1000)
print(f"replay seed 101: same failing case again: {str(first[0] == again[0] and first[2] == again[2]).lower()}")
