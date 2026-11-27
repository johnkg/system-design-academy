# Ambassador in Python. The app asks the ambassador for a rate; the ambassador deals with the flaky partner.

RATES = {"EUR": "1.08", "GBP": "1.27", "JPY": "0.0067"}
FAILING_CALLS = {1, 3, 4, 5}  # the partner's calls that fail
partner_calls = 0


def partner(currency: str) -> str:  # the remote service
    global partner_calls
    partner_calls += 1
    if partner_calls in FAILING_CALLS:
        raise RuntimeError("partner error")
    return RATES[currency]


class Ambassador:  # Runs beside the client: retries with a limit, and stops calling a partner that is clearly down
    def __init__(self, max_attempts: int = 3, open_after: int = 3) -> None:
        self.max_attempts = max_attempts
        self.open_after = open_after
        self.consecutive_failures = 0
        self.calls = 0

    def get(self, currency: str) -> str:
        if self.consecutive_failures >= self.open_after:
            print("[ambassador] circuit open, partner not called")
            raise RuntimeError("circuit open")
        for attempt in range(1, self.max_attempts + 1):
            self.calls += 1
            try:
                rate = partner(currency)
                print(f"[ambassador] call {self.calls} ok")
                self.consecutive_failures = 0
                return rate
            except RuntimeError:
                self.consecutive_failures += 1
                action = "retrying" if attempt < self.max_attempts else "giving up"
                print(f"[ambassador] call {self.calls} failed, {action}")
        raise RuntimeError(f"partner failed {self.max_attempts} times")


ambassador = Ambassador()
for currency in ["EUR", "GBP", "JPY"]:  # the app only asks; it has no retry code
    print(f"app asks for {currency}")
    try:
        print(f"{currency} = {ambassador.get(currency)}")
    except RuntimeError as error:
        print(f"{currency} unavailable: {error}")
