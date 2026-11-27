# Without the pattern: the service writes SQL and reads rows itself.

class Db:  # stand-in for a database connection
    rows = [
        {"id": 1, "customer": "ada", "total": 40, "status": "open"},
        {"id": 2, "customer": "grace", "total": 25, "status": "open"},
        {"id": 3, "customer": "ada", "total": 15, "status": "open"},
    ]

    def query(self, sql, customer):
        print(f"SQL: {sql}")
        return [r for r in self.rows if r["customer"] == customer and r["status"] == "open"]


db = Db()


class OrderService:
    def list_open(self, customer):
        # The same query is copied into every service that needs orders.
        rows = db.query("SELECT * FROM orders WHERE customer = ? AND status = 'open'", customer)
        print(f"Open orders for {customer}: {len(rows)}")
        for r in rows:
            print(f"  #{r['id']} total {r['total']}")


OrderService().list_open("ada")  # needs a database to test; changing the store means editing this class
