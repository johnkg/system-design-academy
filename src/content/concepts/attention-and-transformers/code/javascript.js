// Scaled dot-product attention in JavaScript, for three tokens with a causal mask.
const NAMES = ["the", "trophy", "it"];
const QUERIES = [[1, 0], [0, 1], [0, 2]];     // what each token is looking for
const KEYS = [[1, 0], [0, 1], [0.5, 0.5]];    // what each token offers
const VALUES = [[1, 0], [0, 2], [3, 3]];      // what each token passes on
const D = 2;                                  // size of a key

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const scores = [];
const weights = [];
const outputs = [];
for (let i = 0; i < NAMES.length; i++) {
  const row = [];
  for (let j = 0; j <= i; j++) row.push(dot(QUERIES[i], KEYS[j]) / Math.sqrt(D)); // causal: only j <= i
  const peak = Math.max(...row);
  const exps = row.map((s) => Math.exp(s - peak));
  const total = exps.reduce((a, b) => a + b, 0);
  const w = exps.map((e) => e / total); // softmax: weights that add up to 1
  const out = [0, 1].map((c) => w.reduce((sum, wj, j) => sum + wj * VALUES[j][c], 0));
  scores.push(row);
  weights.push(w);
  outputs.push(out);
}

const label = (name) => `${name}:`.padEnd(8);
console.log("scores (row = token asking, column = token it can look at):");
NAMES.forEach((name, i) => console.log(label(name) + scores[i].map((x) => x.toFixed(3)).join(" ")));
console.log("weights (each row adds up to 1):");
NAMES.forEach((name, i) => console.log(label(name) + weights[i].map((x) => x.toFixed(3)).join(" ")));
console.log("outputs (weighted mix of the value vectors):");
NAMES.forEach((name, i) => console.log(`${label(name)}[${outputs[i][0].toFixed(3)}, ${outputs[i][1].toFixed(3)}]`));
