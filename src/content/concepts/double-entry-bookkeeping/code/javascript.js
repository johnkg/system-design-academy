// Double-entry bookkeeping: an immutable journal of balanced entries, balances derived from it, corrections as reversals.
// A second design keeps one mutable balance column per account, to show what it loses. Amounts are integer cents.
// An amount on a line is signed: positive is a debit, negative is a credit. A valid entry sums to zero.
const ACCOUNTS = ['cash_at_bank', 'customer_wallet', 'merchant_payable', 'fees_revenue'];

function makeBooks() {
  const journal = [];                                   // append only: entries are never edited or deleted
  const column = Object.fromEntries(ACCOUNTS.map((a) => [a, 0])); // the "balance column updated in place" design
  const log = [];

  // Journal design: reject an entry whose debits and credits differ, otherwise append it.
  function post(memo, lines, reverses = 0) {
    const debits = lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
    const credits = -lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0);
    if (debits !== credits) { log.push(`rejected "${memo}": debits ${debits} but credits ${credits}, difference ${debits - credits}`); return false; }
    journal.push({ id: journal.length + 1, memo, lines, reverses });
    log.push(`posted #${journal.length} "${memo}": ${lines.map((l) => `${l.amount > 0 ? 'Dr' : 'Cr'} ${l.account} ${Math.abs(l.amount)}`).join(', ')}`);
    return true;
  }
  const balance = (account) => journal.reduce((s, e) => s + e.lines.filter((l) => l.account === account).reduce((t, l) => t + l.amount, 0), 0);

  // Column design: read the balance, add the change, write it back. It has no entries to check anything against.
  const applyInPlace = (lines) => { for (const l of lines) column[l.account] += l.amount; };

  // Two operations at the same time in the column design: both read before either writes, so the second write wins.
  function concurrentInPlace(a, b) {
    const snapshot = { ...column };
    const write = (lines) => { for (const l of lines) column[l.account] = snapshot[l.account] + l.amount; };
    write(a); write(b);
  }

  return { journal, column, log, post, balance, applyInPlace, concurrentInPlace };
}

const cardPayment = (amount, fee) => [
  { account: 'cash_at_bank', amount },
  { account: 'merchant_payable', amount: -(amount - fee) },
  { account: 'fees_revenue', amount: -fee },
];
const negate = (lines) => lines.map((l) => ({ account: l.account, amount: -l.amount }));

const books = makeBooks();
const run = (memo, lines) => { books.post(memo, lines); books.applyInPlace(lines); };

run('card payment 100.00, fee 3.00', cardPayment(10000, 300));

// Two card payments at the same moment. The journal appends both. The balance column loses one.
{
  const a = cardPayment(10000, 300), b = cardPayment(10000, 300);
  books.post('card payment 100.00, fee 3.00 (A)', a);
  books.post('card payment 100.00, fee 3.00 (B)', b);
  books.concurrentInPlace(a, b);
}

// An entry that does not balance: the journal refuses it. The column design applies it and nobody notices.
{
  const bad = [{ account: 'cash_at_bank', amount: 5000 }, { account: 'merchant_payable', amount: -4900 }];
  books.post('deliberately unbalanced entry', bad);
  books.applyInPlace(bad);
}

run('refund of the first payment 100.00 (fee returned)', [
  { account: 'merchant_payable', amount: 9700 },
  { account: 'fees_revenue', amount: 300 },
  { account: 'cash_at_bank', amount: -10000 },
]);

const owed = -books.balance('merchant_payable');
run(`payout of everything owed to the merchant`, [
  { account: 'merchant_payable', amount: owed },
  { account: 'cash_at_bank', amount: -owed },
]);

run('wallet top-up 50.00', [{ account: 'cash_at_bank', amount: 5000 }, { account: 'customer_wallet', amount: -5000 }]);

// A correction is a new entry that reverses the old one. The old entry stays in the journal.
{
  const last = books.journal[books.journal.length - 1];
  books.post(`reversal of #${last.id}`, negate(last.lines), last.id);
  books.applyInPlace(negate(last.lines));
}

console.log('-- journal');
for (const line of books.log) console.log(line);
console.log(`entries in the journal: ${books.journal.length}`);

console.log('-- balances (debit positive, credit negative)');
let total = 0, columnTotal = 0, lost = 0;
for (const a of ACCOUNTS) {
  const j = books.balance(a), c = books.column[a];
  total += j; columnTotal += c; lost += Math.abs(j - c);
  console.log(`${a}: journal ${j}, balance column ${c}, ${j === c ? 'same' : `column differs by ${c - j}`}`);
}
console.log(`trial balance: journal ${total}, balance column ${columnTotal}`);
console.log(`money the balance column got wrong: ${lost}`);
