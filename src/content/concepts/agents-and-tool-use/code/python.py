# An agent loop in Python: a scripted "model" picks actions, the loop runs tools within a step budget.
TOOLS = {
    "search": lambda arg: "3 results: A 120, B 95, C 140",
    "book": lambda arg: f"booked {arg} for 95",
}
NEEDS_APPROVAL = {"book"}  # actions that change the world are approved by a person
SCRIPT = [("search", "flights to Lisbon"), ("book", "B"), ("finish", "Booked flight B for 95")]


def scripted_model(history):
    """Stands in for a language model: it picks the next action from what has happened so far."""
    return SCRIPT[len(history)]


def run(budget):
    print(f"run with budget {budget}")
    history = []
    for step in range(1, budget + 1):
        action, argument = scripted_model(history)
        if action == "finish":
            print(f"  step {step}: finish -> {argument}")
            return
        approved = " [approved]" if action in NEEDS_APPROVAL else ""
        observation = TOOLS[action](argument)
        history.append((action, argument, observation))
        print(f"  step {step}: {action}({argument}){approved} -> {observation}")
    print(f"  budget of {budget} steps used: stopped before finishing")


run(5)
run(2)
