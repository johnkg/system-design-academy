// Without the pattern: one method, one branch per discount rule.

class Checkout {
  total(prices, kind) {
    const sum = prices.reduce((a, b) => a + b, 0);
    if (kind === "percent20") return sum * 0.8;
    if (kind === "flat15") return Math.max(0, sum - 15);
    // Every new promotion adds another branch right here.
    return sum;
  }
}

const checkout = new Checkout();
console.log(checkout.total([30, 20], "regular"));
console.log(checkout.total([30, 20], "percent20"));
console.log(checkout.total([30, 20], "flat15"));
