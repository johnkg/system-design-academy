# Byte-pair encoding in Python: learn merges from a tiny corpus, then encode new words.
CORPUS = [("low", 5), ("lower", 2), ("newest", 6), ("widest", 3)]  # (word, how often it appears)
MERGES = 8


def pair_counts(words):
    counts = {}  # insertion order breaks ties: the first pair seen with the top count wins
    for symbols, freq in words:
        for a, b in zip(symbols, symbols[1:]):
            counts[(a, b)] = counts.get((a, b), 0) + freq
    return counts


def apply_merge(symbols, a, b):
    out, i = [], 0
    while i < len(symbols):
        if i < len(symbols) - 1 and symbols[i] == a and symbols[i + 1] == b:
            out.append(a + b)
            i += 2
        else:
            out.append(symbols[i])
            i += 1
    return out


words = [(list(word) + ["_"], freq) for word, freq in CORPUS]  # "_" marks the end of a word
characters = {symbol for symbols, _ in words for symbol in symbols}
merges = []
for n in range(1, MERGES + 1):
    counts = pair_counts(words)
    best, best_count = None, 0
    for pair, count in counts.items():
        if count > best_count:
            best, best_count = pair, count
    merges.append(best)
    print(f"merge {n}: {best[0]} + {best[1]} -> {best[0] + best[1]} (count {best_count})")
    words = [(apply_merge(symbols, *best), freq) for symbols, freq in words]


def encode(word):
    symbols = list(word) + ["_"]
    for a, b in merges:  # apply the merges in the order they were learned
        symbols = apply_merge(symbols, a, b)
    return symbols


for word in ["lowest", "newer", "wider"]:
    print(f"{word} -> [{', '.join(encode(word))}]")
print(f"vocabulary size: {len(characters)} characters + {len(merges)} merges = {len(characters) + len(merges)}")
