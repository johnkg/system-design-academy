# Factory Method in Python. Subclasses override create_transport().
from abc import ABC, abstractmethod


class Truck:  # Concrete Product
    def deliver(self, cargo):
        return f"Truck delivers {cargo} by road"


class Ship:  # Concrete Product
    def deliver(self, cargo):
        return f"Ship delivers {cargo} by sea"


class Logistics(ABC):  # Creator
    @abstractmethod
    def create_transport(self):  # the factory method
        ...

    def plan_delivery(self, cargo):  # shared logic, works with any Transport
        transport = self.create_transport()
        return transport.deliver(cargo)


class RoadLogistics(Logistics):  # Concrete Creator
    def create_transport(self):
        return Truck()


class SeaLogistics(Logistics):  # Concrete Creator
    def create_transport(self):
        return Ship()


for logistics in [RoadLogistics(), SeaLogistics()]:
    print(logistics.plan_delivery("40 crates"))  # same call, different product
