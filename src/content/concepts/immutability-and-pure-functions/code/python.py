# Immutability and pure functions: a shared-state bug, then the cost of avoiding it, in element copies (never time).
# Look for: the impure preview gives three different totals for one cart; copying everything costs n per update, structural sharing
# costs a fixed few dozen, and for tiny lists plain copying is cheaper. Costs here come from an explicit model, stated in each comment.
COUPON = 90  # percent of the price left after a 10 percent coupon


def preview_impure(cart):  # applies the coupon to the caller's list, then sums it
    for i in range(len(cart)):
        cart[i] = cart[i] * COUPON // 100
    return sum(cart)


def preview_pure(cart):  # returns a new total and leaves the caller's list alone
    return sum(p * COUPON // 100 for p in cart)


cart = [1000, 2500, 400]  # prices in cents
totals = [preview_impure(cart) for _widget in range(3)]  # header badge, checkout summary, email
print(f"impure preview, one cart, three widgets: {totals[0]}, {totals[1]}, {totals[2]}")
cart = [1000, 2500, 400]
totals = [preview_pure(cart) for _widget in range(3)]
print(f"pure preview, one cart, three widgets: {totals[0]}, {totals[1]}, {totals[2]}")

# Aliasing: three readers hold the same list; a writer changes the first element.
data = [10, 20, 30, 40, 50]
readers = [data, data, data]
data[0] += 1
print(f"readers that saw the change when the list is shared and mutated: {sum(1 for r in readers if r[0] != 10)} of 3")
data = (10, 20, 30, 40, 50)
readers = [data, data, data]
data = (11,) + data[1:]  # a new value; the old one is untouched
print(f"readers that saw the change when updates build a new value: {sum(1 for r in readers if r[0] != 10)} of 3")


def tree_depth(n):  # levels of a 32-way tree that holds n items
    levels, capacity = 1, 32
    while capacity < n:
        capacity *= 32
        levels += 1
    return levels


UPDATES = 100
for n in [10, 100, 1000, 10000]:
    in_place = UPDATES  # one write per update
    copy_all = UPDATES * n  # each update copies all n items
    sharing = UPDATES * tree_depth(n) * 32  # model: each update copies one 32-slot node per tree level
    private = n + UPDATES  # copy once, mutate the private copy, then hand it out
    print(f"n={n}, {UPDATES} updates: in place {in_place}, copy every time {copy_all}, structural sharing {sharing}, private copy then freeze {private}")

n = 1
while not (tree_depth(n) * 32 < n):
    n += 1
print(f"structural sharing is cheaper than copying everything only from n = {n}")
