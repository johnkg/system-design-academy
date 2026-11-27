# Without the pattern: every service carries its own copy of the retry and logging code.

REPLIES = {"inventory": "reserved", "payments": "charged"}


def network(target, attempt):
    if attempt == 1:
        raise TimeoutError("timeout")
    return REPLIES[target]


class PaymentsService:
    def call(self, target):  # copy 1 of the retry loop
        for attempt in range(1, 4):
            try:
                return network(target, attempt)
            except TimeoutError as error:
                print(f"[payments] attempt {attempt} failed: {error}")

    def run(self):
        print(f'payments: inventory answered "{self.call("inventory")}"')


class OrdersService:
    def call(self, target):  # copy 2: written separately, and already different (two attempts, no log line)
        for attempt in range(1, 3):
            try:
                return network(target, attempt)
            except TimeoutError:
                pass

    def run(self):
        print(f'orders: payments answered "{self.call("payments")}"')


PaymentsService().run()
OrdersService().run()
