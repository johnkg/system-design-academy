# Without the pattern: every change is written the moment it is made.

store = {}


def write(key, value):
    if key.startswith("points:") and not value.isdigit():
        raise ValueError("points must be a number")
    store[key] = value


def show():
    return ", ".join(f"{k}={v}" for k, v in sorted(store.items()))


def checkout():
    write("order:2", "paid")
    write("stock:apple", "8")
    write("points:ada", "lots")  # fails here: the first two writes are already saved


try:
    checkout()
except ValueError as error:
    print(f"Checkout failed: {error}")
print(f"Store: {show()}")  # a paid order and lower stock, with no points
