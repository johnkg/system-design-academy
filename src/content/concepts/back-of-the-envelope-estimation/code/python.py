"""Back-of-the-envelope estimation: turn a few stated assumptions into requests per second, storage and bandwidth.

Everything is whole-number arithmetic, so JavaScript, Python and C# print exactly the same text.
Units are decimal (1 KB = 1,000 bytes), which is close enough for an estimate and easy to do in your head.
"""

DAILY_USERS = 10_000_000
ACTIONS_PER_USER_PER_DAY = 2  # photo uploads
KB_PER_ACTION = 500  # a photo after the app compresses it
PEAK_FACTOR = 3  # the busiest moment runs at about 3 times the daily average
YEARS_KEPT = 1

SECONDS_PER_DAY_ROUNDED = 100_000  # rounded up from 86,400 so division is easy
SECONDS_PER_DAY_EXACT = 86_400
DAYS_PER_YEAR = 365
KILO = 1000  # each unit step (KB to MB to GB ...) is a factor of 1,000
BITS_PER_BYTE = 8  # links are rated in bits per second, files are measured in bytes
LINK_KBPS = 10_000_000  # one 10 Gbps network link, in kilobits per second
BYTE_UNITS = ["KB", "MB", "GB", "TB", "PB", "EB"]
BIT_UNITS = ["Kbps", "Mbps", "Gbps", "Tbps"]

# The latency ladder in nanoseconds: rough orders of magnitude, not measurements of any one machine.
LADDER = [
    ("Read from memory", 100),
    ("Random read from an SSD", 100_000),
    ("Round trip inside one data centre", 500_000),
    ("Round trip to another region", 100_000_000),
]


def round_div(a, b):
    """a / b rounded to the nearest whole number (halves go up)."""
    return (2 * a + b) // (2 * b)


def commas(n):
    return f"{n:,}"


def human(value, units):
    """Pick the largest unit that keeps the number at 1 or more, and show up to two decimals."""
    unit, scale = 0, 1
    while unit < len(units) - 1 and value >= scale * KILO:
        scale *= KILO
        unit += 1
    whole, frac = divmod(round_div(value * 100, scale), 100)
    if frac == 0:
        text = str(whole)
    elif frac % 10 == 0:
        text = f"{whole}.{frac // 10}"
    else:
        text = f"{whole}.{frac:02d}"
    return f"{text} {units[unit]}"


def time_text(ns):
    if ns >= 1_000_000:
        return f"{ns // 1_000_000} ms"
    if ns >= 1_000:
        return f"{ns // 1_000} us"
    return f"{ns} ns"


print(f"Assumptions: {commas(DAILY_USERS)} daily users, {ACTIONS_PER_USER_PER_DAY} actions each, {KB_PER_ACTION} KB per action, peak {PEAK_FACTOR}x, kept {YEARS_KEPT} year")

per_day = DAILY_USERS * ACTIONS_PER_USER_PER_DAY
print(f"requests per day: {commas(DAILY_USERS)} x {ACTIONS_PER_USER_PER_DAY} = {commas(per_day)}")

average_qps = round_div(per_day, SECONDS_PER_DAY_ROUNDED)
exact_qps = round_div(per_day, SECONDS_PER_DAY_EXACT)
rounding_error_percent = round_div(100 * (SECONDS_PER_DAY_ROUNDED - SECONDS_PER_DAY_EXACT), SECONDS_PER_DAY_ROUNDED)
print(f"average per second ({commas(SECONDS_PER_DAY_ROUNDED)} s a day): {commas(average_qps)}")
print(f"average per second ({commas(SECONDS_PER_DAY_EXACT)} s a day): {commas(exact_qps)}")
print(f"rounding the day costs about {rounding_error_percent}%")

peak_qps = average_qps * PEAK_FACTOR
print(f"peak per second: {commas(average_qps)} x {PEAK_FACTOR} = {commas(peak_qps)}")

storage_per_day_kb = per_day * KB_PER_ACTION
storage_kb = storage_per_day_kb * DAYS_PER_YEAR * YEARS_KEPT
print(f"storage per day: {human(storage_per_day_kb, BYTE_UNITS)}")
print(f"storage for {YEARS_KEPT} year: {human(storage_kb, BYTE_UNITS)}")

peak_kb_per_second = peak_qps * KB_PER_ACTION
peak_kbps = peak_kb_per_second * BITS_PER_BYTE
print(f"peak bandwidth: {human(peak_kb_per_second, BYTE_UNITS)}/s = {human(peak_kbps, BIT_UNITS)}")
print(f"share of one 10 Gbps link: {round_div(100 * peak_kbps, LINK_KBPS)}%")

print("latency ladder:")
memory_ns = LADDER[0][1]
for name, ns in LADDER:
    print(f"  {name:<34} {time_text(ns):>6} = {commas(ns // memory_ns)}x memory")
