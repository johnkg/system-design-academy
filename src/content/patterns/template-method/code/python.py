# Template Method in Python. prepare() fixes the order; subclasses fill in steps.
from abc import ABC, abstractmethod


class Beverage(ABC):  # Abstract Class
    def prepare(self):  # the template method: do not override
        self.boil_water()
        self.brew()
        self.pour()
        if self.wants_condiments():
            self.add_condiments()

    def boil_water(self):  # shared step
        print("Boiling water")

    def pour(self):  # shared step
        print("Pouring into cup")

    @abstractmethod
    def brew(self):  # variable step
        ...

    @abstractmethod
    def add_condiments(self):
        ...

    def wants_condiments(self):  # hook: optional override
        return True


class Tea(Beverage):  # Concrete Class
    def brew(self):
        print("Steeping the tea bag")

    def add_condiments(self):
        print("Adding lemon")


class Coffee(Beverage):  # Concrete Class
    def brew(self):
        print("Dripping coffee through the filter")

    def add_condiments(self):
        print("Adding sugar and milk")

    def wants_condiments(self):  # this coffee is served black
        return False


Tea().prepare()
print("---")
Coffee().prepare()
