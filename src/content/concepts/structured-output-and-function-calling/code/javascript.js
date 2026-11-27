// Structured output in JavaScript: validate and retry, a token mask, and an allow-list for tool calls.

// 1. Validate and retry, with a scripted model that gets it wrong twice.
const REPLIES = [
  'Sure! Here is the JSON: {"order_id": 42}',
  '{"order_id": "42", "status": "shipped"}',
  '{"order_id": 42, "status": "shipped"}',
];

function validate(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [false, "invalid JSON"];
  }
  if (typeof data !== "object" || data === null || !Number.isInteger(data.order_id)) return [false, "wrong shape (order_id must be an integer)"];
  if (typeof data.status !== "string") return [false, "wrong shape (status must be a string)"];
  return [true, `valid -> order_id=${data.order_id}, status=${data.status}`];
}

for (let attempt = 1; attempt <= REPLIES.length; attempt++) {
  const [ok, message] = validate(REPLIES[attempt - 1]);
  console.log(`attempt ${attempt}: ${message}`);
  if (ok) break;
}

// 2. A token mask: only the tokens the grammar allows can be chosen.
const TOKENS = ["4", "7", "x", '"', "}"];
const LOGITS = [1.0, 2.0, 3.0, 2.5, 0.5];
const ALLOWED = new Set(["4", "7"]); // after '{"order_id": ' only a digit is valid
const best = (scores) => TOKENS[scores.indexOf(Math.max(...scores))];
console.log(`unconstrained pick: ${best(LOGITS)}`);
const masked = LOGITS.map((score, i) => (ALLOWED.has(TOKENS[i]) ? score : -Infinity));
console.log("allowed here: " + TOKENS.filter((t) => ALLOWED.has(t)).join(", "));
console.log(`constrained pick: ${best(masked)}`);

// 3. Function calling: the model asks, the application checks and acts.
const ORDERS = { 42: "shipped" };
const TOOLS = { get_order: (args) => ORDERS[args.order_id] };
for (const text of ['{"name": "get_order", "arguments": {"order_id": 42}}', '{"name": "delete_all", "arguments": {}}']) {
  const call = JSON.parse(text);
  if (!Object.hasOwn(TOOLS, call.name)) {
    console.log(`refused: ${call.name} is not an allowed tool`);
    continue;
  }
  console.log(`call ${call.name}(order_id=${call.arguments.order_id}) -> ${TOOLS[call.name](call.arguments)}`);
}
