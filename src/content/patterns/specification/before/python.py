# Without the pattern: the rule is an if-chain, copied into every place that needs it.

customers = [
    {"name": "ada", "active": True, "blocked": False, "total": 120},
    {"name": "bob", "active": True, "blocked": True, "total": 200},
    {"name": "cy", "active": False, "blocked": False, "total": 150},
    {"name": "dee", "active": True, "blocked": False, "total": 60},
]


def discount_screen():
    yes = [c["name"] for c in customers if c["active"] and not c["blocked"] and c["total"] >= 100]
    print(f"Discount screen: {', '.join(yes)}")


def email_campaign():
    # Copied from the discount screen. Someone changes 100 to 150 above and forgets this one.
    yes = [c["name"] for c in customers if c["active"] and not c["blocked"] and c["total"] >= 100]
    print(f"Email campaign: {', '.join(yes)}")


discount_screen()
email_campaign()
