"""Pub/sub in Python: a topic with consumer groups. Each group gets every message; inside a group
the message goes to just one member (the members share the work)."""


class Topic:
    def __init__(self):
        self._groups = {}  # group name -> {"members": [(name, handler)], "next": int}

    def subscribe(self, group, name, handler):
        g = self._groups.setdefault(group, {"members": [], "next": 0})
        g["members"].append((name, handler))

    def publish(self, message):  # the publisher neither knows nor waits for the subscribers
        for group, g in self._groups.items():
            name, handler = g["members"][g["next"] % len(g["members"])]  # round robin inside the group
            g["next"] += 1
            handler(message, f"{group}/{name}")


def handle(message, who):
    print(f"[{who}] handled {message}")


topic = Topic()

topic.subscribe("email", "worker-1", handle)
topic.subscribe("inventory", "worker-1", handle)
topic.subscribe("inventory", "worker-2", handle)  # a second instance shares the inventory group's work
topic.subscribe("analytics", "worker-1", handle)

for order_id in ["order-1", "order-2"]:
    topic.publish(order_id)

topic.subscribe("fraud-check", "worker-1", handle)  # added later: the publisher is unchanged
topic.publish("order-3")
