// Charging a card exactly once in JavaScript:
// an idempotency key makes retries safe, and every successful charge is recorded as two balanced ledger entries.

class TimeoutError extends Error {}

// A pretend payment provider. Like real ones it remembers the key of each charge, and its reply can be lost after the money moved.
class Provider {
  constructor() { this.charges = new Map(); this.loseNextReply = true; }
  charge(key, amountCents) {
    if (!this.charges.has(key)) this.charges.set(key, { id: `ch_${this.charges.size + 1}`, amountCents });
    if (this.loseNextReply) { this.loseNextReply = false; throw new TimeoutError('no reply'); } // the charge happened, the answer did not arrive
    return this.charges.get(key);
  }
}

class PaymentService {
  constructor(provider) { this.provider = provider; this.payments = new Map(); this.ledger = []; }

  pay({ key, amountCents }) {
    const existing = this.payments.get(key);
    if (existing && existing.state === 'succeeded') return existing; // a repeat of a finished request: same answer, no new charge
    const payment = existing ?? { id: `pay_${this.payments.size + 1}`, state: 'processing', amountCents };
    this.payments.set(key, payment); // saved BEFORE calling the provider, so a crash leaves a trace
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const charge = this.provider.charge(key, amountCents); // the same key on every attempt
        payment.state = 'succeeded'; payment.chargeId = charge.id;
        this.post(payment); // two entries that cancel out, written together
        return payment;
      } catch (e) {
        if (!(e instanceof TimeoutError)) throw e; // anything else is a real failure; only a timeout is worth retrying
      }
    }
    payment.state = 'unknown'; // never guess: a webhook or a status check settles it later
    return payment;
  }

  post(payment) {
    this.ledger.push({ payment: payment.id, account: 'provider_receivable', debit: payment.amountCents, credit: 0 });
    this.ledger.push({ payment: payment.id, account: 'revenue', debit: 0, credit: payment.amountCents });
  }
}

const provider = new Provider();
const service = new PaymentService(provider);

// The shopper's browser sends the same request three times (a timeout, then two double-clicks) with one key.
const results = [1, 2, 3].map(() => service.pay({ key: 'order-81-attempt-1', amountCents: 2599 }));

const debits = service.ledger.reduce((s, e) => s + e.debit, 0);
const credits = service.ledger.reduce((s, e) => s + e.credit, 0);
console.log(`requests: 3   payments created: ${service.payments.size}   provider charges: ${provider.charges.size}`);
console.log(`results: ${results.map((r) => `${r.id} ${r.state}`).join(', ')}`);
console.log(`ledger entries: ${service.ledger.length}   debits ${debits}   credits ${credits}`);
if (provider.charges.size !== 1 || service.payments.size !== 1 || service.ledger.length !== 2 || debits !== credits) process.exit(1);
