# Double-entry bookkeeping: an immutable journal of balanced entries, balances derived from it, corrections as reversals.
# A second design keeps one mutable balance column per account, to show what it loses. Amounts are integer cents.
# An amount on a line is signed: positive is a debit, negative is a credit. A valid entry sums to zero.
ACCOUNTS = ["cash_at_bank", "customer_wallet", "merchant_payable", "fees_revenue"]


class Books:
    def __init__(self):
        self.journal = []  # append only: entries are never edited or deleted
        self.column = {a: 0 for a in ACCOUNTS}  # the "balance column updated in place" design
        self.log = []

    def post(self, memo, lines, reverses=0):
        """Journal design: reject an entry whose debits and credits differ, otherwise append it."""
        debits = sum(amt for _, amt in lines if amt > 0)
        credits = -sum(amt for _, amt in lines if amt < 0)
        if debits != credits:
            self.log.append(f'rejected "{memo}": debits {debits} but credits {credits}, difference {debits - credits}')
            return False
        self.journal.append({"id": len(self.journal) + 1, "memo": memo, "lines": lines, "reverses": reverses})
        text = ", ".join(f"{'Dr' if amt > 0 else 'Cr'} {acct} {abs(amt)}" for acct, amt in lines)
        self.log.append(f'posted #{len(self.journal)} "{memo}": {text}')
        return True

    def balance(self, account):
        return sum(amt for e in self.journal for acct, amt in e["lines"] if acct == account)

    def apply_in_place(self, lines):
        """Column design: read the balance, add the change, write it back. It has no entries to check anything against."""
        for acct, amt in lines:
            self.column[acct] += amt

    def concurrent_in_place(self, a, b):
        """Two operations at the same time in the column design: both read before either writes, so the second write wins."""
        snapshot = dict(self.column)
        for lines in (a, b):
            for acct, amt in lines:
                self.column[acct] = snapshot[acct] + amt


def card_payment(amount, fee):
    return [("cash_at_bank", amount), ("merchant_payable", -(amount - fee)), ("fees_revenue", -fee)]


def negate(lines):
    return [(acct, -amt) for acct, amt in lines]


books = Books()


def run(memo, lines):
    books.post(memo, lines)
    books.apply_in_place(lines)


run("card payment 100.00, fee 3.00", card_payment(10000, 300))

# Two card payments at the same moment. The journal appends both. The balance column loses one.
a, b = card_payment(10000, 300), card_payment(10000, 300)
books.post("card payment 100.00, fee 3.00 (A)", a)
books.post("card payment 100.00, fee 3.00 (B)", b)
books.concurrent_in_place(a, b)

# An entry that does not balance: the journal refuses it. The column design applies it and nobody notices.
bad = [("cash_at_bank", 5000), ("merchant_payable", -4900)]
books.post("deliberately unbalanced entry", bad)
books.apply_in_place(bad)

run("refund of the first payment 100.00 (fee returned)", [("merchant_payable", 9700), ("fees_revenue", 300), ("cash_at_bank", -10000)])

owed = -books.balance("merchant_payable")
run("payout of everything owed to the merchant", [("merchant_payable", owed), ("cash_at_bank", -owed)])

run("wallet top-up 50.00", [("cash_at_bank", 5000), ("customer_wallet", -5000)])

# A correction is a new entry that reverses the old one. The old entry stays in the journal.
last = books.journal[-1]
books.post(f"reversal of #{last['id']}", negate(last["lines"]), last["id"])
books.apply_in_place(negate(last["lines"]))

print("-- journal")
for line in books.log:
    print(line)
print(f"entries in the journal: {len(books.journal)}")

print("-- balances (debit positive, credit negative)")
total = column_total = lost = 0
for acct in ACCOUNTS:
    j, c = books.balance(acct), books.column[acct]
    total += j
    column_total += c
    lost += abs(j - c)
    print(f"{acct}: journal {j}, balance column {c}, {'same' if j == c else f'column differs by {c - j}'}")
print(f"trial balance: journal {total}, balance column {column_total}")
print(f"money the balance column got wrong: {lost}")
