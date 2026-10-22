"""Error budget and burn rate in Python. The numbers are passed in, so the output is deterministic."""

MINUTES_PER_DAY = 24 * 60
WINDOW_DAYS = 30  # the SLO is measured over a rolling 30-day window
PAGE_BURN_RATE = 14  # burning this fast for an hour spends 2% of a 30-day budget: page a human


# How much downtime does an SLO allow over a window?
def error_budget_minutes(slo, window_days):
    return (1 - slo) * window_days * MINUTES_PER_DAY


# Burn rate: how fast the budget is being spent compared with spending it evenly over the window.
# 1.0 spends exactly the whole budget by the end of the window; 14 would spend it in about two days.
def burn_rate(error_ratio, slo):
    return error_ratio / (1 - slo)


for slo in [0.99, 0.999, 0.9999]:
    print(f"SLO {slo * 100:.2f}% over 30 days allows {error_budget_minutes(slo, WINDOW_DAYS):.1f} minutes of downtime")

slo = 0.999
incidents = [
    {"name": "bad deploy", "minutes": 20},
    {"name": "provider blip", "minutes": 5},
    {"name": "slow day", "minutes": 12},
]
budget = error_budget_minutes(slo, WINDOW_DAYS)
spent = 0
for incident in incidents:
    spent += incident["minutes"]
    percent = max(0, (budget - spent) / budget * 100)
    print(f"after {incident['name']}: {budget - spent:.1f} minutes left ({percent:.0f}%)")
print("budget spent: freeze feature releases, fix reliability" if spent > budget else "budget remains: keep shipping")

# A 2% error rate for an hour, against a 99.9% SLO
rate = burn_rate(0.02, slo)
print(f"burn rate at 2% errors: {rate:.0f}x{' -> page someone now' if rate >= PAGE_BURN_RATE else ''}")
print(f"burn rate at 0.05% errors: {burn_rate(0.0005, slo):.1f}x (well within budget)")
