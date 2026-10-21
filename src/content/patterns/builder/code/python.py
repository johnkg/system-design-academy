# Builder in Python. A fluent builder with defaults and validation in build().
from dataclasses import dataclass

MAX_TOPPINGS = 4


@dataclass(frozen=True)
class Pizza:  # Product
    size: str
    crust: str
    toppings: tuple[str, ...]
    extra_sauce: bool

    def describe(self):
        extras = ", extra sauce" if self.extra_sauce else ""
        toppings = ", ".join(self.toppings) or "no toppings"
        return f"{self.size} {self.crust} pizza with {toppings}{extras}"


class PizzaBuilder:  # Builder
    def __init__(self):
        self._size = "medium"
        self._crust = "thin"
        self._toppings = []
        self._extra_sauce = False

    def size(self, value):
        self._size = value
        return self

    def crust(self, value):
        self._crust = value
        return self

    def add_topping(self, name):
        self._toppings.append(name)
        return self

    def extra_sauce(self):
        self._extra_sauce = True
        return self

    def build(self):
        if len(self._toppings) > MAX_TOPPINGS:
            raise ValueError("Too many toppings (max 4)")
        return Pizza(self._size, self._crust, tuple(self._toppings), self._extra_sauce)


class PizzaMenu:  # Director: stores recipes
    @staticmethod
    def margherita(builder):
        return builder.size("medium").add_topping("mozzarella").add_topping("basil").build()


custom = PizzaBuilder().size("large").crust("thick").add_topping("ham").add_topping("olives").extra_sauce().build()
print(custom.describe())
print(PizzaMenu.margherita(PizzaBuilder()).describe())
