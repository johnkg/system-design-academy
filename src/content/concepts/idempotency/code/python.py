"""Idempotency keys in Python: repeated requests with the same key run the work only once."""


class PaymentApi:
    def __init__(self):
        self._seen = {}  # key -> {"amount", "response"}
        self.charges = []

    def charge(self, key, amount):
        existing = self._seen.get(key)
        if existing:
            # same key, different body: a client bug, so refuse instead of guessing
            if existing["amount"] != amount:
                raise ValueError(f"key {key} was already used with a different amount")
            return {**existing["response"], "replayed": True}
        # In a real system, "check the key" and "do the work" must be one atomic step
        # (a database transaction or a unique constraint), or two simultaneous requests could both pass.
        self.charges.append(amount)
        response = {"status": "charged", "amount": amount, "replayed": False}
        self._seen[key] = {"amount": amount, "response": response}
        return response


def join(items):
    return ",".join(str(i) for i in items)


api = PaymentApi()

print("--- without reusing the key: the retry becomes a second payment")
api.charge("attempt-1", 50)
api.charge("attempt-2", 50)  # the app made a new key on retry
print(f"charges: [{join(api.charges)}] total ${sum(api.charges)}")

fresh = PaymentApi()


def show(r):
    return f"{{ status: {r['status']}, amount: {r['amount']}, replayed: {str(r['replayed']).lower()} }}"


print("--- reusing the key: the retry is a replay")
print(show(fresh.charge("abc-123", 50)))
print(show(fresh.charge("abc-123", 50)))  # the response was lost, so the client retries with the same key
print(f"charges: [{join(fresh.charges)}] total ${sum(fresh.charges)}")

try:
    fresh.charge("abc-123", 80)
except ValueError as e:
    print(f"rejected: {e}")
