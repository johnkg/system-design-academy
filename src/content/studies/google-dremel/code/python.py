# A miniature of Dremel from Google's VLDB 2010 paper, in Python (a teaching model, not Google's code):
# nested records are stored column by column with repetition and definition levels (the paper's own two sample records and its
# Name.Language.Code column), the column alone is enough to rebuild the nesting or to count values within each record, and a
# serving tree of a root, intermediate servers and leaves aggregates partial counts, with a dispatcher that re-sends slow
# tablets or returns when a minimum share of tablets has been scanned. Everything is deterministic.
import json
import math

# The paper's records r1 and r2, trimmed to the fields used here.
records = [
    {"DocId": 10, "Name": [{"Language": [{"Code": "en-us"}, {"Code": "en"}]}, {}, {"Language": [{"Code": "en-gb"}]}]},
    {"DocId": 20, "Name": [{}]},
]


def stripe(recs):  # column Name.Language.Code: Name and Language repeat, Code is required, so the largest definition level is 2
    column = []
    for rec in recs:
        if not rec["Name"]:
            column.append((None, 0, 0))
            continue
        for n, name in enumerate(rec["Name"]):
            langs = name.get("Language", [])
            if not langs:  # a Name without a Language: defined down to Name only
                column.append((None, 0 if n == 0 else 1, 1))
                continue
            for l, lang in enumerate(langs):
                column.append((lang["Code"], 0 if n == 0 and l == 0 else 1 if l == 0 else 2, 2))
    return column


column = stripe(records)
print("--- the column Name.Language.Code as (value, repetition level, definition level)")
for v, r, d in column:
    print(f"{'NULL' if v is None else v}  r={r}  d={d}")


def assemble(col):  # rebuild the nesting of this one column from the levels alone
    out = []
    for value, r, d in col:
        if r == 0:
            out.append([])  # a new record starts
        if d == 0:
            continue  # the record has no Name at all
        if r <= 1:
            out[-1].append([])  # a new Name starts
        if d >= 2:
            out[-1][-1].append(value)  # a Language with this Code
    return out


print("--- rebuilt from the levels alone (one list per Name)")
for i, rec in enumerate(assemble(column)):
    print(f"r{i + 1}: {json.dumps(rec, separators=(',', ':'))}")


def count_per_record(col):  # a value with definition level 2 counts, a record starts at r=0
    counts = []
    for _, r, d in col:
        if r == 0:
            counts.append(0)
        if d == 2:
            counts[-1] += 1
    return counts


print("--- within-record counts without assembling any record: " + ", ".join(map(str, count_per_record(column))))

# A serving tree: root -> 2 intermediate servers -> 4 leaves, 12 tablets. Every tablet takes 100 ms except tablet 7, a straggler.
print("--- a query over 12 tablets on a serving tree")
TABLETS, LEAVES = 12, 4
NORMAL = 100
THRESHOLD = 3 * NORMAL  # a tablet is a straggler once it has run 3 times the usual time


def count(t):  # each tablet's partial COUNT
    return (t * 7) % 5 + 1


def time(t):
    return 1000 if t == 7 else NORMAL


def total(ts):
    return sum(count(t) for t in ts)


all_tablets = list(range(TABLETS))
by_leaf = [[t for t in all_tablets if t % LEAVES == l] for l in range(LEAVES)]
intermediate = [by_leaf[0] + by_leaf[1], by_leaf[2] + by_leaf[3]]
print("partial counts added up the tree: " + " + ".join(str(total(ts)) for ts in intermediate) + f" = {total(all_tablets)}")
finish = {}
for ts in by_leaf:
    t = 0
    for tablet in ts:
        t += time(tablet)
        finish[tablet] = t
print(f"no mitigation: the query waits for the straggler and takes {max(finish.values())} ms")
print(f"straggler re-sent to an idle leaf after 3 x the usual tablet time ({THRESHOLD} ms): the query takes {THRESHOLD + NORMAL} ms")
ordered = sorted(finish.items(), key=lambda p: p[1])
needed = math.ceil(0.83 * TABLETS)
early = ordered[:needed]
share = math.floor(100 * needed / TABLETS + 0.5)
print(f"return once {needed} of {TABLETS} tablets are scanned ({share}%): {early[-1][1]} ms, count {total([t for t, _ in early])} instead of {total(all_tablets)}")
