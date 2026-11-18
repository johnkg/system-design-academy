# Money as integers: minor units, one rounding rule, one rounding point, and exact splitting.
# Every printed value is an integer or a yes/no flag, so the three languages print identical text.
import math

# A cart of 6 lines: price in cents, quantity. Subtotal is 17808 cents.
LINES = [(1410, 3), (2585, 1), (2507, 1), (3009, 1), (705, 3), (1681, 2)]


def div_round(num, den, mode):
    """Divide num by den (both integers, den > 0) and round the result to a whole number with an explicit rule."""
    q = num // den
    r = num - q * den
    if mode == "trunc":
        return q
    if 2 * r > den:
        return q + 1
    if 2 * r < den:
        return q
    if mode == "up":
        return q + 1
    return q if q % 2 == 0 else q + 1  # an exact tie: half up, or half even (banker's)


def float_round(dollars, mode):
    """The same rounding written the way float code usually does it: multiply the dollars by 100 and look at the fraction."""
    x = dollars * 100
    f = math.floor(x)
    d = x - f
    if mode == "trunc":
        cents = f
    elif d > 0.5:
        cents = f + 1
    elif d < 0.5:
        cents = f
    else:
        cents = f + 1 if mode == "up" else (f if f % 2 == 0 else f + 1)
    return cents / 100


def integer_cart(bp, point, mode):
    """Integer cart: rate in basis points (1000 = 10.00%). Tax is rounded per line or once on the subtotal."""
    subtotal = 0
    tax = 0
    for price, qty in LINES:
        subtotal += price * qty
        if point == "line":
            tax += div_round(price * qty * bp, 10000, mode)
    if point == "total":
        tax = div_round(subtotal * bp, 10000, mode)
    return tax, subtotal + tax


def float_cart(bp, point, mode):
    """Float cart: prices held as dollars in binary floating point. Only the final answer is turned back into cents to print it."""
    rate = bp / 10000
    subtotal = 0.0
    tax = 0.0
    for price, qty in LINES:
        net = (price / 100) * qty
        subtotal += net
        if point == "line":
            tax += float_round(net * rate, mode)
    if point == "total":
        tax = float_round(subtotal * rate, mode)
    return math.floor(tax * 100 + 0.5), math.floor((subtotal + tax) * 100 + 0.5)


def allocate(amount, weights):
    """Split an amount by weights so the parts add up exactly: floor each share, then hand the leftover cents to the
    largest fractional remainders (ties go to the earlier part)."""
    total = sum(weights)
    parts = [(amount * w) // total for w in weights]
    rem = [(amount * w) % total for w in weights]
    left = amount - sum(parts)
    order = sorted(range(len(weights)), key=lambda i: (-rem[i], i))
    for i in order:
        if left == 0:
            break
        parts[i] += 1
        left -= 1
    return parts


def convert(minor, from_exp, to_exp, rate_e4, mode):
    """Convert minor units between currencies: the rate is held as an integer (rate_e4 = rate x 10000), and we round once."""
    return div_round(minor * rate_e4 * 10 ** to_exp, 10 ** from_exp * 10000, mode)


def show(minor, exp):
    """Show a minor-unit amount with its currency's exponent: 1234 is 12.34 in USD, 1234 in JPY, 1.234 in KWD."""
    if exp == 0:
        return str(minor)
    p = 10 ** exp
    return f"{minor // p}.{str(minor % p).zfill(exp)}"


print("-- binary floating point")
a, b, c = 0.1, 0.2, 0.3
ten = 0.0
ten_cents = 0
for _ in range(10):
    ten += a
    ten_cents += 10
print(f"0.1 + 0.2 equals 0.3: {1 if a + b == c else 0}")
print(f"ten times 0.1 equals 1: {1 if ten == 1 else 0}; ten times 10 cents equals 100: {1 if ten_cents == 100 else 0}")
price = 1.005
print(f"1.005 to cents, half up: float {math.floor(price * 100 + 0.5)}, integer {div_round(1005, 10, 'up')}")

print("-- minor units and exponents")
print(f"1234 in USD (exponent 2): {show(1234, 2)}; JPY (0): {show(1234, 0)}; KWD (3): {show(1234, 3)}")

print("-- cart: 6 lines, subtotal 17808 cents")
for bp in (1000, 2000):
    for point in ("line", "total"):
        for mode in ("up", "even", "trunc"):
            i_tax, i_total = integer_cart(bp, point, mode)
            f_tax, f_total = float_cart(bp, point, mode)
            label = "truncated" if mode == "trunc" else "half " + mode
            print(f"rate {bp} bp, round per {point}, {label}: integer tax {i_tax} total {i_total}; float total {f_total}; float is off by {f_total - i_total}")

print("-- splitting")
for n in (3, 6):
    each = div_round(10000, n, "up")
    naive = n * each
    parts = allocate(10000, [1] * n)
    print(f"10000 cents {n} ways: naive {each} each adds up to {naive} (off by {naive - 10000}); allocated {' + '.join(map(str, parts))} = {sum(parts)}")
print(f"10001 cents by weights 5:3:2: {' + '.join(map(str, allocate(10001, [5, 3, 2])))}")

print("-- converting the 6 line amounts (illustrative rates, rounded half up)")
for name, to_exp, rate_e4 in (("EUR", 2, 9137), ("JPY", 0, 1492500), ("KWD", 3, 3074)):
    each_line = sum(convert(p * q, 2, to_exp, rate_e4, "up") for p, q in LINES)
    once = convert(17808, 2, to_exp, rate_e4, "up")
    print(f"{name}: convert each line then add {each_line}; add then convert once {once}; difference {each_line - once}")
