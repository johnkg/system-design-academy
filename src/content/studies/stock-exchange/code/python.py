# An order book with price-time priority in Python:
# the best price trades first, and among equal prices the order that arrived first trades first.
import sys


class OrderBook:
    def __init__(self):
        self.bids = []  # each side: price levels, best first; a level holds its orders in arrival order
        self.asks = []

    def place(self, id, side, price, qty):
        trades = []
        opposite = self.asks if side == "buy" else self.bids

        def crosses(p):
            return p <= price if side == "buy" else p >= price

        while qty > 0 and opposite and crosses(opposite[0]["price"]):
            level = opposite[0]
            resting = level["orders"][0]  # the oldest order at the best price
            filled = min(qty, resting["qty"])
            # trades at the resting order's price
            trades.append({
                "buyer": id if side == "buy" else resting["id"],
                "seller": resting["id"] if side == "buy" else id,
                "price": level["price"],
                "qty": filled,
            })
            qty -= filled
            resting["qty"] -= filled
            if resting["qty"] == 0:
                level["orders"].pop(0)
            if not level["orders"]:
                opposite.pop(0)
        if qty > 0:
            self.rest(side, {"id": id, "price": price, "qty": qty})
        return trades

    def rest(self, side, order):
        book = self.bids if side == "buy" else self.asks

        def before(a, b):  # is price a better than price b on this side?
            return a > b if side == "buy" else a < b

        i = 0
        while i < len(book) and before(book[i]["price"], order["price"]):
            i += 1
        if i < len(book) and book[i]["price"] == order["price"]:
            book[i]["orders"].append(order)  # joins the back of the queue at its price
        else:
            book.insert(i, {"price": order["price"], "orders": [order]})

    def depth(self, side):
        book = self.bids if side == "buy" else self.asks
        return " ".join(f"{sum(o['qty'] for o in l['orders'])}@{l['price'] / 100:.2f}" for l in book)


# The same orders in the same order always give the same trades. Prices are whole cents.
orders = [
    {"id": "A", "side": "sell", "price": 1005, "qty": 100},
    {"id": "B", "side": "sell", "price": 1005, "qty": 50},
    {"id": "C", "side": "sell", "price": 1010, "qty": 80},
    {"id": "X", "side": "buy", "price": 1000, "qty": 60},
    {"id": "D", "side": "buy", "price": 1005, "qty": 120},  # takes all of A, then 20 of B: A arrived first
    {"id": "E", "side": "buy", "price": 1010, "qty": 200},  # takes the rest of B, then C, and the leftover waits as a bid
]


def run_all():
    book = OrderBook()
    all_trades = []
    for order in orders:
        all_trades.extend(book.place(**order))
    return book, all_trades


book, all_trades = run_all()
for t in all_trades:
    print(f"trade: {t['buyer']} buys {t['qty']} from {t['seller']} at {t['price'] / 100:.2f}")
print(f"book after: bids {book.depth('buy')} | asks {book.depth('sell')}")

bought = sum(t["qty"] for t in all_trades)
replay = run_all()[1] == all_trades
uncrossed = not book.bids or not book.asks or book.bids[0]["price"] < book.asks[0]["price"]
print(f"replayed from the same orders: identical trades {str(replay).lower()}; best bid below best ask {str(uncrossed).lower()}")
if bought != 230 or not replay or not uncrossed or all_trades[0]["seller"] != "A" or all_trades[1]["seller"] != "B":
    sys.exit(1)
