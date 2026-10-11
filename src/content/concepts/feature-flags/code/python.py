# A feature-flag evaluator: kill switch, targeting rules, then a sticky percentage rollout.
# Hashing is FNV-1a 32-bit with explicit masking, so every language computes the same bucket.
import sys


def fnv1a(text):
    h = 2166136261  # offset basis
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 16777619) & 0xFFFFFFFF  # multiply, keep 32 bits
    return h


# Same user + same flag key + same salt => same bucket (0..9999), on every server, forever.
def bucket(flag, user_id):
    return fnv1a(f"{flag['key']}:{flag['salt']}:{user_id}") % 10000


def evaluate(flag, user):
    if flag["killed"]:
        return {"on": False, "reason": "kill switch"}
    for rule in flag["rules"]:
        if user[rule["attr"]] == rule["equals"]:
            return {"on": rule["serve"], "reason": f"rule {rule['attr']}={fmt(rule['equals'])}"}
    on = bucket(flag, user["id"]) < flag["percent"] * 100  # percent in whole numbers: 25 -> buckets 0..2499
    return {"on": on, "reason": f"rollout {flag['percent']}%"}


def fmt(value):
    return str(value).lower() if isinstance(value, bool) else str(value)


# If the flag service cannot be reached, use the last known value, else the safe default compiled into the code.
def evaluate_safely(fetch_flag, user, last_known=None, safe_default=False):
    try:
        return evaluate(fetch_flag(), user)
    except Exception:
        if last_known is None:
            return {"on": safe_default, "reason": "service down, safe default"}
        return {"on": last_known, "reason": "service down, last known"}


users = [{"id": f"user-{i}", "country": ["US", "DE", "FR", "JP"][i % 4], "staff": i % 50 == 0} for i in range(1, 1001)]
flag = {"key": "new-checkout", "salt": "v1", "percent": 0, "killed": False,
        "rules": [{"attr": "staff", "equals": True, "serve": True}, {"attr": "country", "equals": "DE", "serve": False}]}


def seen(**changes):
    f = {**flag, **changes}
    return {u["id"] for u in users if evaluate(f, u)["on"]}


def show(r):
    return '{"on":%s,"reason":"%s"}' % (str(r["on"]).lower(), r["reason"])


print(f"bucket(user-1)={bucket(flag, 'user-1')} bucket(user-2)={bucket(flag, 'user-2')}")
previous = set()
for percent in [0, 10, 25, 50, 100]:
    now = seen(percent=percent)
    dropped_out = len(previous - now)  # stickiness: must stay 0
    print(f"rollout {str(percent).rjust(3)}%: {len(now)} of {len(users)} see it, {dropped_out} dropped out")
    if dropped_out != 0:
        sys.exit(1)
    previous = now

salted = seen(percent=25, salt="v2")
base25 = seen(percent=25)
print(f"new salt at 25%: {len(base25 & salted)} of {len(base25)} keep the feature (the cohort was reshuffled)")

print(f"killed: {len(seen(percent=100, killed=True))} see it")


def down():
    raise RuntimeError("flag service unreachable")


dave = users[4]  # user-5, in DE
print(f"service down, no cache: {show(evaluate_safely(down, dave, None))}")
print(f"service down, cached on: {show(evaluate_safely(down, dave, True))}")
if len(seen(percent=100, killed=True)) != 0 or len(seen(percent=50)) < 300:
    sys.exit(1)
