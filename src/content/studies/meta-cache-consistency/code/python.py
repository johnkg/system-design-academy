# Three ideas from Meta's cache consistency posts, as a small model in Python (not Meta's code or data):
# 1. A fill that races an invalidation: a version check ignores older data, but only while the cache still remembers the version.
# 2. An error handler that drops an item only if its version is lower, which does nothing for a stale item that already has the latest version.
# 3. A Polaris-style checker: it re-checks a mismatch and only reports it, and only then asks the database, once it has lasted a whole timescale.
# Time is simulated (seconds), so every run prints the same thing.
import sys


# Part 1: the cache holds entries {value, version}. `mode` decides how a new value is accepted.
#   none: always overwrite. version: ignore older data while an entry exists. remember: also keep the version of evicted entries.
def new_cache(mode):
    return {"mode": mode, "entries": {}, "remembered": {}}


def accept(cache, key, value, version):
    entry = cache["entries"].get(key)
    newest = entry["version"] if entry else 0
    if cache["mode"] == "remember":
        newest = max(newest, cache["remembered"].get(key, 0))
    if cache["mode"] != "none" and newest >= version:
        return  # older data never overwrites newer data
    cache["entries"][key] = {"value": value, "version": version}


def evict(cache, key):
    entry = cache["entries"].get(key)
    if entry and cache["mode"] == "remember":
        cache["remembered"][key] = entry["version"]
    cache["entries"].pop(key, None)


print("The database holds x=43 at version 2. A fill read x=42 at version 1 earlier, and its reply is late.")
for evicted in (False, True):
    for mode in ("none", "version", "remember"):
        cache = new_cache(mode)
        accept(cache, "x", 43, 2)  # the invalidation arrives first
        if evicted:
            evict(cache, "x")  # the entry is evicted before the late reply
        accept(cache, "x", 42, 1)  # the old fill reply arrives last
        entry = cache["entries"].get("x")
        if entry is None:
            result = "no entry, the next read refills it from the database (consistent)"
        elif entry["value"] == 43:
            result = "cache x=43 (consistent)"
        else:
            result = "cache x=42 (stale)"
        print(f"  {'evicted' if evicted else 'kept   '}, {mode.ljust(8)} -> {result}")


# Part 2: the cache holds metadata 0 at version 4 but the database holds metadata 1 at version 4.
def drop_if_lower(entries, key, version):
    entry = entries.get(key)
    if entry and entry["version"] < version:
        del entries[key]


def handle_invalidation(entries, error, handler):
    if not error:
        entries["meta"] = {"value": 1, "version": 4}  # the normal path writes the new data
    elif handler == "drop if lower":
        drop_if_lower(entries, "meta", 4)
    else:
        entries.pop("meta", None)  # drop whatever the version


print("The cache holds metadata=0 at version 4. The database holds metadata=1 at version 4.")
for error, handler in ((False, "-"), (True, "drop if lower"), (True, "drop always")):
    entries = {"meta": {"value": 0, "version": 4}}
    handle_invalidation(entries, error, handler)
    entry = entries.get("meta")
    if entry is None:
        result = "dropped, the next read refills it from the database"
    elif entry["value"] == 1:
        result = "consistent"
    else:
        result = "stale for good"
    print(f"  {'error' if error else 'no error'}, handler {handler.ljust(13)} -> {result}")

# Part 3: an invalidation says x is 4 at version 4. Three replicas are checked at second 0.
TIMESCALES = [60, 300]  # report after one minute and after five minutes


def replica_holds(name, second):
    if name == "a":
        return 4  # up to date
    if name == "b":
        return 4 if second >= 40 else 3  # catches up at second 40
    return 3  # c stays stale


with_delay = 0
immediate = 0
print("An invalidation says x=4 at version 4. Replicas are checked at second 0, then again at each timescale.")
for name in ("a", "b", "c"):
    if replica_holds(name, 0) == 4:
        print(f"  replica {name}: consistent at second 0")
        continue
    immediate += 1  # checking the database at once would cost one query for every mismatch
    reported = [t for t in TIMESCALES if replica_holds(name, t) != 4]
    if reported:
        with_delay += 1  # one database check, made when the sample crosses its first timescale
    if reported:
        text = "still wrong after " + " and ".join(f"{t // 60} min" for t in reported) + ", reported"
    else:
        text = "fixed itself by second 60, never reported"
    print(f"  replica {name}: wrong at second 0, {text}")
print(f"database checks that bypass the cache: {with_delay} with the delay, {immediate} if made at once")

if with_delay >= immediate:
    sys.exit(1)
