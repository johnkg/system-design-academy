// Without the pattern: parsing and calculating tangled in one function.

function evaluate(postfix, vars) {
  const stack = [];
  for (const token of postfix.split(/\s+/)) {
    if (token === "+") { const b = stack.pop(), a = stack.pop(); stack.push(a + b); }
    else if (token === "*") { const b = stack.pop(), a = stack.pop(); stack.push(a * b); }
    else if (/^\d+$/.test(token)) stack.push(Number(token));
    else stack.push(vars[token]);
    // New operator "-"? Another branch here. Want to print the formula? No structure to walk.
  }
  return stack.pop();
}

console.log(evaluate("x 3 * 2 +", { x: 4 }));
console.log(evaluate("x 3 * 2 +", { x: 10 })); // re-parses the text every single time
