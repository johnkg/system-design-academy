# Composition over inheritance. Part 1 is the fragile base class: a subclass that counts the units added to an army works
# until the base class changes how addAll is implemented, while a wrapper that holds an army does not care. Part 2 composes a
# unit from parts and counts, for a game whose units may combine any movement abilities with one attack style, how many
# classes each design needs. Look for: the count changing with no edit to the subclass, and the class counts as abilities grow.


class ArmyV1:
    def __init__(self):
        self.units = []

    def add(self, u):
        self.units.append(u)

    def add_all(self, us):
        for u in us:
            self.add(u)


class ArmyV2:
    def __init__(self):
        self.units = []

    def add(self, u):
        self.units.append(u)

    def add_all(self, us):  # "faster": no longer calls add
        self.units.extend(us)


def counting(base):  # inheritance: counts by overriding both entry points
    class Counting(base):
        def __init__(self):
            super().__init__()
            self.count = 0

        def add(self, u):
            self.count += 1
            super().add(u)

        def add_all(self, us):
            self.count += len(us)
            super().add_all(us)

    return Counting


class CountingArmy:  # composition: holds an army, forwards to it, counts what it forwards
    def __init__(self, inner):
        self.inner = inner
        self.count = 0

    def add(self, u):
        self.count += 1
        self.inner.add(u)

    def add_all(self, us):
        self.count += len(us)
        self.inner.add_all(us)


for label, base in [("base v1 (addAll calls add)", ArmyV1), ("base v2 (addAll no longer calls add)", ArmyV2)]:
    sub = counting(base)()
    sub.add_all(["archer", "knight"])
    wrapped = CountingArmy(base())
    wrapped.add_all(["archer", "knight"])
    print(f"{label}: inheritance added {len(sub.units)}, counted {sub.count}; composition added {len(wrapped.inner.units)}, counted {wrapped.count}")

# A unit composed from parts: a list of movement behaviours and one attack behaviour.
walk, swim, fly = ("walk", 2), ("swim", 3), ("fly", 5)
melee, ranged = ("melee", 6), ("ranged", 4)


class Unit:
    def __init__(self, name, moves, attack):
        self.name, self.moves, self.attack = name, moves, attack

    def describe(self):
        return f"{self.name}: {', '.join(f'{n} {s}' for n, s in self.moves)}; {self.attack[0]} {self.attack[1]}"


print(Unit("duck", [walk, swim, fly], ranged).describe())
print(Unit("frog", [walk, swim], melee).describe())


# Part 2: M movement abilities, A attack styles, and a game that needs every combination (any non-empty set of movements, one attack).
# Single inheritance: a class gets one parent, which can supply only one behaviour; the others are written again in the class.
def types(m, a):
    return (2 ** m - 1) * a


DESIGNS = {
    "deep inheritance": lambda m, a: (1 + types(m, a), a * m * 2 ** (m - 1), 1 + types(m, a), 2 ** m * a),
    "composition": lambda m, a: (3 + m + a, 0, 1, 1),                 # Unit, 2 interfaces, one class per behaviour
    "shallow inheritance plus composition": lambda m, a: (5 + m + a, 0, 3, 1),  # plus 2 real subclasses of Unit
}
for m, a in [(2, 2), (3, 2), (4, 2), (6, 2), (6, 4)]:
    print(f"-- {m} movement abilities, {a} attack styles: {types(m, a)} unit types")
    for name, f in DESIGNS.items():
        classes, dup, affected, add = f(m, a)
        print(f"  {name}: {classes} classes, {dup} copies of ability code, {affected} classes hit by a base change, {add} classes to add one ability")
