# Visitor in Python. Operations live in visitors; shapes only know accept().
import math


def show(x):  # format a value like Node's console.log
    if isinstance(x, str):
        return f"'{x}'"
    return str(int(x)) if float(x).is_integer() else repr(x)


def show_list(values):
    return "[ " + ", ".join(show(v) for v in values) + " ]"


class Circle:  # Concrete Element
    def __init__(self, radius):
        self.radius = radius

    def accept(self, visitor):
        return visitor.visit_circle(self)  # double dispatch


class Rectangle:  # Concrete Element
    def __init__(self, width, height):
        self.width = width
        self.height = height

    def accept(self, visitor):
        return visitor.visit_rectangle(self)


class AreaVisitor:  # Concrete Visitor: one operation across all shapes
    def visit_circle(self, c):
        return math.pi * c.radius ** 2

    def visit_rectangle(self, r):
        return r.width * r.height


class PerimeterVisitor:  # Concrete Visitor
    def visit_circle(self, c):
        return 2 * math.pi * c.radius

    def visit_rectangle(self, r):
        return 2 * (r.width + r.height)


class DescribeVisitor:  # A brand new operation: shapes were not touched
    def visit_circle(self, c):
        return f"circle r={c.radius}"

    def visit_rectangle(self, r):
        return f"rectangle {r.width}x{r.height}"


shapes = [Circle(2), Rectangle(3, 4)]
for visitor in [AreaVisitor(), PerimeterVisitor(), DescribeVisitor()]:
    print(type(visitor).__name__, show_list([s.accept(visitor) for s in shapes]))
