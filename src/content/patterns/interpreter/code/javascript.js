// Interpreter in JavaScript. A tiny postfix calculator: "x 3 * 2 +" means x*3+2.

class NumberExpr { // Terminal Expression
  constructor(value) { this.value = value; }
  interpret() { return this.value; }
}

class VariableExpr { // Terminal Expression
  constructor(name) { this.name = name; }
  interpret(context) { return context[this.name]; }
}

class AddExpr { // Nonterminal Expression
  constructor(left, right) { this.left = left; this.right = right; }
  interpret(context) { return this.left.interpret(context) + this.right.interpret(context); }
}

class MultiplyExpr { // Nonterminal Expression
  constructor(left, right) { this.left = left; this.right = right; }
  interpret(context) { return this.left.interpret(context) * this.right.interpret(context); }
}

function parse(postfix) { // builds the expression tree from text
  const stack = [];
  for (const token of postfix.split(/\s+/)) {
    if (token === "+" || token === "*") {
      const right = stack.pop(), left = stack.pop();
      stack.push(token === "+" ? new AddExpr(left, right) : new MultiplyExpr(left, right));
    } else if (/^\d+$/.test(token)) stack.push(new NumberExpr(Number(token)));
    else stack.push(new VariableExpr(token));
  }
  return stack.pop();
}

const tree = parse("x 3 * 2 +");
console.log(tree.interpret({ x: 4 })); // 14
console.log(tree.interpret({ x: 10 })); // 32: same tree, new context
