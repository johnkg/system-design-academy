# Sidecar in Python. The app has no networking code: a helper beside it adds logging and retries.

REPLIES = {"inventory": "reserved", "payments": "charged"}


def network(target: str, attempt: int) -> str:  # stand-in for the real network: the first attempt always times out
    if attempt == 1:
        raise TimeoutError("timeout")
    return REPLIES[target]


class Sidecar:  # Runs beside the app; the app talks to it as if it were the network
    def __init__(self) -> None:
        self._count = 0

    def send(self, target: str, attempts: int = 3) -> str:
        self._count += 1
        request_id = f"r-{self._count}"
        print(f"[sidecar] request {request_id} to {target}")
        for attempt in range(1, attempts + 1):
            try:
                reply = network(target, attempt)
                print(f"[sidecar] attempt {attempt} ok")
                return reply
            except TimeoutError as error:
                print(f"[sidecar] attempt {attempt} failed: {error}")
        raise RuntimeError(f"{target} unavailable")


class PaymentsService:  # Application: business logic only
    def __init__(self, sidecar: Sidecar) -> None:
        self.sidecar = sidecar

    def run(self) -> None:
        print(f'payments: inventory answered "{self.sidecar.send("inventory")}"')


class OrdersService:
    def __init__(self, sidecar: Sidecar) -> None:
        self.sidecar = sidecar

    def run(self) -> None:
        print(f'orders: payments answered "{self.sidecar.send("payments")}"')


PaymentsService(Sidecar()).run()  # each instance gets its own sidecar
OrdersService(Sidecar()).run()
