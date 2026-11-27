# Ambassador in Python. The app asks the ambassador for a rate; the ambassador deals with the flaky partner.

RATES = {"EUR": "1.08", "GBP": "1.27", "JPY": "0.0067", "USD": "1.00"}
FAILING_CALLS = {1, 3, 4, 5}  # the partner's calls that fail
partner_calls = 0


def partner(currency: str) -> str:  # the remote service
    global partner_calls
    partner_calls += 1
    if partner_calls in FAILING_CALLS:
        raise RuntimeError("partner error")
    return RATES[currency]


class Ambassador:  # Runs beside the client: backs off between retries, and stops calling a partner that is clearly down.
    # Timeouts are left out of this toy; real code sets one on every call. Backoff delays are printed, not slept.
    def __init__(self, max_attempts: int = 3, open_after: int = 3, probe_after: int = 1) -> None:
        self.max_attempts = max_attempts
        self.open_after = open_after
        self.probe_after = probe_after
        self.consecutive_failures = 0
        self.skipped = 0
        self.calls = 0

    def get(self, currency: str) -> str:
        open_circuit = self.consecutive_failures >= self.open_after
        if open_circuit and self.skipped < self.probe_after:  # circuit open: fail fast, leave the partner alone
            self.skipped += 1
            print("[ambassador] circuit open, partner not called")
            raise RuntimeError("circuit open")
        attempts = 1 if open_circuit else self.max_attempts  # half-open: one probe call decides whether to close the circuit
        for attempt in range(1, attempts + 1):
            self.calls += 1
            try:
                rate = partner(currency)
                note = " (probe, circuit closes)" if open_circuit else ""
                print(f"[ambassador] call {self.calls} ok{note}")
                self.consecutive_failures = 0
                self.skipped = 0
                return rate
            except RuntimeError:
                self.consecutive_failures += 1
                delay = 100 * 2 ** (attempt - 1)  # exponential backoff: 100 ms, 200 ms, ...
                action = f"retrying in {delay} ms" if attempt < attempts else "giving up"
                print(f"[ambassador] call {self.calls} failed, {action}")
        self.skipped = 0  # a failed probe keeps the circuit open for another round
        raise RuntimeError(f"partner failed {attempts} times")


ambassador = Ambassador()
for currency in ["EUR", "GBP", "JPY", "USD"]:  # the app only asks; it has no retry code
    print(f"app asks for {currency}")
    try:
        print(f"{currency} = {ambassador.get(currency)}")
    except RuntimeError as error:
        print(f"{currency} unavailable: {error}")
