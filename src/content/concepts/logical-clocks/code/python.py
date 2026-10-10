"""Lamport and vector clocks in Python, on a small fixed scenario.
Processes: A, B, C. A sends a message to B, and B sends one to C. C also does something on its own."""

procs = ["A", "B", "C"]
lamport = {"A": 0, "B": 0, "C": 0}
vector = {"A": [0, 0, 0], "B": [0, 0, 0], "C": [0, 0, 0]}
events = []  # { name, lamport, vector }


def record(name, p):
    events.append({"name": name, "lamport": lamport[p], "vector": list(vector[p])})


def local(name, p):
    lamport[p] += 1
    vector[p][procs.index(p)] += 1
    record(name, p)


def send(name, sender):
    local(name, sender)
    return {"lamport": lamport[sender], "vector": list(vector[sender])}  # the message carries the sender's clocks


def receive(name, to, message):
    lamport[to] = max(lamport[to], message["lamport"]) + 1  # jump past the sender's time
    vector[to] = [max(v, message["vector"][i]) for i, v in enumerate(vector[to])]
    vector[to][procs.index(to)] += 1
    record(name, to)


local("A1 write x", "A")
m1 = send("A2 send to B", "A")
receive("B1 receive from A", "B", m1)
m2 = send("B2 send to C", "B")
local("C1 local event", "C")  # happens independently of A and B
receive("C2 receive from B", "C", m2)

for e in events:
    print(f"{e['name']:<20} lamport {e['lamport']}  vector [{','.join(map(str, e['vector']))}]")


# Vector comparison: before, after, equal or concurrent
def relation(a, b):
    less_or_equal = all(v <= b[i] for i, v in enumerate(a))
    greater_or_equal = all(v >= b[i] for i, v in enumerate(a))
    if less_or_equal and greater_or_equal:
        return "equal"
    if less_or_equal:
        return "happened before"
    if greater_or_equal:
        return "happened after"
    return "concurrent"


by_name = {e["name"][:2]: e for e in events}
for x, y in [("A1", "C2"), ("A2", "B1"), ("A1", "C1")]:
    print(f"{x} vs {y}: {relation(by_name[x]['vector'], by_name[y]['vector'])}  "
          f"(lamport {by_name[x]['lamport']} vs {by_name[y]['lamport']})")
