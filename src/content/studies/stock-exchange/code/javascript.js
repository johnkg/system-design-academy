// An order book with price-time priority in JavaScript:
// the best price trades first, and among equal prices the order that arrived first trades first.

class OrderBook {
  constructor() { this.bids = []; this.asks = []; } // each side: price levels, best first; a level holds its orders in arrival order

  place({ id, side, price, qty }) {
    const trades = [];
    const opposite = side === 'buy' ? this.asks : this.bids;
    const crosses = (p) => (side === 'buy' ? p <= price : p >= price);
    while (qty > 0 && opposite.length > 0 && crosses(opposite[0].price)) {
      const level = opposite[0];
      const resting = level.orders[0]; // the oldest order at the best price
      const filled = Math.min(qty, resting.qty);
      trades.push({ buyer: side === 'buy' ? id : resting.id, seller: side === 'buy' ? resting.id : id, price: level.price, qty: filled }); // trades at the resting order's price
      qty -= filled; resting.qty -= filled;
      if (resting.qty === 0) level.orders.shift();
      if (level.orders.length === 0) opposite.shift();
    }
    if (qty > 0) this.rest(side, { id, price, qty });
    return trades;
  }

  rest(side, order) {
    const book = side === 'buy' ? this.bids : this.asks;
    const before = (a, b) => (side === 'buy' ? a > b : a < b); // is price a better than price b on this side?
    let i = 0;
    while (i < book.length && before(book[i].price, order.price)) i++;
    if (i < book.length && book[i].price === order.price) book[i].orders.push(order); // joins the back of the queue at its price
    else book.splice(i, 0, { price: order.price, orders: [order] });
  }

  depth(side) { return (side === 'buy' ? this.bids : this.asks).map((l) => `${l.orders.reduce((s, o) => s + o.qty, 0)}@${(l.price / 100).toFixed(2)}`).join(' '); }
}

// The same orders in the same order always give the same trades. Prices are whole cents.
const orders = [
  { id: 'A', side: 'sell', price: 1005, qty: 100 },
  { id: 'B', side: 'sell', price: 1005, qty: 50 },
  { id: 'C', side: 'sell', price: 1010, qty: 80 },
  { id: 'X', side: 'buy', price: 1000, qty: 60 },
  { id: 'D', side: 'buy', price: 1005, qty: 120 }, // takes all of A, then 20 of B: A arrived first
  { id: 'E', side: 'buy', price: 1010, qty: 200 }, // takes the rest of B, then C, and the leftover waits as a bid
];

function runAll() {
  const book = new OrderBook(); const all = [];
  for (const order of orders) all.push(...book.place(order));
  return { book, all };
}

const { book, all } = runAll();
for (const t of all) console.log(`trade: ${t.buyer} buys ${t.qty} from ${t.seller} at ${(t.price / 100).toFixed(2)}`);
console.log(`book after: bids ${book.depth('buy')} | asks ${book.depth('sell')}`);

const bought = all.reduce((s, t) => s + t.qty, 0);
const replay = JSON.stringify(runAll().all) === JSON.stringify(all);
const uncrossed = !book.bids.length || !book.asks.length || book.bids[0].price < book.asks[0].price;
console.log(`replayed from the same orders: identical trades ${replay}; best bid below best ask ${uncrossed}`);
if (bought !== 230 || !replay || !uncrossed || all[0].seller !== 'A' || all[1].seller !== 'B') process.exit(1);
