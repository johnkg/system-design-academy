# String matching and regex backtracking: count character comparisons, never time.
# Look for: naive search costs about n * m on a repetitive text, KMP stays under 2n, and a nested-quantifier regex doubles its step
# count with every extra character when the input almost matches, while the set-based matcher stays polynomial.
# The regex engine below is a small explicit matcher written for this sample. Patterns are trees: ("lit", c), ("seq", [..]),
# ("alt", [..]), ("plus", node). Every pattern is anchored at both ends, like ^...$.
steps = 0


def naive_search(text, pat):  # comparisons made while trying every start position
    global steps
    steps = 0
    for s in range(len(text) - len(pat) + 1):
        for j in range(len(pat)):
            steps += 1
            if text[s + j] != pat[j]:
                break
        else:
            return s
    return -1


def kmp_search(text, pat):  # one comparison per attempt; the text index never moves back
    global steps
    steps = 0
    fail = [0] * len(pat)
    k = 0
    for i in range(1, len(pat)):
        while k > 0 and pat[i] != pat[k]:
            steps += 1
            k = fail[k - 1]
        steps += 1
        if pat[i] == pat[k]:
            k += 1
        fail[i] = k
    k = 0
    for i in range(len(text)):
        while k > 0 and text[i] != pat[k]:
            steps += 1
            k = fail[k - 1]
        steps += 1
        if text[i] == pat[k]:
            k += 1
        if k == len(pat):
            return i - k + 1
    return -1


def bt(node, s, i, k):  # backtracking: try a branch, and if the rest of the match fails, come back and try another
    global steps
    kind = node[0]
    if kind == "lit":
        steps += 1
        return i < len(s) and s[i] == node[1] and k(i + 1)
    if kind == "seq":
        def run(idx, j):
            if idx == len(node[1]):
                return k(j)
            return bt(node[1][idx], s, j, lambda j2: run(idx + 1, j2))
        return run(0, i)
    if kind == "alt":
        for option in node[1]:
            if bt(option, s, i, k):
                return True
        return False
    return bt(node[1], s, i, lambda j: bt(node, s, j, k) or k(j))  # plus: one more repeat first, then stop


def match_backtracking(pat, s):
    global steps
    steps = 0
    return bt(pat, s, 0, lambda j: j == len(s))


def ends(node, s, starts):  # set-based: all end positions reachable from each start, every start looked at once
    global steps
    kind = node[0]
    if kind == "lit":
        out = set()
        for i in starts:
            steps += 1
            if i < len(s) and s[i] == node[1]:
                out.add(i + 1)
        return out
    if kind == "seq":
        cur = set(starts)
        for part in node[1]:
            cur = ends(part, s, cur)
        return cur
    if kind == "alt":
        out = set()
        for option in node[1]:
            out |= ends(option, s, starts)
        return out
    seen, frontier, out = set(), set(starts), set()  # plus: repeat until no new positions appear
    while frontier:
        nxt = ends(node[1], s, frontier - seen)
        seen |= frontier
        out |= nxt
        frontier = nxt - seen
    return out


def match_sets(pat, s):
    global steps
    steps = 0
    return len(s) in ends(pat, s, {0})


A = ("lit", "a")
NESTED = ("plus", ("plus", A))  # ^(a+)+$
AMBIG = ("plus", ("alt", [A, ("seq", [A, A])]))  # ^(a|aa)+$
SIMPLE = ("plus", A)  # ^a+$

for n in [10, 100, 1000]:
    text = "a" * n
    pat = "a" * 9 + "b"
    naive_search(text, pat)
    a = steps
    kmp_search(text, pat)
    print(f"text of {n} a's, pattern aaaaaaaaab: naive {a} comparisons, KMP {steps}")

for name, pat in [("^(a+)+$", NESTED), ("^(a|aa)+$", AMBIG), ("^a+$", SIMPLE)]:
    for n in [10, 15, 20]:
        text = "a" * n + "b"  # a near miss: all a's, then one character that spoils it
        ok = match_backtracking(pat, text)
        bt_steps = steps
        match_sets(pat, text)
        print(f"{name} on {n} a's then b: backtracking {bt_steps} steps (match {'yes' if ok else 'no'}), set-based {steps} steps")

for n in [10, 15, 20]:
    ok = match_backtracking(NESTED, "a" * n)  # the same pattern on an input that does match
    print(f"^(a+)+$ on {n} a's with no b: backtracking {steps} steps (match {'yes' if ok else 'no'})")

# Two rules found by measuring the engine, checked here for n up to 20, then used for larger n.
nested = []
ambig = []
for n in range(0, 21):
    match_backtracking(NESTED, "a" * n + "b")
    nested.append(steps)
    match_backtracking(AMBIG, "a" * n + "b")
    ambig.append(steps)
print(f"nested steps = 2^(n+1) - 1 for n = 1..20: {'yes' if all(nested[n] == 2 ** (n + 1) - 1 for n in range(1, 21)) else 'no'}")
print(f"alternation steps = previous + the one before + 3 for n = 2..20: {'yes' if all(ambig[n] == ambig[n - 1] + ambig[n - 2] + 3 for n in range(2, 21)) else 'no'}")
for n in [30, 40, 50]:
    a, b = ambig[19], ambig[20]
    for _ in range(n - 20):
        a, b = b, a + b + 3
    print(f"by the rules, n={n}: nested {2 ** (n + 1) - 1} steps, alternation {b} steps, set-based {2 * n + 1} and {3 * n + 2}")
