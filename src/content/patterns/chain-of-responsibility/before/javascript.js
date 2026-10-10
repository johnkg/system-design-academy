// Without the pattern: one function knows every approver and every limit.

function approve(amount) {
  if (amount <= 1_000) return `Manager approves $${amount}`;
  else if (amount <= 10_000) return `Director approves $${amount}`;
  else return `CEO approves $${amount}`;
  // Add a VP at $5,000? Edit this function. Skip the Director on holiday? Edit it again.
  // The order and the limits are fixed in code, in one place that knows everything.
}

console.log(approve(500));
console.log(approve(5_000));
console.log(approve(50_000));
