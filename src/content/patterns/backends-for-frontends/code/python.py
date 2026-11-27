# Backends for Frontends in Python. Each client gets a small backend that shapes the shared services' data.


class OrderService:  # Shared service: business data, nothing client-specific
    def get(self, order_id: int) -> dict:
        return {"id": order_id, "customer_id": 1, "lines": [("apple", 1500), ("pear", 2500)], "total_cents": 4000}


class CustomerService:  # Shared service
    def get(self, customer_id: int) -> dict:
        return {"name": "Ada"}


def money(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


class MobileBff:  # Backend for the phone app: two fields, one service call
    def __init__(self, orders: OrderService) -> None:
        self.orders = orders
        self.calls = 0

    def get_order(self, order_id: int) -> str:
        self.calls += 1
        order = self.orders.get(order_id)
        return f"order {order['id']}, total {money(order['total_cents'])}"


class WebBff:  # Backend for the website: combines two services into one answer
    def __init__(self, orders: OrderService, customers: CustomerService) -> None:
        self.orders = orders
        self.customers = customers
        self.calls = 0

    def get_order(self, order_id: int) -> str:
        self.calls += 2
        order = self.orders.get(order_id)
        customer = self.customers.get(order["customer_id"])
        return f"order {order['id']} for {customer['name']}, {len(order['lines'])} lines, total {money(order['total_cents'])}"


orders = OrderService()
mobile = MobileBff(orders)
web = WebBff(orders, CustomerService())

print(f"mobile: {mobile.get_order(7)}, service calls: {mobile.calls}")
print(f"web: {web.get_order(7)}, service calls: {web.calls}")
