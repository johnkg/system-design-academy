// Tokenization and audit scope: which of your systems ever see a card number, and what a token is.
// A fixed list of 8 components, three ways to take a card, and a toy token vault. Only integers and fixed text are printed.
const COMPONENTS = ['Checkout page', 'Web server', 'App API', 'Payment service', 'Database', 'Log pipeline', 'Backups', 'Analytics warehouse'];

// design: 'form'     your page has the card form and posts the number to your server
//         'hosted'   your page embeds fields served by the provider; the number goes from the browser to the provider
//         'redirect' the customer pays on the provider's own page; you only get the result back
// o: store (keep the card number or token in your database), logBodies (log full request bodies),
//    backups (back up the database), warehouse (copy the database into analytics)
function analyze(design, o) {
  const inScope = COMPONENTS.map(() => false);
  const atRest = [];
  if (design === 'form') {
    inScope[0] = inScope[1] = inScope[2] = inScope[3] = true; // the number is typed into, sent through and processed by these
    if (o.store) { inScope[4] = true; atRest.push(COMPONENTS[4]); }
    if (o.logBodies) { inScope[5] = true; atRest.push(COMPONENTS[5]); }
    if (o.store && o.backups) { inScope[6] = true; atRest.push(COMPONENTS[6]); }
    if (o.store && o.warehouse) { inScope[7] = true; atRest.push(COMPONENTS[7]); }
  } else if (design === 'hosted') {
    inScope[0] = true; // your page serves the code around the provider's fields, so it can still affect them
  }
  const count = inScope.filter(Boolean).length;
  const serverSide = inScope.slice(1).some(Boolean);
  const audit = serverSide ? 'heavy' : count > 0 ? 'light' : 'lightest';
  return { inScope, count, atRest, audit };
}

// Luhn check: catches a mistyped number before it is sent anywhere.
function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
const mask = (pan) => pan.slice(0, 6) + '*'.repeat(pan.length - 10) + pan.slice(-4);

// A toy vault: the token comes from a counter-like generator, so it has no mathematical link to the number.
function makeVault(seed) {
  let state = seed;
  const map = new Map();
  return {
    tokenize(pan) { state = (state * 48271) % 2147483647; const token = 'tok_' + String(state).padStart(10, '0'); map.set(token, pan); return token; },
    detokenize(token) { return map.has(token) ? map.get(token) : null; },
  };
}

console.log('-- card number checks');
const pan = '4111111111111111'; // a well-known test number
console.log(`${mask(pan)} has ${pan.length} digits, last 4 ${pan.slice(-4)}, Luhn valid ${luhnValid(pan) ? 1 : 0}`);
console.log(`one digit changed: Luhn valid ${luhnValid('4111111111111112') ? 1 : 0}`);

console.log('-- token vault');
const providerVault = makeVault(987654), otherVault = makeVault(7);
const t1 = providerVault.tokenize(pan), t2 = providerVault.tokenize(pan);
console.log(`two tokens for the same card: ${t1} and ${t2}, equal ${t1 === t2 ? 1 : 0}`);
console.log(`provider resolves ${t1}: ${providerVault.detokenize(t1) === pan ? 'the card' : 'nothing'}`);
console.log(`another merchant's vault resolves ${t1}: ${otherVault.detokenize(t1) === null ? 'nothing' : 'the card'}`);
console.log(`your database holds: token ${t1}, last4 ${pan.slice(-4)}, expiry 12/2030 (no number)`);

console.log('-- scope for 8 components');
const cases = [
  ['form, nothing stored or logged', 'form', {}],
  ['form, number stored', 'form', { store: true }],
  ['form, number stored and request bodies logged', 'form', { store: true, logBodies: true }],
  ['form, stored, logged, backed up, copied to analytics', 'form', { store: true, logBodies: true, backups: true, warehouse: true }],
  ['hosted fields, token stored, bodies logged, backed up', 'hosted', { store: true, logBodies: true, backups: true, warehouse: true }],
  ['redirect, token stored, bodies logged, backed up', 'redirect', { store: true, logBodies: true, backups: true, warehouse: true }],
];
for (const [label, design, o] of cases) {
  const r = analyze(design, o);
  const names = COMPONENTS.filter((_, i) => r.inScope[i]).join(', ') || 'none';
  console.log(`${label}: ${r.count} of ${COMPONENTS.length} in scope (${names}); numbers at rest in ${r.atRest.length ? r.atRest.join(', ') : 'none'}; audit ${r.audit}`);
}
