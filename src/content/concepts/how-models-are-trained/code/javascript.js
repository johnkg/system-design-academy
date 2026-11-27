// Gradient descent in JavaScript on the loss (w - 3)^2: the weight w should end up at 3.
const LEARNING_RATE = 0.1;
let w = 0;

const loss = (x) => (x - 3) ** 2;
console.log(`step 0: w=${w.toFixed(4)}, loss=${loss(w).toFixed(4)}`);
for (let step = 1; step <= 5; step++) {
  const gradient = 2 * (w - 3); // how the loss changes if w changes a little
  w = w - LEARNING_RATE * gradient; // move against the gradient
  console.log(`step ${step}: w=${w.toFixed(4)}, loss=${loss(w).toFixed(4)}`);
}
