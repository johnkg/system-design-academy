// Strategy in JavaScript. A strategy is just a function: (total) => newTotal.

const regularPrice = (total) => total; // Concrete Strategy
const percentOff = (percent) => (total) => total * (1 - percent / 100); // Concrete Strategy
const flatOff = (amount) => (total) => Math.max(0, total - amount); // Concrete Strategy

class Checkout { // Context
  #strategy;

  constructor(strategy = regularPrice) { this.#strategy = strategy; }
  setStrategy(strategy) { this.#strategy = strategy; } // swap at runtime

  total(prices) {
    const sum = prices.reduce((a, b) => a + b, 0);
    return this.#strategy(sum); // delegate; Checkout never knows which rule runs
  }
}

const cart = [30, 20];
const checkout = new Checkout();
console.log(checkout.total(cart));        // 50

checkout.setStrategy(percentOff(20));
console.log(checkout.total(cart));        // 40

checkout.setStrategy(flatOff(15));
console.log(checkout.total(cart));        // 35
