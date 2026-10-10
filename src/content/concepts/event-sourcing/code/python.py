# Event sourcing in Python: state is derived from an append-only list of events.


class Account:
    def __init__(self):
        self._events = []
        self.balance = 0

    @staticmethod
    def rebuild(events, from_snapshot=None):  # replay events on top of a snapshot
        from_snapshot = from_snapshot or {"balance": 0, "version": 0}
        account = Account()
        account.balance = from_snapshot["balance"]
        account._events = events[: from_snapshot["version"]]
        for event in events[from_snapshot["version"]:]:
            account._record(event)
        return account

    def deposit(self, amount):
        self._record({"type": "Deposited", "amount": amount})

    def withdraw(self, amount):  # a command is validated against current state before an event is recorded
        if amount > self.balance:
            raise ValueError("insufficient funds")
        self._record({"type": "Withdrawn", "amount": amount})

    @property
    def events(self):  # callers cannot modify history
        return list(self._events)

    def _record(self, event):
        self._events.append(event)
        self._apply(event)

    def _apply(self, event):
        self.balance += event["amount"] if event["type"] == "Deposited" else -event["amount"]


account = Account()
account.deposit(100)
account.withdraw(30)
account.deposit(50)
print("balance:", account.balance)
print("events:", ", ".join(f"{e['type']} {e['amount']}" for e in account.events))

try:
    account.withdraw(500)  # no event is recorded
except ValueError as error:
    print("rejected:", error)

print("rebuilt from events:", Account.rebuild(account.events).balance)
print("balance after 2 events:", Account.rebuild(account.events[:2]).balance)  # time travel

snapshot = {"balance": 70, "version": 2}  # state saved at event 2
print(f"from snapshot (balance 70 at event 2) + 1 later event: {Account.rebuild(account.events, snapshot).balance}")
