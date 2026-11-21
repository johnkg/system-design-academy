# Test Doubles and Over-Mocking: an order service tested with stubs, strict mocks, mocks of everything, fakes and a contract test.
# Look for: which of 6 real bugs each style catches, and how many harmless refactors each style breaks.
# The service reserves stock, charges a payment gateway and releases the stock if the card is declined.
# The REAL gateway wants charge(currency, amount, key) with a non-empty key. A hand-written fake follows the older rules (no key).
ORDER = [('pen', 150, 4), ('book', 1999, 1)]  # sku, price in cents, quantity: 2599 in total
STOCK = {'pen': 10, 'book': 5}
CONFIGS = [  # (name, flags, kind): a bug is behaviour that is wrong, a refactor changes only how the service does it
    ('Healthy service', {}, 'ok'),
    ('Charges dollars, not cents', {'dollars': 1}, 'bug'),
    ('Stock not released after a decline', {'noRelease': 1}, 'bug'),
    ('Charges once per line, not once per order', {'perLine': 1}, 'bug'),
    ('Charge arguments in the wrong order', {'swap': 1}, 'bug'),
    ('No idempotency key sent', {'noKey': 1}, 'bug'),
    ('Line totals added twice in the calculator', {'twice': 1}, 'bug'),
    ('Refactor: an extra stock lookup', {'extraLookup': 1}, 'refactor'),
    ('Refactor: one reserve call for the whole order', {'batch': 1}, 'refactor'),
]
STYLES = [  # (name, assumed cost units, gateway kind, mock the calculator, assertion kind)
    ('Stubs, assert the result', 2, 'stub', False, 'result'),
    ('Strict mocks, assert the calls', 4, 'mock', False, 'calls'),
    ('Mock everything, calculator too', 4, 'mock', True, 'calls'),
    ('Fakes, assert the state', 6, 'fake', False, 'state'),
    ('Fakes plus a contract test', 86, 'fake', False, 'state'),  # the contract test runs the real sandbox gateway: 40 units per test
]


class Gateway:
    def __init__(self, kind, decline):
        self.kind, self.decline, self.calls, self.charged = kind, decline, [], []

    def charge(self, cur, amt, key):
        self.calls.append(f'{cur}:{amt}')
        if self.kind in ('stub', 'mock'):
            return not self.decline                              # canned answer
        if cur != 'USD':
            return False                                         # fake and real both validate
        if not isinstance(amt, int) or amt <= 0:
            return False
        if self.kind == 'real' and not key:
            return False                                         # only the real one knows about keys
        if amt > (1000 if self.decline else 100000):
            return False
        self.charged.append(amt)
        return True


class Inventory:
    def __init__(self):
        self.stock, self.calls = dict(STOCK), []

    def reserve(self, sku, qty):
        self.calls.append(f'reserve {sku} {qty}')
        if self.stock[sku] < qty:
            return False
        self.stock[sku] -= qty
        return True

    def reserve_all(self, items):
        self.calls.append('reserveAll')
        for sku, qty in items:
            self.stock[sku] -= qty

    def release(self, sku, qty):
        self.calls.append(f'release {sku} {qty}')
        self.stock[sku] += qty

    def lookup(self, sku):
        self.calls.append(f'stock {sku}')
        return self.stock[sku]


def calculator(lines, twice):
    return sum(p * q for _, p, q in lines) * (2 if twice else 1)


def fixed_calculator(lines, twice):  # the "mock everything" style replaces even this
    return 2599


def place(order, gw, inv, calc, cfg):  # the code under test
    total = calc(order, bool(cfg.get('twice')))
    amount = total // 100 if cfg.get('dollars') else total
    if cfg.get('extraLookup'):
        for sku, _, _ in order:
            inv.lookup(sku)
    if cfg.get('batch'):
        inv.reserve_all([(sku, qty) for sku, _, qty in order])
    else:
        for sku, _, qty in order:
            inv.reserve(sku, qty)
    key = '' if cfg.get('noKey') else 'order-1'
    charges = [p * q for _, p, q in order] if cfg.get('perLine') else [amount]
    for a in charges:
        ok = gw.charge(a, 'USD', key) if cfg.get('swap') else gw.charge('USD', a, key)
        if not ok:
            if not cfg.get('noRelease'):
                for sku, _, qty in order:
                    inv.release(sku, qty)
            return 'declined'
    return 'ok'


def run_test(style, gw_kind, cfg, declines):
    """One test: place an order (or one that the gateway declines) and assert what the style asserts. True when it passes."""
    _, _, _, mock_calc, assertion = style
    gw, inv = Gateway(gw_kind, declines), Inventory()
    result = place(ORDER, gw, inv, fixed_calculator if mock_calc else calculator, cfg)
    expected = 'declined' if declines else 'ok'
    if result != expected:
        return False
    if assertion == 'result':
        return True
    if assertion == 'calls':
        want = ['reserve pen 4', 'reserve book 1'] + (['release pen 4', 'release book 1'] if declines else [])
        return ','.join(gw.calls) == 'USD:2599' and ','.join(inv.calls) == ','.join(want)
    stock_ok = (inv.stock['pen'] == 10 and inv.stock['book'] == 5) if declines else (inv.stock['pen'] == 6 and inv.stock['book'] == 4)
    return ','.join(str(c) for c in gw.charged) == ('' if declines else '2599') and stock_ok


def fails(style, cfg):
    failed = any(not run_test(style, style[2], cfg, d) for d in (False, True))
    if 'contract' in style[0]:
        failed = failed or any(not run_test(style, 'real', cfg, d) for d in (False, True))
    return failed


for style in STYLES:
    healthy = not fails(style, CONFIGS[0][1])
    bugs = [c for c in CONFIGS if c[2] == 'bug']
    refactors = [c for c in CONFIGS if c[2] == 'refactor']
    caught = [c for c in bugs if fails(style, c[1])]
    broken = [c for c in refactors if fails(style, c[1])]
    print(f"{style[0]}: healthy passes {str(healthy).lower()}, bugs caught {len(caught)}/{len(bugs)}, refactors that break tests {len(broken)}/{len(refactors)}, cost {style[1]}")
    missed = '; '.join(c[0] for c in bugs if not fails(style, c[1])) or 'none'
    print(f"  green but wrong in production: {missed}")
