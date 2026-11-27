# Repository in Python. The service sees a collection of orders, not a database.
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class Order:  # Entity
    id: int
    customer: str
    total: int
    status: str = "open"

    def cancel(self) -> None:
        self.status = "cancelled"


class OrderRepository(Protocol):  # Repository
    def add(self, order: Order) -> None: ...
    def get(self, order_id: int) -> Order: ...
    def find_open_for(self, customer: str) -> list[Order]: ...


class InMemoryOrderRepository:  # Concrete repository: the only place that knows how orders are stored
    def __init__(self) -> None:
        self._orders: dict[int, Order] = {}

    def add(self, order: Order) -> None:
        self._orders[order.id] = order

    def get(self, order_id: int) -> Order:
        return self._orders[order_id]

    def find_open_for(self, customer: str) -> list[Order]:
        return [o for o in self._orders.values() if o.customer == customer and o.status == "open"]


class SqlOrderRepository:  # Another concrete repository: the service is not edited to use it
    def __init__(self) -> None:
        self._rows: dict[int, Order] = {}

    def add(self, order: Order) -> None:
        self._rows[order.id] = order

    def get(self, order_id: int) -> Order:
        return self._rows[order_id]

    def find_open_for(self, customer: str) -> list[Order]:
        print(f"SQL: SELECT * FROM orders WHERE customer = '{customer}' AND status = 'open'")
        return [o for o in self._rows.values() if o.customer == customer and o.status == "open"]


class OrderService:  # Client: depends on the repository's methods only
    def __init__(self, orders: OrderRepository) -> None:
        self.orders = orders

    def list_open(self, customer: str) -> None:
        open_orders = self.orders.find_open_for(customer)
        print(f"Open orders for {customer}: {len(open_orders)}")
        for o in open_orders:
            print(f"  #{o.id} total {o.total}")

    def cancel(self, order_id: int) -> None:
        order = self.orders.get(order_id)
        order.cancel()
        print(f"Order #{order_id} is now {order.status}")


orders = InMemoryOrderRepository()
orders.add(Order(1, "ada", 40))
orders.add(Order(2, "grace", 25))
orders.add(Order(3, "ada", 15))

service = OrderService(orders)
service.list_open("ada")
service.cancel(1)
service.list_open("ada")

print("--- same service, SQL repository ---")
sql_orders = SqlOrderRepository()
sql_orders.add(Order(1, "ada", 40))
sql_orders.add(Order(2, "grace", 25))
sql_orders.add(Order(3, "ada", 15))
OrderService(sql_orders).list_open("ada")
