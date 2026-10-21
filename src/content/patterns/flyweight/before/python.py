# Without the pattern: every tree carries its own copy of the species data.


class Tree:
    def __init__(self, x, y, name, color, texture):
        self.x = x
        self.y = y
        self.name = name
        self.color = color
        self.texture = texture  # texture duplicated per tree


TREES, TEXTURE_CHARS = 1000, 10_000
trees = []
for i in range(TREES):
    oak = i % 2
    trees.append(Tree(i, i * 2, "Oak" if oak else "Pine", "green" if oak else "dark green", "x" * TEXTURE_CHARS))

print(f"{len(trees)} trees, each with its own 10,000-character texture field")
# Memory scales with the number of trees, not the number of species.
