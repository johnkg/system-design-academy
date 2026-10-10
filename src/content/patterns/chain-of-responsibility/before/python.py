# Without the pattern: one function knows every approver and every limit.


def approve(amount):
    if amount <= 1_000:
        return f"Manager approves ${amount}"
    elif amount <= 10_000:
        return f"Director approves ${amount}"
    else:
        return f"CEO approves ${amount}"
    # Add a VP at $5,000? Edit this function. Skip the Director on holiday? Edit it again.
    # The order and the limits are fixed in code, in one place that knows everything.


print(approve(500))
print(approve(5_000))
print(approve(50_000))
