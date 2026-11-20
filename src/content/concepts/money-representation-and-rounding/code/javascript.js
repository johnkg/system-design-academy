// Money as integers: minor units, one rounding rule, one rounding point, and exact splitting.
// Every printed value is an integer or a yes/no flag, so the three languages print identical text.

// A cart of 6 lines: price in cents, quantity. Subtotal is 17808 cents.
const LINES = [[1410, 3], [2585, 1], [2507, 1], [3009, 1], [705, 3], [1681, 2]];

// Divide num by den (both integers, den > 0) and round the result to a whole number with an explicit rule.
function divRound(num, den, mode) {
  const q = (num - (num % den)) / den;
  const r = num - q * den;
  if (mode === 'trunc') return q;
  if (2 * r > den) return q + 1;
  if (2 * r < den) return q;
  return mode === 'up' ? q + 1 : (q % 2 === 0 ? q : q + 1); // an exact tie: half up, or half even (banker's)
}

// The same rounding written the way float code usually does it: multiply the dollars by 100 and look at the fraction.
function floatRound(dollars, mode) {
  const x = dollars * 100;
  const f = Math.floor(x);
  const d = x - f;
  let cents;
  if (mode === 'trunc') cents = f;
  else if (d > 0.5) cents = f + 1;
  else if (d < 0.5) cents = f;
  else cents = mode === 'up' ? f + 1 : (f % 2 === 0 ? f : f + 1);
  return cents / 100;
}

// Integer cart: rate in basis points (1000 = 10.00%). Tax is rounded per line or once on the subtotal.
function integerCart(bp, point, mode) {
  let subtotal = 0, tax = 0;
  for (const [price, qty] of LINES) {
    subtotal += price * qty;
    if (point === 'line') tax += divRound(price * qty * bp, 10000, mode);
  }
  if (point === 'total') tax = divRound(subtotal * bp, 10000, mode);
  return { subtotal, tax, total: subtotal + tax };
}

// Float cart: prices held as dollars in binary floating point. Only the final answer is turned back into cents to print it.
function floatCart(bp, point, mode) {
  const rate = bp / 10000;
  let subtotal = 0, tax = 0;
  for (const [price, qty] of LINES) {
    const net = (price / 100) * qty;
    subtotal += net;
    if (point === 'line') tax += floatRound(net * rate, mode);
  }
  if (point === 'total') tax = floatRound(subtotal * rate, mode);
  return { tax: Math.round(tax * 100), total: Math.round((subtotal + tax) * 100) };
}

// Split an amount by weights so the parts add up exactly: floor each share, then hand the leftover cents to the
// largest fractional remainders (ties go to the earlier part).
function allocate(amount, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((amount * w) / sum));
  const rem = weights.map((w) => (amount * w) % sum);
  let left = amount - parts.reduce((a, b) => a + b, 0);
  const order = weights.map((_, i) => i).sort((a, b) => rem[b] - rem[a] || a - b);
  for (const i of order) { if (left === 0) break; parts[i] += 1; left -= 1; }
  return parts;
}

// Convert minor units between currencies: the rate is held as an integer (rateE4 = rate x 10000), and we round once.
function convert(minor, fromExp, toExp, rateE4, mode) {
  return divRound(minor * rateE4 * 10 ** toExp, 10 ** fromExp * 10000, mode);
}

// Show a minor-unit amount with its currency's exponent: 1234 is 12.34 in USD, 1234 in JPY, 1.234 in KWD.
function show(minor, exp) {
  if (exp === 0) return String(minor);
  const p = 10 ** exp;
  return `${Math.floor(minor / p)}.${String(minor % p).padStart(exp, '0')}`;
}

console.log('-- binary floating point');
const a = 0.1, b = 0.2, c = 0.3;
let ten = 0, tenCents = 0;
for (let i = 0; i < 10; i++) { ten += a; tenCents += 10; }
console.log(`0.1 + 0.2 equals 0.3: ${a + b === c ? 1 : 0}`);
console.log(`ten times 0.1 equals 1: ${ten === 1 ? 1 : 0}; ten times 10 cents equals 100: ${tenCents === 100 ? 1 : 0}`);
const price = 1.005;
console.log(`1.005 to cents, half up: float ${Math.floor(price * 100 + 0.5)}, integer ${divRound(1005, 10, 'up')}`);

console.log('-- minor units and exponents');
console.log(`1234 in USD (exponent 2): ${show(1234, 2)}; JPY (0): ${show(1234, 0)}; KWD (3): ${show(1234, 3)}`);

console.log('-- cart: 6 lines, subtotal 17808 cents');
for (const bp of [1000, 2000]) {
  for (const point of ['line', 'total']) {
    for (const mode of ['up', 'even', 'trunc']) {
      const i = integerCart(bp, point, mode), f = floatCart(bp, point, mode);
      console.log(`rate ${bp} bp, round per ${point}, ${mode === 'trunc' ? 'truncated' : 'half ' + mode}: integer tax ${i.tax} total ${i.total}; float total ${f.total}; float is off by ${f.total - i.total}`);
    }
  }
}

console.log('-- splitting');
for (const n of [3, 6]) {
  const each = divRound(10000, n, 'up');
  const naive = n * each;
  const parts = allocate(10000, Array(n).fill(1));
  console.log(`10000 cents ${n} ways: naive ${each} each adds up to ${naive} (off by ${naive - 10000}); allocated ${parts.join(' + ')} = ${parts.reduce((x, y) => x + y, 0)}`);
}
console.log(`10001 cents by weights 5:3:2: ${allocate(10001, [5, 3, 2]).join(' + ')}`);

console.log('-- converting the 6 line amounts (illustrative rates, rounded half up)');
for (const [name, toExp, rateE4] of [['EUR', 2, 9137], ['JPY', 0, 1492500], ['KWD', 3, 3074]]) {
  const eachLine = LINES.reduce((s, [p, q]) => s + convert(p * q, 2, toExp, rateE4, 'up'), 0);
  const once = convert(17808, 2, toExp, rateE4, 'up');
  console.log(`${name}: convert each line then add ${eachLine}; add then convert once ${once}; difference ${eachLine - once}`);
}
