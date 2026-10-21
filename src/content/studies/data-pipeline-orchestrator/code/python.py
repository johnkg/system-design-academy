# A tiny pipeline orchestrator in Python: a DAG of tasks run once per day (the data interval),
# a sensor that waits for a file, retries with backoff, and a backfill that is safe to repeat.
import sys


def fnv(s):
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


# Tasks in dependency order: (name, upstream tasks).
TASKS = [("wait_file", []), ("extract", ["wait_file"]), ("clean", ["extract"]), ("by_region", ["clean"]),
         ("by_product", ["clean"]), ("report", ["by_region", "by_product"])]
POKE, TIMEOUT, MAX_ATTEMPTS = 10, 30, 3  # sensor checks every 10 minutes and gives up after 30
FLAKY_ONE_IN = 5  # one task-day in 5 is flaky
BACKOFF_MIN = 30  # retry backoff in minutes: 30, then 60


def flaky(task, day):
    return fnv(f"{task}:{day}") % FLAKY_ONE_IN == 0  # fails its first two attempts, then works


class Orchestrator:
    def __init__(self):
        self.state = {}
        self.output = {}
        self.stats = {}

    def run_task(self, task, deps, day, arrival):
        key, s = f"{task}/{day}", self.stats
        if task == "wait_file":  # sensor: poke until the file has landed or the timeout passes
            late = arrival[day] > TIMEOUT
            s["pokes"] += TIMEOUT // POKE if late else max(1, -(-arrival[day] // POKE))
            if late:
                return "timeout"
            self.output[key] = fnv(f"file:{day}")
            return "success"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            if flaky(task, day) and attempt < MAX_ATTEMPTS:
                s["retries"] += 1
                s["backoff"] += BACKOFF_MIN * 2 ** (attempt - 1)
                continue
            inputs = [str(self.output[f"{d}/{day}"]) for d in deps]
            self.output[key] = fnv(f"{task}:{day}:{','.join(inputs)}")  # overwrite the partition, never append
            return "success"
        return "failed"

    def backfill(self, days, arrival):
        self.stats = {"ran": 0, "skipped": 0, "failed": 0, "blocked": 0, "retries": 0, "backoff": 0, "pokes": 0}
        for day in days:
            for task, deps in TASKS:
                key = f"{task}/{day}"
                if self.state.get(key) == "success":
                    self.stats["skipped"] += 1
                    continue
                if any(self.state.get(f"{d}/{day}") != "success" for d in deps):
                    self.state[key] = "upstream_failed"
                    self.stats["blocked"] += 1
                    continue
                result = self.run_task(task, deps, day, arrival)
                self.state[key] = result
                self.stats["ran"] += 1
                if result != "success":
                    self.stats["failed"] += 1
        x = self.stats
        return (f"ran {x['ran']}, skipped {x['skipped']}, failed {x['failed']}, blocked {x['blocked']}, "
                f"retries {x['retries']}, backoff {x['backoff']}s, pokes {x['pokes']}")

    def checksum(self):
        acc = 0
        for k in sorted(self.output):
            acc = fnv(f"{acc}:{k}={self.output[k]}")
        return acc


days = [1, 2, 3, 4, 5, 6]
arrival = {1: 5, 2: 12, 3: 28, 4: 45, 5: 8, 6: 20}  # minutes after midnight that each day's file lands
run = Orchestrator()
print("backfill 1:", run.backfill(days, arrival))
print("day 4 is", run.state["wait_file/4"], "and report/4 is", run.state["report/4"])
arrival[4] = 3  # the late file has now landed
print("backfill 2:", run.backfill(days, arrival))
total = run.checksum()
print("backfill 3:", run.backfill(days, arrival))
for t in ["clean", "by_region", "by_product", "report"]:
    del run.state[f"{t}/2"]  # clear day 2 from clean onward
print("rerun day 2:", run.backfill(days, arrival))
print(f"checksum {total}, unchanged after reruns: {str(run.checksum() == total).lower()}")

fresh = Orchestrator()
fresh.backfill(days, arrival)
print(f"a fresh run from scratch gives the same checksum: {str(fresh.checksum() == total).lower()}")
if run.checksum() != total or fresh.checksum() != total or run.stats["ran"] != 4 or fresh.stats["failed"] != 0:
    sys.exit(1)
