# A notification sender in Python: retries with backoff and idempotent sending.
# The provider and the waiting are simulated, so the output is deterministic.


class FakeProvider:
    def __init__(self, behaviour):
        self.behaviour = behaviour  # id -> "ok" | "fail-first" | "lose-ack-first"
        self.delivered = []
        self._seen_keys = set()
        self._attempts = {}

    def send(self, id, idempotency_key=None):
        attempt = self._attempts.get(id, 0) + 1
        self._attempts[id] = attempt
        behaviour = self.behaviour.get(id, "ok")
        if behaviour == "fail-first" and attempt == 1:
            raise RuntimeError("503 provider unavailable")  # nothing delivered
        if idempotency_key and idempotency_key in self._seen_keys:
            return "already delivered, ignored"
        self.delivered.append(id)
        if idempotency_key:
            self._seen_keys.add(idempotency_key)
        if behaviour == "lose-ack-first" and attempt == 1:
            raise RuntimeError("timeout waiting for answer")  # delivered, but we never hear it
        return "accepted"


MAX_ATTEMPTS = 3  # sends before the worker gives up


def send_with_retry(provider, id, use_key, max_attempts=MAX_ATTEMPTS):
    for attempt in range(1, max_attempts + 1):
        try:
            answer = provider.send(id, id if use_key else None)
            print(f"  {id} attempt {attempt}: {answer}")
            return
        except RuntimeError as error:
            delay = 100 * 2 ** (attempt - 1)  # exponential backoff (jitter left out to keep output fixed)
            outcome = f"; retry in {delay} ms" if attempt < max_attempts else "; giving up (dead letter)"
            print(f"  {id} attempt {attempt}: {error}{outcome}")


def run(title, use_key):
    print(title)
    provider = FakeProvider({"A": "fail-first", "B": "lose-ack-first", "C": "ok"})
    for id in ["A", "B", "C"]:
        send_with_retry(provider, id, use_key)
    counts = [f"{id} x{provider.delivered.count(id)}" for id in ["A", "B", "C"]]
    print(f"  user received: {', '.join(counts)}")


run("Retries only (at least once):", False)
run("Retries plus idempotency key:", True)
