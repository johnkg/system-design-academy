# Decorator in Python. Each add-on wraps another beverage.
from abc import ABC, abstractmethod


class Beverage(ABC):  # Component
    @abstractmethod
    def description(self) -> str: ...

    @abstractmethod
    def cost(self) -> float: ...


class Espresso(Beverage):  # Concrete Component
    def description(self):
        return "Espresso"

    def cost(self):
        return 2.0


class AddOn(Beverage):  # Decorator: same interface, holds the wrapped beverage
    def __init__(self, beverage):
        self.beverage = beverage

    def description(self):
        return self.beverage.description()

    def cost(self):
        return self.beverage.cost()


class Milk(AddOn):  # Concrete Decorator
    def description(self):
        return f"{self.beverage.description()}, milk"

    def cost(self):
        return self.beverage.cost() + 0.5


class Mocha(AddOn):  # Concrete Decorator
    def description(self):
        return f"{self.beverage.description()}, mocha"

    def cost(self):
        return self.beverage.cost() + 0.7


class Whip(AddOn):  # Concrete Decorator
    def description(self):
        return f"{self.beverage.description()}, whip"

    def cost(self):
        return self.beverage.cost() + 0.4


drink = Espresso()
drink = Milk(drink)
drink = Mocha(drink)
drink = Mocha(drink)  # double mocha: just wrap again
drink = Whip(drink)

print(f"{drink.description()} = ${drink.cost():.2f}")
# Espresso, milk, mocha, mocha, whip = $4.30
