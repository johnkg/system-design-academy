# Holding a seat without selling it twice in Python:
# a seat is claimed with one atomic step that checks and changes it together, and an unpaid hold expires by itself.
import sys

HOLD_SECONDS = 600


# The seat table. In a real database, claim() is one statement:
#   UPDATE seats SET holder = ?, expires = ? WHERE id = ? AND (holder IS NULL OR expires <= now)
class Seats:
    def __init__(self, ids):
        self.rows = {id: {"holder": None, "expires": 0, "paid": False} for id in ids}

    def claim(self, id, user, now):
        seat = self.rows[id]
        if seat["paid"]:
            return False
        if seat["holder"] is not None and seat["expires"] > now:
            return False  # someone else holds it, and the hold is still running
        seat["holder"], seat["expires"] = user, now + HOLD_SECONDS  # check and change in one step
        return True

    # Payment arrived. Only the current holder, before the hold ran out, may turn the hold into a sale.
    def confirm(self, id, user, now):
        seat = self.rows[id]
        if seat["paid"] or seat["holder"] != user or seat["expires"] <= now:
            return False
        seat["paid"] = True
        return True


# What goes wrong without it: check and change are two steps, and two buyers can both finish the first one.
def racy_sale(seats, id, buyers):
    seen = [seats[id]["owner"] is None for _ in buyers]  # every buyer reads the seat: it looks free
    for i, user in enumerate(buyers):  # then every buyer writes
        if seen[i]:
            seats[id]["owner"] = user
            seats[id]["sales"] += 1


racy = {"A1": {"owner": None, "sales": 0}}
racy_sale(racy, "A1", ["ann", "ben"])
print(f"without an atomic claim: A1 was sold {racy['A1']['sales']} times")

seats = Seats(["A1", "A2"])
t = 0
results = [
    ("ann claims A1", seats.claim("A1", "ann", t)),
    ("ben claims A1 at the same moment", seats.claim("A1", "ben", t)),
    ("ben claims A2", seats.claim("A2", "ben", t)),
]
t += 700  # ben never pays, and ten minutes pass
results.append(("ben tries to pay for A2 after his hold ran out", seats.confirm("A2", "ben", t)))
results.append(("cat claims A2, now free again", seats.claim("A2", "cat", t)))
results.append(("ann pays for A1 after 700 seconds", seats.confirm("A1", "ann", t)))
results.append(("cat pays for A2", seats.confirm("A2", "cat", t)))
for what, ok in results:
    print(f"{'yes' if ok else 'no '}  {what}")

expected = [True, False, True, False, True, False, True]
if racy["A1"]["sales"] != 2 or any(ok != expected[i] for i, (_, ok) in enumerate(results)):
    sys.exit(1)
