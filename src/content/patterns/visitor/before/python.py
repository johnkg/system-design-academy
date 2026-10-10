# Without the pattern: every operation is a method on every shape.
import math


def show(x):  # format a value like Node's console.log
    if isinstance(x, str):
        return f"'{x}'"
    return str(int(x)) if float(x).is_integer() else repr(x)


def show_list(values):
    return "[ " + ", ".join(show(v) for v in values) + " ]"


class Circle:
    def __init__(self, radius):
        self.radius = radius

    def area(self):
        return math.pi * self.radius ** 2

    def perimeter(self):
        return 2 * math.pi * self.radius

    def describe(self):
        return f"circle r={self.radius}"
    # to_json(), to_svg(), draw()... every new operation lands here


class Rectangle:
    def __init__(self, width, height):
        self.width = width
        self.height = height

    def area(self):
        return self.width * self.height

    def perimeter(self):
        return 2 * (self.width + self.height)

    def describe(self):
        return f"rectangle {self.width}x{self.height}"
    # ...and here, and in every other shape class


shapes = [Circle(2), Rectangle(3, 4)]
print(show_list([s.area() for s in shapes]), show_list([s.perimeter() for s in shapes]),
      show_list([s.describe() for s in shapes]))
# Add a Triangle: easy. Add to_svg(): edit every shape. The alternative, isinstance chains,
# silently ignores any shape you forgot.
