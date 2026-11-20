# A new app version (v4) ships on day 0 and users adopt it along a slowing curve, while 8% never update. A server change
# goes live on a chosen day; which of the 1,000,000 active users does it break? Integers only; the seed is fixed.
USERS = 1000000
NEVER_PPM = 80000                # 8% of users never update (parts per million)
BASE = [100000, 200000, 700000]  # day 0: users on v1, v2, v3 (v4 is released that day, with no users yet)
NAMES = ["v1", "v2", "v3", "v4"]
STRICT_PARSER = 1                # v1 rejects a response that has a field it does not know


def make_rng(seed):
    state = [seed]

    def nxt():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]

    return nxt


# Each day a share of the users who are willing to update moves to v4. The share slows down: 16% on day 1, one point
# less each day, never below 1%, plus 0 or 1 point of daily noise. remaining[d] is the part per million of willing users
# still on an old version.
def adoption(days):
    nxt = make_rng(5)
    remaining = [1000000]
    for d in range(1, days + 1):
        pct = max(1, 16 - d) + (nxt() % 2)
        remaining.append(remaining[d - 1] * (100 - pct) // 100)
    return remaining


# A share of all users in tenths of a percent, written with integers: 314414 users is "31.4%".
def percent(users):
    tenths = users * 1000 // USERS
    return f"{tenths // 10}.{tenths % 10}%"


# Users on each of the four versions on a given day.
def versions(day):
    rem = adoption(day)[day]
    keep = NEVER_PPM + (1000000 - NEVER_PPM) * rem // 1000000  # part per million of each old version still there
    old = [u * keep // 1000000 for u in BASE]
    return old + [USERS - sum(old)]


# change: 'additive' (a new field is sent), 'renamed' (a field gets a new name), 'removed' (a field is dropped).
# The old behaviour is removed on `day`. min_version: clients below it get a forced-upgrade screen (1 = no minimum).
# adapt: the server reads the app-version header and keeps sending old clients the shape they know.
def run(change, day, min_version, adapt):
    users = versions(day)
    affected = [STRICT_PARSER] if change == "additive" else [1, 2, 3] if change == "renamed" else [2, 3]  # versions that read the field
    forced = sum(u for i, u in enumerate(users) if i + 1 < min_version)
    broken = 0 if adapt else sum(users[v - 1] for v in affected if v >= min_version)
    shares = ", ".join(f"{NAMES[i]} {percent(u)}" for i, u in enumerate(users))
    minimum = "none" if min_version == 1 else NAMES[min_version - 1]
    print(f"{change} on day {day}, minimum {minimum}, {'adapting to the version header' if adapt else 'no adaptation'}")
    print(f"  users: {shares}")
    print(f"  broken {broken} of {USERS} ({percent(broken)}); forced to upgrade {forced}")


run("renamed", 7, 1, False)
run("renamed", 14, 1, False)
run("renamed", 60, 1, False)
run("removed", 30, 1, False)
run("additive", 30, 1, False)
run("renamed", 30, 3, False)
run("renamed", 30, 1, True)
