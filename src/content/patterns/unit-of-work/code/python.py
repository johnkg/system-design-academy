# Unit of Work in Python. Changes are remembered, then saved together or not at all.


class Store:  # Data store: rejects a bad value, and can restore an earlier state
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    def write(self, key: str, value: str) -> None:
        if key.startswith("points:") and not value.isdigit():
            raise ValueError("points must be a number")
        self.data[key] = value

    def snapshot(self) -> dict[str, str]:
        return dict(self.data)

    def restore(self, snapshot: dict[str, str]) -> None:
        self.data = snapshot

    def show(self) -> str:
        return ", ".join(f"{k}={v}" for k, v in sorted(self.data.items()))


class UnitOfWork:
    def __init__(self, store: Store) -> None:
        self.store = store
        self._changes: dict[str, str] = {}

    def set(self, key: str, value: str) -> None:
        self._changes[key] = value  # remembered, not written yet

    def commit(self) -> None:
        before = self.store.snapshot()
        count = len(self._changes)
        try:
            for key, value in self._changes.items():
                self.store.write(key, value)
            print(f"Committed {count} changes")
        except ValueError as error:
            self.store.restore(before)
            print(f"Rolled back after a failed write: {error}")
        finally:
            self._changes.clear()


store = Store()

first = UnitOfWork(store)
first.set("order:1", "paid")
first.set("stock:apple", "9")
first.set("points:ada", "15")
first.commit()
print(f"Store: {store.show()}")

second = UnitOfWork(store)
second.set("order:2", "paid")
second.set("stock:apple", "8")
second.set("points:ada", "lots")  # the store rejects this one
second.commit()
print(f"Store: {store.show()}")
