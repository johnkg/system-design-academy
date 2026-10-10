# Without the pattern: one method, one branch per discount rule.

def show(x):  # print whole numbers without ".0", like JS
    return str(int(x)) if float(x).is_integer() else str(x)


class Checkout:
    def total(self, prices, kind):
        total = sum(prices)
        if kind == "percent20":
            return total * 0.8
        if kind == "flat15":
            return max(0, total - 15)
        # Every new promotion adds another branch right here.
        return total


checkout = Checkout()
print(show(checkout.total([30, 20], "regular")))
print(show(checkout.total([30, 20], "percent20")))
print(show(checkout.total([30, 20], "flat15")))
