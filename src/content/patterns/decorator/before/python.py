# Without the pattern: a subclass for every combination.


class Espresso:
    def description(self):
        return "Espresso"

    def cost(self):
        return 2.0


class EspressoWithMilk(Espresso):
    def description(self):
        return "Espresso, milk"

    def cost(self):
        return 2.5


class EspressoWithMocha(Espresso):
    def description(self):
        return "Espresso, mocha"

    def cost(self):
        return 2.7


class EspressoWithMilkAndMocha(Espresso):
    def description(self):
        return "Espresso, milk, mocha"

    def cost(self):
        return 3.2


# ...and EspressoWithWhip, EspressoWithMilkAndWhip, EspressoWithMochaAndWhip,
# EspressoWithMilkMochaAndWhip, EspressoWithDoubleMocha... Prices are copied everywhere.

drink = EspressoWithMilkAndMocha()
print(f"{drink.description()} = ${drink.cost():.2f}")
