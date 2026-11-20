# Single Responsibility Principle: the same payroll report built three ways, hit by the same five change requests.
# Look for: how many classes each request touches, and how much unrelated behaviour (and which other teams' code) sits inside them.
# A design is a list of classes: (name, what it does (each item is a "reason to change"), which classes it calls).
ACTOR = {"overtime": "finance", "tax": "finance", "bonus": "finance", "format": "operations", "storage": "IT", "flow": ""}

DESIGNS = [
    ("One class does everything", [
        ("Cli", [], ["PayrollReport"]),
        ("PayrollReport", ["overtime", "tax", "bonus", "format", "storage", "flow"], []),
    ]),
    ("Split by reason to change", [
        ("Cli", [], ["PayrollReport"]),
        ("PayrollReport", ["flow"], ["PayCalculator", "ReportFormatter", "ReportStore"]),
        ("PayCalculator", ["overtime", "tax", "bonus"], []),
        ("ReportFormatter", ["format"], []),
        ("ReportStore", ["storage"], []),
    ]),
    ("Over-split: a class per step", [
        ("Cli", [], ["ReportRunner"]),
        ("ReportRunner", ["flow"], ["OvertimeCalculator", "TaxCalculator", "BonusCalculator", "HeaderFormatter", "RowFormatter", "FileWriter"]),
        ("OvertimeCalculator", ["overtime"], ["OvertimeRule", "OvertimeRateTable"]),
        ("OvertimeRule", ["overtime"], []),
        ("OvertimeRateTable", ["overtime"], []),
        ("TaxCalculator", ["tax"], ["TaxRule", "TaxBracketTable"]),
        ("TaxRule", ["tax"], []),
        ("TaxBracketTable", ["tax"], []),
        ("BonusCalculator", ["bonus"], ["BonusRule"]),
        ("BonusRule", ["bonus"], []),
        ("HeaderFormatter", ["format"], ["ColumnLayout"]),
        ("RowFormatter", ["format"], ["ColumnLayout"]),
        ("ColumnLayout", ["format"], []),
        ("FileWriter", ["storage"], ["FilePathResolver", "Serializer"]),
        ("FilePathResolver", ["storage"], []),
        ("Serializer", ["storage"], []),
    ]),
]

REQUESTS = [
    ("tax rule changes", ["tax"]),
    ("new output format", ["format"]),
    ("new storage", ["storage"]),
    ("overtime rule changes", ["overtime"]),
    ("add a bonus column", ["bonus", "format"]),
]


def depth(classes, name):
    c = next(x for x in classes if x[0] == name)
    best = 0
    for u in c[2]:
        best = max(best, depth(classes, u))
    return best + 1


def analyse(classes, touches):
    touched = [c for c in classes if any(r in touches for r in c[1])]
    retest = {c[0] for c in touched}
    grew = True
    while grew:  # anything that calls a retested class must be retested too
        grew = False
        for c in classes:
            if c[0] not in retest and any(u in retest for u in c[2]):
                retest.add(c[0])
                grew = True
    reverified = sum(len(c[1]) for c in classes if c[0] in retest)
    bystanders = 0
    teams = set()
    for c in touched:
        for r in c[1]:
            if r not in touches:
                bystanders += 1
                if ACTOR[r] and not any(ACTOR[t] == ACTOR[r] for t in touches):
                    teams.add(ACTOR[r])
    return [c[0] for c in touched], len(retest), reverified, bystanders, len(teams)


for name, classes in DESIGNS:
    print(f"== {name}")
    print(f"  {len(classes)} classes to read to follow one report run, the longest call chain {depth(classes, 'Cli')} deep")
    t = r = b = o = 0
    for i, (text, touches) in enumerate(REQUESTS):
        touched, retest, reverified, bystanders, teams = analyse(classes, touches)
        print(f"  R{i + 1} {text}: edit {len(touched)} ({', '.join(touched)}); retest {retest}; re-verify {reverified} behaviours; bystander behaviours {bystanders}; other teams at risk {teams}")
        t += len(touched); r += retest; b += bystanders; o += teams
    print(f"  five requests: {t} classes edited, {r} retests, {b} bystander behaviours, {o} other-team exposures")
