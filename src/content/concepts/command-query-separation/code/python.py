# Command-Query Separation: a cart total and a ticket counter, built three ways.
# Look for: reads that change state (a total that spends a coupon), and the race that appears when a combined
# "read then change" is split into two calls with nothing making them atomic.
# Cart: subtotal 100, a one-time coupon worth 10, so the right total is 90 every time it is read.
# Tickets: the counter starts at 7; two workers each take one ticket at the same moment.


class MixedCart:  # total() reads AND spends the coupon the first time it is called
    def __init__(self):
        self.coupon = 10

    def total(self):
        t = 100
        if self.coupon > 0:
            t -= self.coupon
            self.coupon = 0
        return t


class SeparatedCart:  # apply_coupon() is the command, total() is a pure query
    def __init__(self):
        self.discount = 0

    def apply_coupon(self):
        self.discount = 10

    def total(self):
        return 100 - self.discount


class MixedCounter:  # next_ticket() changes and returns in one step: no other worker can slip in between
    def __init__(self):
        self.n = 7

    def next_ticket(self):
        v = self.n
        self.n += 1
        return v


class StrictCounter:  # peek() is a query, advance() is a command; taking a ticket needs both calls
    def __init__(self):
        self.n = 7

    def peek(self):
        return self.n

    def advance(self):
        self.n += 1


DESIGNS = ["Mixed everywhere", "Strict separation everywhere", "Separated, with a named atomic exception"]


def cart_run(design, situation):
    """Situation 1 and 2: the page reads the total; situation 2 adds one debug log line that reads it first."""
    reads = 3 if situation == 1 else 4
    shown = []
    changed = 0
    if design == 0:
        c = MixedCart()
        for _ in range(reads):
            before = c.coupon
            shown.append(c.total())
            if c.coupon != before:
                changed += 1
    else:
        c = SeparatedCart()
        c.apply_coupon()  # one explicit command at checkout
        for _ in range(reads):
            shown.append(c.total())
    page = shown if situation == 1 else shown[1:]  # the log line is the first read in situation 2
    distinct = len(set(page))
    wrong = len([v for v in page if v != 90])  # the right total is 90
    return page, changed, distinct, wrong


def ticket_run(design):
    """Situation 3: two workers each take a ticket. Atomic operations run whole; split calls interleave A1 B1 A2 B2."""
    if design == 1:
        c = StrictCounter()
        a = c.peek()
        b = c.peek()
        c.advance()
        c.advance()
        issued = [a, b]
        counter = c.n
    else:
        c = MixedCounter()  # design 0 and design 2 (take_ticket) behave the same here
        issued = [c.next_ticket(), c.next_ticket()]
        counter = c.n
    distinct = len(set(issued))
    return issued, counter, len(issued) - distinct, (counter - 7) - distinct, 2 if design == 1 else 1


for d in range(3):
    print(f"== {DESIGNS[d]}")
    for s in (1, 2):
        page, changed, distinct, wrong = cart_run(d, s)
        label = "page reads total 3 times" if s == 1 else "page plus one debug log read"
        print(f"  {label}: page shows {', '.join(map(str, page))}; reads that changed state: {changed}; distinct totals on the page: {distinct}; page reads showing a wrong total: {wrong}")
    issued, counter, duplicates, skipped, calls = ticket_run(d)
    print(f"  two workers take a ticket: issued {', '.join(map(str, issued))}; counter ends at {counter}; duplicates: {duplicates}; numbers skipped: {skipped}; calls per ticket: {calls}")
