# A claim checker in Python: a claim is "supported" if all its content words appear in one source sentence.
SOURCES = [
    "the refund window is 30 days from delivery",
    "refunds go back to the original payment method",
    "gift cards cannot be refunded",
]
CLAIMS = [
    "the refund window is 30 days",
    "refunds go to the original payment method",
    "refunds are also sent as store credit",
    "the refund window is 60 days",
]
STOP_WORDS = {"the", "is", "to", "are", "be", "a", "as"}


def supported(claim):
    words = {w for w in claim.split() if w not in STOP_WORDS}
    return any(words <= set(source.split()) for source in SOURCES)


unsupported = 0
for claim in CLAIMS:
    ok = supported(claim)
    unsupported += 0 if ok else 1
    print(f"{'supported:  ' if ok else 'unsupported:'} {claim}")
print(f"unsupported claims: {unsupported} of {len(CLAIMS)} ({unsupported * 100 // len(CLAIMS)}%)")
