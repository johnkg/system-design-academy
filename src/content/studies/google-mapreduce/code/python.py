# A miniature of MapReduce from Google's 2004 paper, in Python (a teaching model, not Google's code):
# a word count with M map tasks and R reduce tasks, a combiner, a partitioning function, a master that re-runs finished map
# tasks when their worker dies (their output was on that worker's local disk), and a backup task for a straggler whose
# duplicate output is ignored. Everything is deterministic.

SPLITS = ["the quick brown fox", "the lazy dog", "the fox and the dog", "quick quick brown"]
R = 2
WORKERS = ["W1", "W2", "W3"]
local = {w: {} for w in WORKERS}  # map output lives on the worker's local disk
alive = set(WORKERS)
where = {}  # map task -> worker that holds its output


def partition(word):  # like hash(key) mod R
    return sum(ord(ch) for ch in word) % R


def run_map(task, worker):
    counts = {}  # combiner: add up repeated words inside the map task before anything is sent
    for word in SPLITS[task].split(" "):
        counts[word] = counts.get(word, 0) + 1
    buckets = [[] for _ in range(R)]
    for word, n in counts.items():
        buckets[partition(word)].append((word, n))
    local[worker][task] = buckets
    where[task] = worker
    print(f"map {task} on {worker}: {len(SPLITS[task].split(' '))} pairs became {len(counts)} after the combiner")


for task in range(len(SPLITS)):
    run_map(task, WORKERS[task % len(WORKERS)])

alive.discard("W2")
print("W2 stops answering pings and is marked failed")
for task, worker in list(where.items()):
    if worker not in alive:
        del where[task]
        print(f"map {task} was done on {worker} but its output is on a dead disk: back to idle")
        run_map(task, "W3")
        print(f"map {task} re-executed on W3")

outputs = {}  # output file name -> worker that finished first


def run_reduce(r, worker):
    totals = {}
    for task in range(len(SPLITS)):
        for word, n in local[where[task]][task][r]:
            totals[word] = totals.get(word, 0) + n
    line = " ".join(f"{w}={n}" for w, n in sorted(totals.items()))
    file = f"part-{r}"
    if file in outputs:
        print(f"reduce {r} also finished on {worker}, but {file} already exists from {outputs[file]}: ignored")
        return
    outputs[file] = worker
    print(f"reduce {r} finished on {worker}: {file} = {line}")


run_reduce(0, "W1")
print("reduce 1 on W3 is a straggler, so the master starts a backup copy on W1")
run_reduce(1, "W1")
run_reduce(1, "W3")
print("output files: " + ", ".join(f"{f} (from {w})" for f, w in outputs.items()))
