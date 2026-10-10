// Without the pattern: checkout knows every vendor's API and units.

class CardGateway {
  pay(dollars) { return `Card charged $${dollars.toFixed(2)}`; }
}
class LegacyBankApi {
  makePayment(cents, currency) { return { ok: true, ref: `LB-${cents}${currency}` }; }
}

function checkout(provider, amount) {
  if (provider === "card") {
    console.log(new CardGateway().pay(amount));
  } else if (provider === "legacy") {
    // Unit conversion and result handling copied wherever the bank is used.
    const result = new LegacyBankApi().makePayment(Math.round(amount * 100), "USD");
    console.log(result.ok ? `Paid $${amount.toFixed(2)} (ref ${result.ref})` : "Payment failed");
  }
  // Another provider? Another branch, with its own units and quirks.
}

checkout("card", 25);
checkout("legacy", 25);
