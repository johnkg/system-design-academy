# Choosing a lever in Python: simple rules that turn a team's needs into a recommended order of steps.
RULES = [
    (lambda n: True, "prompting: write clear instructions and a few examples"),
    (lambda n: "fresh_facts" in n or "private_docs" in n, "retrieval: fetch the documents at question time"),
    (lambda n: "strict_format" in n, "structured output: ask for a schema and validate the result"),
    (lambda n: "new_style" in n, "fine-tuning: consider it if prompting cannot hold the style"),
    (lambda n: "high_volume_low_latency" in n, "fine-tuning: a smaller tuned model can replace a long prompt"),
]


def choose(needs):
    return [advice for applies, advice in RULES if applies(needs)]


for needs in ([], ["fresh_facts"], ["new_style", "high_volume_low_latency"], ["private_docs", "strict_format"]):
    print("needs: " + (", ".join(needs) if needs else "(none)"))
    for i, advice in enumerate(choose(needs), start=1):
        print(f"  {i}. {advice}")
