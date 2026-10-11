# A shopping cart that merges without losing items, in Python:
# an add-wins observed-remove set for the items and a PN-counter for the quantities, compared with two simpler merge rules.
import sys


class Replica:
    def __init__(self, rid, source=None):
        self.id = rid
        self.n = source.n if source else 0                          # counter used to make unique add tags
        self.tags = dict(source.tags) if source else {}             # tag -> item, one tag per add operation
        self.amount = dict(source.amount) if source else {}         # tag -> quantity added by that operation
        self.dead = set(source.dead) if source else set()           # tags that a remove has seen (tombstones)
        self.dec = dict(source.dec) if source else {}               # "tag|replica" -> units taken away (a PN-counter's negative half)

    def add(self, item, q=1):
        t = f"{self.id}#{self.n}"
        self.n += 1
        self.tags[t] = item
        self.amount[t] = q

    def left(self, t):
        return self.amount[t] - sum(v for k, v in self.dec.items() if k.split("|")[0] == t)

    def live(self, item):
        return [t for t, i in self.tags.items() if i == item and t not in self.dead]

    def qty(self, item):
        return sum(self.left(t) for t in self.live(item))

    # More of an item is a new add (so a concurrent remove cannot cancel it); fewer takes units off a tag this replica can see.
    def adjust(self, item, d):
        if d > 0:
            self.add(item, d)
            return
        k = f"{next(t for t in self.live(item) if self.left(t) > 0)}|{self.id}"
        self.dec[k] = self.dec.get(k, 0) - d

    # A remove only covers the add tags this replica has seen.
    def remove(self, item):
        self.dead.update(self.live(item))

    # Union of tags and tombstones, and the larger value for every counter: order and repeats do not matter.
    def merge(self, other):
        r = Replica("M", self)
        r.tags.update(other.tags)
        r.amount.update(other.amount)
        r.dead |= other.dead
        for k, v in other.dec.items():
            r.dec[k] = max(r.dec.get(k, 0), v)
        return r

    def view(self):
        items = sorted(set(self.tags.values()))
        return {i: self.qty(i) for i in items if self.qty(i) > 0}

    def size(self):
        return len(self.tags) + len(self.amount) + len(self.dead) + len(self.dec)


def show(c):
    return " ".join(f"{i}:{q}" for i, q in c.items())


def listing(a):
    return ",".join(a) if a else "-"


def compare(got, want):
    lost = [i for i in want if i not in got]
    back = [i for i in got if i not in want]
    wrong = [i for i in got if i in want and got[i] != want[i]]
    return f"lost={listing(lost)} back={listing(back)} wrong={listing(wrong)}", not (lost or back or wrong)


# The shared cart, then a partition: a phone and a laptop each change their own copy.
phone = Replica("A")
phone.add("book", 2); phone.add("pen"); phone.add("lamp")
laptop = Replica("B", phone)
phone.remove("pen"); phone.add("mug"); phone.adjust("book", 2)       # phone: drop pen, add mug, book 2 -> 4
laptop.remove("lamp"); laptop.add("pen"); laptop.adjust("book", -1)  # laptop: drop lamp, one more pen (unseen by the phone's remove), book 2 -> 1
intended = {"book": 3, "mug": 1, "pen": 1}                           # the phone's remove only covered the pen it had seen, so the new pen stays

a, b = phone.view(), laptop.view()
lww = b                                                              # the laptop's clock was later, so its whole cart wins
union = {}
for c in (a, b):
    for i, q in c.items():
        union[i] = max(union.get(i, 0), q)
union = dict(sorted(union.items()))
merged = phone.merge(laptop)

print(f"intended: {show(intended)}")
for name, cart in (("last write wins", lww), ("union of items", union), ("add-wins set + counters", merged.view())):
    print(f"{name:<24} {show(cart):<26} {compare(cart, intended)[0]}")
flip, again = laptop.merge(phone), merged.merge(laptop)
order_free = show(flip.view()) == show(merged.view()) and show(again.view()) == show(merged.view())
print(f"merge order and repeats do not matter: {str(order_free).lower()}; metadata entries: {merged.size()}")
if not compare(merged.view(), intended)[1] or compare(lww, intended)[1] or compare(union, intended)[1] or not order_free:
    sys.exit(1)
