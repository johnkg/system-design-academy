# Technical debt and refactoring: a team with 40 points of work per sprint, in code that carries 30 points of debt.
# Debt is the interest rate: in code the team changes every sprint ("hot" code), each feature costs 10 points plus one
# extra point for every 10 points of debt, and each rushed feature adds 2 more points of debt.
# Look for: how features delivered change with the strategy, what refactoring without tests costs, how a rewrite
# that takes longer than planned never catches up, and why debt in code nobody touches costs nothing.
# Assumptions of the toy: a refactoring step costs 8 points and removes 6 points of debt. Without tests, every third
# sprint's refactoring causes a regression that costs 12 points to find and fix. A rewrite delivers no features
# while it runs, then starts with 5 points of debt. A feature that does not fit in what is left of a sprint waits.
CAP, START_DEBT, NEW_DEBT, REFACTOR_COST, REFACTOR_GAIN, REGRESSION_COST, REWRITE_DEBT, BASE_COST = 40, 30, 2, 8, 6, 12, 5, 10
STRATEGIES = [
    {"name": "Ignore the debt", "kind": "ignore", "rewrite": 0},
    {"name": "Small steps every sprint", "kind": "small", "rewrite": 0},
    {"name": "Rewrite, 3 sprints", "kind": "rewrite", "rewrite": 3},
    {"name": "Rewrite, 6 sprints", "kind": "rewrite", "rewrite": 6},
    {"name": "Rewrite, 12 sprints", "kind": "rewrite", "rewrite": 12},
]


def simulate(st, sprints, tests, hot):
    debt, features, regressions = START_DEBT, 0, 0
    cumulative = []

    def cost():
        return BASE_COST + (debt // 10 if hot else 0)

    for s in range(1, sprints + 1):
        cap = CAP
        if st["kind"] == "rewrite" and s <= st["rewrite"]:
            cap = 0
            if s == st["rewrite"]:
                debt = REWRITE_DEBT
        if st["kind"] == "small":
            cap -= REFACTOR_COST
            debt = max(0, debt - REFACTOR_GAIN)
            if not tests and s % 3 == 0:
                cap -= REGRESSION_COST
                regressions += 1
        while cap >= cost():
            cap -= cost()
            features += 1
            debt += NEW_DEBT
        cumulative.append(features)
    return features, debt, cost(), regressions, cumulative


def overtakes(st, tests, hot):
    """First sprint from which a strategy stays ahead of ignoring the debt (checked over 60 sprints); -1 if it never does."""
    a = simulate(st, 60, tests, hot)[4]
    base = simulate(STRATEGIES[0], 60, tests, hot)[4]
    start = -1
    for i in range(59, -1, -1):
        if a[i] > base[i]:
            start = i + 1
        else:
            break
    return start


for hot in (True, False):
    for tests in (True, False):
        where = "hot code (changed every sprint)" if hot else "cold code (nobody touches it)"
        print(f"== debt in {where}, {'with' if tests else 'without'} tests around it")
        for k, st in enumerate(STRATEGIES):
            cells = [simulate(st, n, tests, hot)[0] for n in (6, 12, 24)]
            _, debt, cost, regressions, _ = simulate(st, 24, tests, hot)
            o = "n/a" if k == 0 else ("never" if overtakes(st, tests, hot) < 0 else f"sprint {overtakes(st, tests, hot)}")
            print(f"  {st['name']}: features after 6, 12, 24 sprints: {', '.join(map(str, cells))}; at 24: debt {debt}, one feature costs {cost} points, regressions {regressions}; stays ahead of ignoring from: {o}")
