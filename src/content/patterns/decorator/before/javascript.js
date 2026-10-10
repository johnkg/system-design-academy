// Without the pattern: a subclass for every combination.

class Espresso {
  description() { return "Espresso"; }
  cost() { return 2.0; }
}
class EspressoWithMilk extends Espresso {
  description() { return "Espresso, milk"; }
  cost() { return 2.5; }
}
class EspressoWithMocha extends Espresso {
  description() { return "Espresso, mocha"; }
  cost() { return 2.7; }
}
class EspressoWithMilkAndMocha extends Espresso {
  description() { return "Espresso, milk, mocha"; }
  cost() { return 3.2; }
}
// ...and EspressoWithWhip, EspressoWithMilkAndWhip, EspressoWithMochaAndWhip,
// EspressoWithMilkMochaAndWhip, EspressoWithDoubleMocha... Prices are copied everywhere.

const drink = new EspressoWithMilkAndMocha();
console.log(`${drink.description()} = $${drink.cost().toFixed(2)}`);
