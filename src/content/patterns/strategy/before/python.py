# Without the pattern: one method, one branch per discount rule.
PERCENT20_FACTOR = 0.8  # 20% off: pay 80%
FLAT15_OFF = 15


def show(x):  # print whole numbers without ".0", like JS
    return str(int(x)) if float(x).is_integer() else str(x)


class Checkout:
    def total(self, prices, kind):
        total = sum(prices)
        if kind == "percent20":
            return total * PERCENT20_FACTOR
        if kind == "flat15":
            return max(0, total - FLAT15_OFF)
        # Every new promotion adds another branch right here.
        return total


checkout = Checkout()
cart = [30, 20]
print(show(checkout.total(cart, "regular")))
print(show(checkout.total(cart, "percent20")))
print(show(checkout.total(cart, "flat15")))
