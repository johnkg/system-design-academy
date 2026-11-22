# Least astonishment and interface design. Part 1 runs four real interfaces, each in a version that invites misuse and one that
# does not, against a caller who guessed from the names: positional boolean flags, a destructive default, a getter with a hidden
# side effect, and a name that hides an in-place change. Part 2 is a small model of 20 callers who read names only (level 0), the
# signature (level 1) or the docs (level 2), and counts mistaken calls and damage per design. Look for: each caller doing what
# the name suggested while the code did something else, and the over-explicit design that trades surprise for noise.

# 1. Positional boolean flags: the caller means header=yes, compress=no.
ROWS = [("tea", 3), ("milk", 12)]


def export_bad(rows, compress, header):
    lines = [f"{n},{q}" for n, q in rows]
    if header:
        lines.insert(0, "name,qty")
    s = "|".join(lines)
    return "gz:" + s if compress else s


def export_good(rows, *, header=False, compress=False):
    return export_bad(rows, compress, header)


print(f"flags: export(rows, true, false) gave '{export_bad(ROWS, True, False)}'; named call gave "
      f"'{export_good(ROWS, header=True, compress=False)}'")


# 2. Surprising default: the caller deletes a directory they believe is empty.
def delete_bad(fs, path, recursive=True):
    gone = [p for p in fs if p.startswith(path + "/")]
    for p in gone:
        del fs[p]
    return f"deleted {len(gone)} files"


def delete_good(fs, path, recursive=False):
    inside = [p for p in fs if p.startswith(path + "/")]
    if inside and not recursive:
        return f"refused: {len(inside)} files inside"
    for p in inside:
        del fs[p]
    return f"deleted {len(inside)} files"


fs1 = {"/a/x": "1", "/a/y": "2", "/b/z": "3"}
fs2 = dict(fs1)
print(f"default: delete('/a') {delete_bad(fs1, '/a')}, {len(fs1)} left; safe default {delete_good(fs2, '/a')}, {len(fs2)} left")


# 3. Hidden side effect: the caller checks whether a user exists.
def get_user_bad(users, name):  # creates the user when missing
    if name not in users:
        users.append(name)
    return name


def find_user(users, name):
    return name if name in users else None


u1, u2 = ["ann", "bob", "cy"], ["ann", "bob", "cy"]
e1 = get_user_bad(u1, "zed") is not None
e2 = find_user(u2, "zed") is not None
print(f"side effect: get_user('zed') says exists {str(e1).lower()} and users are now {len(u1)}; "
      f"find_user says exists {str(e2).lower()} and users stay {len(u2)}")


# 4. A name that hides an in-place change: the caller expects a sorted copy.
def get_sorted_bad(xs):
    xs.sort()
    return xs


def sorted_copy(xs):
    return sorted(xs)


l1, l2 = [3, 1, 2], [3, 1, 2]
get_sorted_bad(l1)
sorted_copy(l2)
print(f"name: after get_sorted the caller's list is {','.join(map(str, l1))}; after sorted_copy it is {','.join(map(str, l2))}")

# Part 2. 20 callers per team, as counts at attention level 0 (names only), 1 (signature), 2 (documentation).
# A hazard is noticed only by a caller who reads at least `need` levels deep: flags need 1, the others 2.
# inviting: callers below `need` are surprised. least astonishing: the name, type or default shows the hazard, need 0.
# over-explicit: every option must be spelled out, so nobody is surprised by a default, but callers who only read names
#   paste the dangerous settings (weight 3 or more) from the nearest example.
TEAMS = {"careful": [0, 5, 15], "mixed": [8, 8, 4], "hurried": [16, 3, 1]}
HAZARDS = [("flags", 1, 1), ("default", 2, 5), ("side effect", 2, 3), ("name", 2, 2)]  # (label, need, damage if it bites)


def astonished(design, team, need, weight):
    counts = TEAMS[team]
    if design == "inviting":
        return sum(counts[:need])
    if design == "least":
        return 0
    return counts[0] if weight >= 3 else 0


def words(design, flags, present):
    if design == "inviting":
        return 2 + (2 if flags else 0)
    return 2 if design == "least" else 2 + 3 * present


for team in ["careful", "mixed", "hurried"]:
    for design in ["inviting", "least", "over"]:
        mistaken = sum(astonished(design, team, n, w) for _, n, w in HAZARDS)
        damage = sum(astonished(design, team, n, w) * w for _, n, w in HAZARDS)
        print(f"{team} team, {design}: mistaken calls {mistaken}, damage {damage}, arguments per call {words(design, True, 4)}")
for name, need, weight in HAZARDS:
    a = astonished("inviting", "mixed", need, weight)
    print(f"mixed team, {name} alone: {a} surprised, damage {a * weight}")
