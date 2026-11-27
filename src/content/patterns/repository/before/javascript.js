// Without the pattern: the service writes SQL and reads rows itself.

const db = { // stand-in for a database connection
  rows: [
    { id: 1, customer: "ada", total: 40, status: "open" },
    { id: 2, customer: "grace", total: 25, status: "open" },
    { id: 3, customer: "ada", total: 15, status: "open" },
  ],
  query(sql, customer) {
    console.log(`SQL: ${sql}`);
    return this.rows.filter((r) => r.customer === customer && r.status === "open");
  },
};

class OrderService {
  listOpen(customer) {
    // The same query is copied into every service that needs orders.
    const rows = db.query("SELECT * FROM orders WHERE customer = ? AND status = 'open'", customer);
    console.log(`Open orders for ${customer}: ${rows.length}`);
    for (const r of rows) console.log(`  #${r.id} total ${r.total}`);
  }
}

new OrderService().listOpen("ada"); // needs a database to test; changing the store means editing this class
