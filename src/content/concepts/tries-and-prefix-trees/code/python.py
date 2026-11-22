# Prefix search three ways, counted in character steps (one step = one character compared, or one trie node entered), never in time.
#   scan:   a hash map or list of words has no prefix structure, so every word is checked, character by character
#   sorted: words kept in order, binary search for the first word with the prefix, then read forward
#   trie:   one node per distinct prefix; walk the prefix, then read the subtree below it
# Look for: the trie's cost follows the prefix length and the answer size, not the number of words; its price is nodes.
# A fixed integer generator makes the words, so every language prints the same numbers. Alphabet for the memory model: 26 letters.
SYLLABLES = ['ka', 'ro', 'mi', 'te', 'su', 'no', 'la', 'pe', 'vi', 'do', 'an', 'el', 'or', 'in', 'ta', 'ge']
ALPHABET = 26


def make_words(kind, n):
    x = 12345

    def nxt():
        nonlocal x
        x = (x * 1664525 + 1013904223) % 4294967296
        return x >> 16

    seen = set()
    words = []
    while len(words) < n:
        w = ''
        if kind == 'words':
            parts = 2 + (nxt() % 3)
            for _ in range(parts):
                w += SYLLABLES[nxt() % 16]
        else:
            for _ in range(8):
                w += chr(97 + (nxt() % 26))
        if w not in seen:
            seen.add(w)
            words.append(w)
    return words


def scan_search(words, prefix, limit):
    steps = found = 0
    for w in words:
        i = 0
        while i < len(prefix):
            steps += 1
            if i >= len(w) or w[i] != prefix[i]:
                break
            i += 1
        if i == len(prefix):
            found += 1
            if limit > 0 and found == limit:
                break
    return steps, found


def sorted_search(srt, prefix, limit):
    steps = 0

    def cmp(w):  # compares the first len(prefix) characters of w with the prefix
        nonlocal steps
        for i in range(len(prefix)):
            steps += 1
            if i >= len(w):
                return -1
            if w[i] != prefix[i]:
                return -1 if w[i] < prefix[i] else 1
        return 0

    lo, hi = 0, len(srt)
    while lo < hi:
        mid = (lo + hi) // 2
        if cmp(srt[mid]) < 0:
            lo = mid + 1
        else:
            hi = mid
    found = 0
    i = lo
    while i < len(srt) and cmp(srt[i]) == 0:
        found += 1
        if limit > 0 and found == limit:
            break
        i += 1
    return steps, found


def build_trie(words):
    nodes = [{'kids': {}, 'end': False}]
    for w in words:
        at = 0
        for c in w:
            if c not in nodes[at]['kids']:
                nodes.append({'kids': {}, 'end': False})
                nodes[at]['kids'][c] = len(nodes) - 1
            at = nodes[at]['kids'][c]
        nodes[at]['end'] = True
    return nodes


def trie_search(nodes, prefix, limit):
    steps = found = at = 0
    for c in prefix:
        if c not in nodes[at]['kids']:
            return steps + 1, 0
        steps += 1
        at = nodes[at]['kids'][c]

    def visit(node_id):  # depth-first, letters in order; a node that ends a word is one result
        nonlocal steps, found
        if nodes[node_id]['end']:
            found += 1
        if limit > 0 and found >= limit:
            return True
        for c in sorted(nodes[node_id]['kids']):
            steps += 1
            if visit(nodes[node_id]['kids'][c]):
                return True
        return False

    visit(at)
    return steps, found


def compressed_nodes(nodes):  # a radix tree keeps only the root, word ends and branch points
    return sum(1 for i, nd in enumerate(nodes) if i == 0 or nd['end'] or len(nd['kids']) >= 2)


for kind in ['words', 'ids']:
    print('word-like keys (shared prefixes)' if kind == 'words' else 'random 8-letter ids (little sharing)')
    for n in [100, 1000, 10000]:
        words = make_words(kind, n)
        nodes = build_trie(words)
        chars = sum(len(w) for w in words)
        print(f'  n={n}: {chars} characters, trie {len(nodes)} nodes, radix tree {compressed_nodes(nodes)} nodes, '
              f'child slots {len(nodes) * ALPHABET} as 26-slot arrays vs {len(nodes) - 1} as maps')

words = make_words('words', 10000)
srt = sorted(words)
nodes = build_trie(words)
print('prefix search over 10000 words, typed prefix "taka", one letter at a time')
for limit in [0, 10]:
    for length in range(1, 5):
        p = 'taka'[:length]
        a, b, c = scan_search(words, p, limit), sorted_search(srt, p, limit), trie_search(nodes, p, limit)
        if limit == 0 and not (a[1] == b[1] == c[1]):
            raise Exception('methods disagree')
        label = 'all matches' if limit == 0 else f'first {limit}'
        print(f'  {label} for "{p}": scan {a[0]} steps, sorted {b[0]}, trie {c[0]} ({c[1]} found)')
