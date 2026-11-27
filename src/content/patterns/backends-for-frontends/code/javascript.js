// Backends for Frontends in JavaScript. Each client gets a small backend that shapes the shared services' data.

class OrderService { // Shared service: business data, nothing client-specific
  get(id) {
    return { id, customerId: 1, lines: [{ item: "apple", cents: 1500 }, { item: "pear", cents: 2500 }], totalCents: 4000 };
  }
}
class CustomerService { // Shared service
  get() { return { name: "Ada" }; }
}

const money = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

class MobileBff { // Backend for the phone app: two fields, one service call
  constructor(orders) { this.orders = orders; this.calls = 0; }
  getOrder(id) {
    this.calls += 1;
    const order = this.orders.get(id);
    return `order ${order.id}, total ${money(order.totalCents)}`;
  }
}

class WebBff { // Backend for the website: combines two services into one answer
  constructor(orders, customers) { this.orders = orders; this.customers = customers; this.calls = 0; }
  getOrder(id) {
    this.calls += 2;
    const order = this.orders.get(id);
    const customer = this.customers.get(order.customerId);
    return `order ${order.id} for ${customer.name}, ${order.lines.length} lines, total ${money(order.totalCents)}`;
  }
}

const orders = new OrderService();
const mobile = new MobileBff(orders);
const web = new WebBff(orders, new CustomerService());

console.log(`mobile: ${mobile.getOrder(7)}, service calls: ${mobile.calls}`);
console.log(`web: ${web.getOrder(7)}, service calls: ${web.calls}`);
