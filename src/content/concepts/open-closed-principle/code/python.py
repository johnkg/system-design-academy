# Open-Closed Principle: a discount calculator with 2 rule types today (regular, member), built three ways.
# Then 1, 3 and 6 new rule types arrive, one at a time. Look for: edits inside existing code, existing branches exposed to
# accidental change, files created, and the cost of the abstraction itself when only 2 variants ever exist.
# A "touch point" is one edit to an existing file, one new file, or one existing branch that sits inside the edited code.
EXISTING = 2
DESIGNS = [
    {"name": "Switch on customer type", "setup_files": 1, "new_files_per_rule": 0, "exposes_branches": True, "input_change_base": 0,
     "note": "PriceCalculator holds one branch per rule"},
    {"name": "Strategy-style rules", "setup_files": 5, "new_files_per_rule": 1, "exposes_branches": False, "input_change_base": 2,
     "note": "DiscountRule, PricingEngine, RuleRegistry, 2 rule classes"},
    {"name": "Plug-in framework", "setup_files": 11, "new_files_per_rule": 3, "exposes_branches": False, "input_change_base": 4,
     "note": "rule, factory and descriptor per rule, plus loader, context, registry, engine, interface"},
]


def add_rules(d, k):
    """Adding k rules one after another. Each addition edits one existing file (the switch, the registry or the config)."""
    exposed = 0
    if d["exposes_branches"]:
        for i in range(k):
            exposed += EXISTING + i  # every existing branch is in the edited function
    edits = k
    created = d["new_files_per_rule"] * k
    return edits, created, exposed, edits + created + exposed, d["setup_files"] + created


def input_change(d, k):
    """A change the abstraction did not expect: every rule now needs the customer's country."""
    if d["input_change_base"] == 0:
        return 1  # one function signature
    return d["input_change_base"] + EXISTING + k  # interface, engine and so on, plus every rule class


def total(d, k):
    """Total cost from nothing: build the design for the 2 existing rules, then add k."""
    return d["setup_files"] + add_rules(d, k)[3]


def crossover(a, b):
    """Smallest number of added rules where design a costs more than design b."""
    for k in range(51):
        if total(a, k) > total(b, k):
            return k
    return -1


for d in DESIGNS:
    print(f"== {d['name']} ({d['note']})")
    print(f"  files for the {EXISTING} rules that exist: {d['setup_files']}")
    for k in (1, 3, 6):
        edits, created, exposed, touch, files_after = add_rules(d, k)
        print(f"  add {k}: {edits} edits to existing files, {created} new files, {exposed} existing branches exposed, {touch} touch points, {files_after} files in all; a new input for every rule means editing {input_change(d, k)} files")
    print(f"  total touch points from scratch with 2 rules: {total(d, 0)}")
print(f"strategy-style costs less than the switch from {crossover(DESIGNS[0], DESIGNS[1])} added rules")
print(f"plug-in framework costs less than the switch from {crossover(DESIGNS[0], DESIGNS[2])} added rules")
