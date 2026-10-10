// Adapter in JavaScript. The adapter speaks pay(dollars) and translates for the legacy API.

class CardGateway { // Target implementation: already speaks pay(dollars)
  pay(dollars) { return `Card charged $${dollars.toFixed(2)}`; }
}

class LegacyBankApi { // Adaptee: third-party, cannot be changed
  makePayment(cents, currency) {
    return { ok: true, ref: `LB-${cents}${currency}` };
  }
}

class LegacyBankAdapter { // Adapter
  #bank;
  constructor(bank) { this.#bank = bank; }

  pay(dollars) {
    const cents = Math.round(dollars * 100);            // translate units
    const result = this.#bank.makePayment(cents, "USD"); // translate the call
    return result.ok                                     // translate the result
      ? `Paid $${dollars.toFixed(2)} (ref ${result.ref})`
      : "Payment failed";
  }
}

function checkout(gateway, amount) { // Client: only knows pay(dollars)
  console.log(gateway.pay(amount));
}

checkout(new CardGateway(), 25);
checkout(new LegacyBankAdapter(new LegacyBankApi()), 25);
