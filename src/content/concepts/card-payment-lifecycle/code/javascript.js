// The life of one card payment: authorize (a hold), capture (the charge, maybe partial), void, expiry, settlement, refund.
// Integer cents and whole days, a fixed script, so the output never changes. Fees and delays are illustrative settings.
const OPENING_AVAILABLE = 50000; // the cardholder's available balance before the order, in cents
const EXPIRY_DAYS = 7;           // an uncaptured hold is released after this many days
const SETTLE_DAYS = 2;           // captured money reaches the merchant this many days after the capture
const FEE_BP = 290;              // merchant fee: 2.90% of each capture, in basis points ...
const FEE_FIXED = 30;            // ... plus 30 cents per capture

function divRoundUp(num, den) { // half up, integers only
  const q = (num - (num % den)) / den;
  return 2 * (num - q * den) >= den ? q + 1 : q;
}

function newPayment() {
  const p = {
    day: 0, available: OPENING_AVAILABLE, held: 0, captured: 0, refunded: 0, fees: 0, pending: 0, settled: 0,
    authDay: -1, ended: '', endedDay: -1, due: [], // due: [day, net] of captured money still on its way to the merchant
  };
  const reject = (reason) => ({ ok: false, text: `rejected: ${reason}` });
  const ok = (text) => ({ ok: true, text });

  p.authorize = (amount) => {
    if (p.authDay >= 0) return reject('an authorization already exists for this order');
    if (p.available < amount) return reject(`the card has ${p.available} available, ${amount} needed`);
    p.available -= amount; p.held = amount; p.authDay = p.day;
    return ok(`hold of ${amount} placed, nothing charged yet`);
  };
  p.capture = (amount) => {
    if (p.authDay < 0) return reject('there is no authorization to capture');
    if (p.ended === 'expired') return reject(`the hold expired on day ${p.endedDay}`);
    if (p.ended === 'voided') return reject(`the authorization was voided on day ${p.endedDay}`);
    if (amount > p.held) return reject(`capture of ${amount} is above the ${p.held} still held`);
    const fee = divRoundUp(amount * FEE_BP, 10000) + FEE_FIXED;
    p.held -= amount; p.captured += amount; p.fees += fee; p.pending += amount - fee;
    p.due.push([p.day + SETTLE_DAYS, amount - fee]);
    return ok(`captured ${amount}, fee ${fee}, merchant will receive ${amount - fee} on day ${p.day + SETTLE_DAYS}`);
  };
  p.void = () => {
    if (p.held === 0) return reject('there is no hold left to release');
    p.available += p.held; const released = p.held; p.held = 0; p.ended = 'voided'; p.endedDay = p.day;
    return ok(`released the hold of ${released}`);
  };
  p.refund = (amount) => {
    const left = p.captured - p.refunded;
    if (amount > left) return reject(`refund of ${amount} is above the ${left} captured and not yet refunded`);
    p.refunded += amount; p.available += amount;
    return ok(`refunded ${amount} to the cardholder`);
  };
  p.advance = () => {
    p.day += 1;
    const notes = [];
    for (const d of p.due) if (d[1] > 0 && d[0] <= p.day) { p.pending -= d[1]; p.settled += d[1]; notes.push(`settled ${d[1]} to the merchant`); d[1] = 0; }
    if (p.held > 0 && p.day - p.authDay >= EXPIRY_DAYS) {
      p.available += p.held; notes.push(`hold expired, ${p.held} released`); p.held = 0; p.ended = 'expired'; p.endedDay = p.day;
    }
    return { ok: true, text: `day ${p.day}${notes.length ? ': ' + notes.join('; ') : ''}` };
  };
  return p;
}

function show(p) {
  return `  available ${p.available}, held ${p.held}, captured ${p.captured}, refunded ${p.refunded}, fees ${p.fees}, merchant pending ${p.pending}, settled ${p.settled}`;
}

function story(title, steps) {
  console.log(`-- ${title}`);
  const p = newPayment();
  for (const [label, fn] of steps) {
    const r = fn(p);
    console.log(`day ${p.day} ${label}: ${r.text}`);
  }
  console.log(show(p));
}

story('authorize, capture in full, settle, refund', [
  ['authorize 10000', (p) => p.authorize(10000)],
  ['advance', (p) => p.advance()],
  ['capture 10000', (p) => p.capture(10000)],
  ['advance', (p) => p.advance()],
  ['advance', (p) => p.advance()],
  ['refund 2500', (p) => p.refund(2500)],
  ['refund 10000', (p) => p.refund(10000)],
]);

story('partial capture, then the rest of the hold expires', [
  ['authorize 10000', (p) => p.authorize(10000)],
  ['capture 4000', (p) => p.capture(4000)],
  ...Array.from({ length: EXPIRY_DAYS }, () => ['advance', (p) => p.advance()]),
  ['capture 6000', (p) => p.capture(6000)],
]);

story('void an authorization', [
  ['authorize 10000', (p) => p.authorize(10000)],
  ['void', (p) => p.void()],
  ['capture 10000', (p) => p.capture(10000)],
  ['void', (p) => p.void()],
]);
