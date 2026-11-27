// Temperature and top-p in JavaScript, on fixed scores so that the output is the same every run.
const TOKENS = ["a", "b", "c", "d", "e"];
const LOGITS = [4, 3, 2, 1, 0];

function softmax(logits, temperature) {
  const exps = logits.map((x) => Math.exp(x / temperature));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / total);
}

for (const temperature of [0.5, 1, 2]) {
  const probs = softmax(LOGITS, temperature);
  console.log(`temperature ${temperature}: ` + TOKENS.map((t, i) => `${t} ${probs[i].toFixed(3)}`).join(", "));
}

const probs = softmax(LOGITS, 1);
const order = probs.map((_, i) => i).sort((x, y) => probs[y] - probs[x]); // most likely first
const kept = [];
let total = 0;
for (const i of order) { // top-p: the smallest set whose probabilities add up to at least p
  kept.push(i);
  total += probs[i];
  if (total >= 0.9) break;
}
console.log(`top-p 0.9 at temperature 1 keeps ${kept.map((i) => TOKENS[i]).join(", ")} (together ${total.toFixed(3)})`);
console.log("renormalised: " + kept.map((i) => `${TOKENS[i]} ${(probs[i] / total).toFixed(3)}`).join(", "));
