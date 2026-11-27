# Without the pattern: the app calls the partner directly, with no retry, timeout or breaker policy.

RATES = {"EUR": "1.08", "GBP": "1.27", "JPY": "0.0067"}
calls = 0


def partner(currency):
    global calls
    calls += 1
    if calls in (1, 3):  # the partner fails now and then
        raise RuntimeError("partner error")
    return RATES[currency]


for currency in ["EUR", "GBP", "JPY"]:
    print(f"app asks for {currency}")
    try:
        print(f"{currency} = {partner(currency)}")
    except RuntimeError as error:
        print(f"{currency} unavailable: {error}")  # every failure goes straight to the user
