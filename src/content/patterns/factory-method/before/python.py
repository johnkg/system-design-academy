# Without the pattern: the planner decides and builds the transport itself.


class Truck:
    def deliver(self, cargo):
        return f"Truck delivers {cargo} by road"


class Ship:
    def deliver(self, cargo):
        return f"Ship delivers {cargo} by sea"


def plan_delivery(kind, cargo):
    if kind == "road":
        transport = Truck()  # knows every concrete class
    elif kind == "sea":
        transport = Ship()
    else:
        raise ValueError(f"Unknown delivery kind: {kind}")
    # Want air delivery? Edit this function, and every other place with this if/else.
    return transport.deliver(cargo)


print(plan_delivery("road", "40 crates"))
print(plan_delivery("sea", "40 crates"))
