# KISS, YAGNI and premature abstraction. Part 1 writes one report exporter twice (plain function vs. a registry, config and factory
# built for formats nobody asked for) and counts the calls one report goes through. Part 2 shows the case where planning ahead IS
# right: a stored record with a version field vs. one without. Part 3 counts the touch points of a year of 12 change requests
# (10 inside the code, 2 on the public contract) for three designs. Look for: 1 call vs 7, the old reader silently misreading a
# new record, and where speculation starts to pay (only at a 90% hit rate).
trace = []
ROWS = [("tea", 3), ("milk", 12), ("rice", 40)]


# Part 1a. Simple: one function that does today's job.
def export_csv(rows):
    trace.append("export_csv")
    return "\n".join(f"{n},{q}" for n, q in rows)


# Part 1b. Speculative: an exporter registry, a config file and a factory, for JSON and XML that were "bound to come".
def join_row(cells):
    trace.append("join_row")
    return ",".join(cells)


def csv_exporter(rows):
    trace.append("csv_exporter")
    return "\n".join(join_row([n, str(q)]) for n, q in rows)


REGISTRY = {"csv": csv_exporter}  # the json and xml exporters were planned, never written
CONFIG = {"format": "csv"}


def load_config():
    trace.append("load_config")
    return CONFIG


def get_exporter(fmt):
    trace.append("get_exporter")
    return REGISTRY[fmt]


def export_report(rows):
    trace.append("export_report")
    return get_exporter(load_config()["format"])(rows)


a = export_csv(ROWS)
calls_simple = len(trace)
names_simple = len(set(trace))
trace.clear()
b = export_report(ROWS)
print(f"same output: {str(a == b).lower()}")
print(f"calls for one report: simple {calls_simple}, speculative {len(trace)}")
print(f"different names to read: simple {names_simple}, speculative {len(set(trace))}")


# Part 2. Planning ahead that is right: a stored record. Files written today are read for years, by readers you cannot update.
def write_v0(qty, name):
    return f"{qty},{name}"


def read_v0(line):  # reads "qty,name"
    i = line.index(",")
    return f"qty={line[:i]} name={line[i + 1:]}"


def write_v2(qty, cur, name):  # a new field is added later
    return f"v2|{qty}|{cur}|{name}"


def read_versioned(line, newest):  # a reader that knows its versions and says so when it meets a newer one
    p = line.split("|")
    if p[0] == "v1" and newest >= 1:
        return f"qty={p[1]} name={p[2]}"
    if p[0] == "v2" and newest >= 2:
        return f"qty={p[1]} cur={p[2]} name={p[3]}"
    return f"error: unknown version {p[0]}"


print("old reader, unversioned, new record 3,EUR,tea: " + read_v0("3,EUR,tea"))
print("old reader, versioned, new record: " + read_versioned(write_v2(3, "EUR", "tea"), 1))
print("new reader, versioned, new record: " + read_versioned(write_v2(3, "EUR", "tea"), 2))

# Part 3. A year of 12 change requests: 10 inside the code, 2 on the public contract. Touch points = places a person must edit.
# simple:      build 3; an internal change 2 (edit, test); a contract change costs the "late" price L.
# speculative: build 3 + 6 (interface, registry, config, two exporters nobody asked for); a guessed change 1 (add a class),
#              a missed one 4 (the interface, the factory, every exporter, the config); a contract change costs L.
# targeted:    simple code, plus 2 points up front for a version field and a rule to reject unknown versions;
#              an internal change 2; a contract change 1 (add a version).
INTERNAL, CONTRACT = 10, 2
SURFACES = [("internal function", 1), ("public API", 9), ("stored file format", 15)]


def year(design, hit, late):
    if design == "simple":
        return 3 + INTERNAL * 2 + CONTRACT * late
    if design == "speculative":
        h = INTERNAL * hit // 100
        return 9 + h * 1 + (INTERNAL - h) * 4 + CONTRACT * late
    return 5 + INTERNAL * 2 + CONTRACT * 1


for name, late in SURFACES:
    for hit in [0, 50, 90, 100]:
        print(f"{name}, guess right {hit}%: simple {year('simple', hit, late)}, "
              f"speculative {year('speculative', hit, late)}, targeted {year('targeted', hit, late)}")
first = next((h for h in range(0, 101, 10) if year("speculative", h, 1) <= year("simple", h, 1)), -1)
print(f"speculation matches simple from a hit rate of {first}%")
