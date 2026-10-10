// Decorator in JavaScript. Each add-on wraps another beverage.

class Espresso { // Concrete Component
  description() { return "Espresso"; }
  cost() { return 2.0; }
}

class AddOn { // Decorator: same interface, holds the wrapped beverage
  constructor(beverage) { this.beverage = beverage; }
  description() { return this.beverage.description(); }
  cost() { return this.beverage.cost(); }
}

class Milk extends AddOn { // Concrete Decorator
  description() { return `${this.beverage.description()}, milk`; }
  cost() { return this.beverage.cost() + 0.5; }
}

class Mocha extends AddOn { // Concrete Decorator
  description() { return `${this.beverage.description()}, mocha`; }
  cost() { return this.beverage.cost() + 0.7; }
}

class Whip extends AddOn { // Concrete Decorator
  description() { return `${this.beverage.description()}, whip`; }
  cost() { return this.beverage.cost() + 0.4; }
}

let drink = new Espresso();
drink = new Milk(drink);
drink = new Mocha(drink);
drink = new Mocha(drink); // double mocha: just wrap again
drink = new Whip(drink);

console.log(`${drink.description()} = $${drink.cost().toFixed(2)}`);
// Espresso, milk, mocha, mocha, whip = $4.30
