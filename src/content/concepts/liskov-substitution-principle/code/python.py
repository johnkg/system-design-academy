# Liskov Substitution Principle: a client written against a base type's contract, run against substitutes.
# Look for: which checks each subtype fails, and why. Every subtype is accepted by the language; only behaviour tells them apart.
# Bag contract: add(x) accepts any integer; after add(x), contains(x) is true and size() grew by 1;
# remove(x) takes one x out; size() always equals adds minus removes.


class Bag:  # the base type and its contract
    def add(self, x): raise NotImplementedError
    def remove(self, x): raise NotImplementedError
    def contains(self, x): raise NotImplementedError
    def size(self): raise NotImplementedError


class ListBag(Bag):  # honest: keeps every item, duplicates included
    def __init__(self, items):
        self.items = list(items)

    def add(self, x): self.items.append(x)

    def remove(self, x):
        if x in self.items:
            self.items.remove(x)

    def contains(self, x): return x in self.items
    def size(self): return len(self.items)


class DedupBag(ListBag):  # reused ListBag, but add ignores a value it already holds: postcondition weakened
    def add(self, x):
        if x not in self.items:
            super().add(x)


class PositiveBag(ListBag):  # reused ListBag, but add rejects what the base accepts: precondition strengthened
    def add(self, x):
        if x <= 0:
            raise ValueError("only positive numbers")
        super().add(x)


class ReadOnlyBag(ListBag):  # reused ListBag to get the reads, then switched off the writes
    def add(self, x):
        raise ValueError("read-only: add is not allowed")


class ReadOnlyView:  # composition: holds a list, offers only reading, and does not claim to be a Bag
    def __init__(self, items):
        self.items = list(items)

    def contains(self, x): return x in self.items
    def size(self): return len(self.items)


def fmt(v):
    return ("true" if v else "false") if isinstance(v, bool) else str(v)


# The client: each check gets a fresh bag and returns None when it holds, or why it failed.
def attempt(fn):
    try:
        return fn()
    except Exception as e:
        return f"threw '{e}'"


def expect(got, want):
    return None if fmt(got) == fmt(want) else f"got {fmt(got)}, expected {fmt(want)}"


def c1(b): b.add(-1); return None
def c2(b): b.add(5); return expect(b.contains(5), True)
def c3(b): b.add(5); b.add(5); return expect(b.size(), 2)
def c4(b): b.add(5); b.remove(5); return expect(f"{b.size()} {fmt(b.contains(5))}", "0 false")
def c5(b): b.add(1); b.add(1); b.add(2); b.remove(1); return expect(b.size(), 2)


WRITER_CHECKS = [
    ("C1 add accepts any integer, even -1", c1),
    ("C2 after add(5), contains(5)", c2),
    ("C3 two adds of 5 make size 2", c3),
    ("C4 add(5) then remove(5) leaves it empty", c4),
    ("C5 size is adds minus removes (3 adds, 1 remove)", c5),
]
READER_CHECKS = [
    ("R1 contains what it was built with", lambda r: expect(f"{fmt(r.contains(3))} {fmt(r.contains(9))}", "true false")),
    ("R2 size is the number of items", lambda r: expect(r.size(), 2)),
]


def run_client(title, checks, make, must_be, must_name):
    print(f"-- {title}")
    if must_be is not None and not isinstance(make(), must_be):
        print(f"   rejected: not a {must_name}, so this client cannot be given one")
        return
    passed = 0
    for label, check in checks:
        why = attempt(lambda: check(make()))
        if why is None:
            passed += 1
        print(f"   {label}: {'pass' if why is None else 'FAIL, ' + why}")
    print(f"   {passed}/{len(checks)} checks pass")


print("== Bag contract, writer client")
run_client("ListBag (honest)", WRITER_CHECKS, lambda: ListBag([]), Bag, "Bag")
run_client("DedupBag (add ignores duplicates)", WRITER_CHECKS, lambda: DedupBag([]), Bag, "Bag")
run_client("PositiveBag (add rejects numbers up to 0)", WRITER_CHECKS, lambda: PositiveBag([]), Bag, "Bag")
run_client("ReadOnlyBag (inherited, add throws)", WRITER_CHECKS, lambda: ReadOnlyBag([]), Bag, "Bag")
run_client("ReadOnlyView (composition)", WRITER_CHECKS, lambda: ReadOnlyView([]), Bag, "Bag")
print("== Bag contract, reader client")
run_client("ReadOnlyBag (inherited)", READER_CHECKS, lambda: ReadOnlyBag([3, 4]), None, "")
run_client("ReadOnlyView (composition)", READER_CHECKS, lambda: ReadOnlyView([3, 4]), None, "")


# Rectangle contract: setWidth and setHeight change only their own side; area is width times height.
class Rectangle:
    def __init__(self, w, h):
        self.w, self.h = w, h

    def set_width(self, w): self.w = w
    def set_height(self, h): self.h = h
    def width(self): return self.w
    def area(self): return self.w * self.h


class InheritedSquare(Rectangle):  # a square "is a" rectangle, so it inherits and keeps its sides equal
    def __init__(self, s):
        super().__init__(s, s)

    def set_width(self, w): self.w = w; self.h = w
    def set_height(self, h): self.w = h; self.h = h


class SquareShape:  # composition: a square with a side and an area, not claiming to be a Rectangle
    def __init__(self, s):
        self.s = s

    def area(self): return self.s * self.s


def q1(r): r.set_width(5); r.set_height(4); return expect(r.area(), 20)
def q2(r): r.set_width(5); r.set_height(4); return expect(r.width(), 5)
def q3(r): r.set_width(3); return expect(r.width(), 3)


RECT_CHECKS = [
    ("Q1 setWidth(5), setHeight(4): area is 20", q1),
    ("Q2 setHeight(4) leaves the width at 5", q2),
    ("Q3 setWidth(3) reads back as 3", q3),
]
SHAPE_CHECKS = [("S1 a shape with sides of 3 has area 9", lambda s: expect(s.area(), 9))]
print("== Rectangle contract, client of Rectangle")
run_client("Rectangle (honest)", RECT_CHECKS, lambda: Rectangle(1, 1), Rectangle, "Rectangle")
run_client("InheritedSquare (setters change both sides)", RECT_CHECKS, lambda: InheritedSquare(1), Rectangle, "Rectangle")
run_client("SquareShape (composition)", RECT_CHECKS, lambda: SquareShape(1), Rectangle, "Rectangle")
print("== Shape contract, client that only asks for the area")
run_client("Rectangle", SHAPE_CHECKS, lambda: Rectangle(3, 3), None, "")
run_client("InheritedSquare", SHAPE_CHECKS, lambda: InheritedSquare(3), None, "")
run_client("SquareShape (composition)", SHAPE_CHECKS, lambda: SquareShape(3), None, "")
