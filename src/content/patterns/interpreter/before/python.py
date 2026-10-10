# Without the pattern: parsing and calculating tangled in one function.
import re


def evaluate(postfix, variables):
    stack = []
    for token in postfix.split():
        if token == "+":
            b, a = stack.pop(), stack.pop()
            stack.append(a + b)
        elif token == "*":
            b, a = stack.pop(), stack.pop()
            stack.append(a * b)
        elif re.fullmatch(r"\d+", token):
            stack.append(int(token))
        else:
            stack.append(variables[token])
        # New operator "-"? Another branch here. Want to print the formula? No structure to walk.
    return stack.pop()


print(evaluate("x 3 * 2 +", {"x": 4}))
print(evaluate("x 3 * 2 +", {"x": 10}))  # re-parses the text every single time
