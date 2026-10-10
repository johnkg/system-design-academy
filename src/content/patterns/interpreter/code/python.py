# Interpreter in Python. A tiny postfix calculator: "x 3 * 2 +" means x*3+2.
import re
from abc import ABC, abstractmethod


class Expr(ABC):  # Abstract Expression
    @abstractmethod
    def interpret(self, context=None): ...


class NumberExpr(Expr):  # Terminal Expression
    def __init__(self, value):
        self.value = value

    def interpret(self, context=None):
        return self.value


class VariableExpr(Expr):  # Terminal Expression
    def __init__(self, name):
        self.name = name

    def interpret(self, context=None):
        return context[self.name]


class AddExpr(Expr):  # Nonterminal Expression
    def __init__(self, left, right):
        self.left = left
        self.right = right

    def interpret(self, context=None):
        return self.left.interpret(context) + self.right.interpret(context)


class MultiplyExpr(Expr):  # Nonterminal Expression
    def __init__(self, left, right):
        self.left = left
        self.right = right

    def interpret(self, context=None):
        return self.left.interpret(context) * self.right.interpret(context)


def parse(postfix):  # builds the expression tree from text
    stack = []
    for token in postfix.split():
        if token in ("+", "*"):
            right, left = stack.pop(), stack.pop()
            stack.append(AddExpr(left, right) if token == "+" else MultiplyExpr(left, right))
        elif re.fullmatch(r"\d+", token):
            stack.append(NumberExpr(int(token)))
        else:
            stack.append(VariableExpr(token))
    return stack.pop()


tree = parse("x 3 * 2 +")
print(tree.interpret({"x": 4}))   # 14
print(tree.interpret({"x": 10}))  # 32: same tree, new context
