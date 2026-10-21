# Flyweight in Python. Trees share one TreeType per species.
from dataclasses import dataclass

TEXTURE_SIZE = 10_000  # characters in one species' texture
TREES = 1000


@dataclass(frozen=True)
class TreeType:  # Flyweight: intrinsic, immutable, shared
    name: str
    color: str
    texture: str

    def draw(self, x, y):
        return f"{self.name} ({self.color}) at {x},{y}"


class TreeTypeFactory:  # Flyweight Factory
    _cache = {}

    @classmethod
    def get(cls, name, color, texture):
        key = f"{name}|{color}"
        if key not in cls._cache:
            cls._cache[key] = TreeType(name, color, texture)
        return cls._cache[key]

    @classmethod
    def count(cls):
        return len(cls._cache)


class Tree:  # Context: extrinsic state (x, y) + a reference to the shared type
    def __init__(self, x, y, tree_type):
        self.x = x
        self.y = y
        self.type = tree_type

    def draw(self):
        return self.type.draw(self.x, self.y)


class Forest:  # Client
    def __init__(self):
        self._trees = []

    def plant(self, x, y, name, color):
        tree_type = TreeTypeFactory.get(name, color, "x" * TEXTURE_SIZE)  # big texture, created once per species
        self._trees.append(Tree(x, y, tree_type))

    @property
    def size(self):
        return len(self._trees)


forest = Forest()
for i in range(TREES):
    forest.plant(i, i * 2, "Oak" if i % 2 else "Pine", "green" if i % 2 else "dark green")
print(f"{forest.size} trees, {TreeTypeFactory.count()} shared TreeType objects")
