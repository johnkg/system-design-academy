# Structured output in Python: validate and retry, a token mask, and an allow-list for tool calls.
import json
import math

# 1. Validate and retry, with a scripted model that gets it wrong twice.
REPLIES = [
    'Sure! Here is the JSON: {"order_id": 42}',
    '{"order_id": "42", "status": "shipped"}',
    '{"order_id": 42, "status": "shipped"}',
]


def validate(text):
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return False, "invalid JSON"
    if not isinstance(data, dict) or not isinstance(data.get("order_id"), int) or isinstance(data.get("order_id"), bool):
        return False, "wrong shape (order_id must be an integer)"
    if not isinstance(data.get("status"), str):
        return False, "wrong shape (status must be a string)"
    return True, f"valid -> order_id={data['order_id']}, status={data['status']}"


for attempt, reply in enumerate(REPLIES, start=1):
    ok, message = validate(reply)
    print(f"attempt {attempt}: {message}")
    if ok:
        break

# 2. A token mask: only the tokens the grammar allows can be chosen.
TOKENS = ["4", "7", "x", '"', "}"]
LOGITS = [1.0, 2.0, 3.0, 2.5, 0.5]
ALLOWED = {"4", "7"}  # after '{"order_id": ' only a digit (or a minus sign) is valid; this toy vocabulary has no minus sign
print(f"unconstrained pick: {TOKENS[max(range(len(TOKENS)), key=lambda i: LOGITS[i])]}")
masked = [score if token in ALLOWED else -math.inf for token, score in zip(TOKENS, LOGITS)]
print("allowed here: " + ", ".join(t for t in TOKENS if t in ALLOWED))
print(f"constrained pick: {TOKENS[max(range(len(TOKENS)), key=lambda i: masked[i])]}")

# 3. Function calling: the model asks, the application checks and acts.
ORDERS = {42: "shipped"}
TOOLS = {"get_order": lambda args: ORDERS[args["order_id"]]}
for call_text in ['{"name": "get_order", "arguments": {"order_id": 42}}', '{"name": "delete_all", "arguments": {}}']:
    call = json.loads(call_text)
    if call["name"] not in TOOLS:
        print(f"refused: {call['name']} is not an allowed tool")
        continue
    result = TOOLS[call["name"]](call["arguments"])
    print(f"call {call['name']}(order_id={call['arguments']['order_id']}) -> {result}")
