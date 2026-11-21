# Amortized analysis: a dynamic array that grows when it is full. The cost counted is element copies made by resizing.
# Look for: with doubling the average stays near 1 copy per append although one append copies tens of thousands of
# elements; growing by a constant makes the average climb with n; a shrink threshold at 1/2 thrashes at the boundary.
# Real runtimes pick their own growth factors (commonly somewhere between about 1.125x and 2x), so this is a model.
POLICIES = {
    "double": lambda cap: cap * 2,
    "x1.5": lambda cap: max(cap + 1, cap + cap // 2),
    "add 10": lambda cap: cap + 10,
}


def fmt2(total, n):  # total / n with two decimals, using integers only
    hundredths = (total * 100) // n
    return f"{hundredths // 100}.{str(hundredths % 100).zfill(2)}"


def append_many(policy, n):
    cap, size, total, worst, resizes = 1, 0, 0, 0, 0
    for _ in range(n):
        copies = 0
        if size == cap:  # allocate a bigger array, copy every element
            copies = size
            cap = POLICIES[policy](cap)
            resizes += 1
        size += 1  # the append itself
        total += copies
        if copies > worst:
            worst = copies
    return total, worst, resizes


def thrash(rule, items, cycles):
    # Remove one item and append one item, repeatedly, starting just past a power of two. The shrink rule says when to halve the array.
    div = {"never": 0, "half": 2, "quarter": 4}[rule]
    cap = 1
    while cap < items:
        cap *= 2
    size, copies = items, 0
    for _ in range(cycles):
        size -= 1
        if div > 0 and size * div <= cap:  # shrink: copy into an array half as big
            copies += size
            cap = cap // 2
        if size == cap:  # full again: grow
            copies += size
            cap *= 2
        size += 1
    return copies


for n in [10, 1000, 100000]:
    print(f"n={n}")
    for policy in POLICIES:
        total, worst, resizes = append_many(policy, n)
        print(f"  {policy}: {total} copies in total, {fmt2(total, n)} per append, worst single append {worst} copies, {resizes} resizes")
for rule in ["never", "half", "quarter"]:
    print(f"shrink rule {rule}: {thrash(rule, 1025, 100)} copies in 100 remove-and-append cycles")
