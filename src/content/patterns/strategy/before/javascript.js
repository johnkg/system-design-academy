// Without the pattern: one method, one branch per discount rule.
const PERCENT20_FACTOR = 0.8; // 20% off: pay 80%
const FLAT15_OFF = 15;

class Checkout {
  total(prices, kind) {
    const sum = prices.reduce((a, b) => a + b, 0);
    if (kind === "percent20") return sum * PERCENT20_FACTOR;
    if (kind === "flat15") return Math.max(0, sum - FLAT15_OFF);
    // Every new promotion adds another branch right here.
    return sum;
  }
}

const checkout = new Checkout();
const cart = [30, 20];
console.log(checkout.total(cart, "regular"));
console.log(checkout.total(cart, "percent20"));
console.log(checkout.total(cart, "flat15"));
