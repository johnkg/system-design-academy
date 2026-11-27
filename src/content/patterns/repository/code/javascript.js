// Repository in JavaScript. The service sees a collection of orders, not a database.

class Order {
  constructor(id, customer, total) { Object.assign(this, { id, customer, total, status: "open" }); }
  cancel() { this.status = "cancelled"; }
}

class InMemoryOrderRepository { // Concrete repository: the only place that knows how orders are stored
  #orders = new Map();
  add(order) { this.#orders.set(order.id, order); }
  get(id) { return this.#orders.get(id); }
  findOpenFor(customer) {
    return [...this.#orders.values()].filter((o) => o.customer === customer && o.status === "open");
  }
}

class OrderService { // Client: depends on the repository's methods only
  constructor(orders) { this.orders = orders; }
  listOpen(customer) {
    const open = this.orders.findOpenFor(customer);
    console.log(`Open orders for ${customer}: ${open.length}`);
    for (const o of open) console.log(`  #${o.id} total ${o.total}`);
  }
  cancel(id) {
    const order = this.orders.get(id);
    order.cancel();
    console.log(`Order #${id} is now ${order.status}`);
  }
}

const orders = new InMemoryOrderRepository();
orders.add(new Order(1, "ada", 40));
orders.add(new Order(2, "grace", 25));
orders.add(new Order(3, "ada", 15));

const service = new OrderService(orders);
service.listOpen("ada");
service.cancel(1);
service.listOpen("ada");
