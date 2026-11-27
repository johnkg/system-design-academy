// Choosing a lever in JavaScript: simple rules that turn a team's needs into a recommended order of steps.
const RULES = [
  [() => true, "prompting: write clear instructions and a few examples"],
  [(n) => n.includes("fresh_facts") || n.includes("private_docs"), "retrieval: fetch the documents at question time"],
  [(n) => n.includes("strict_format"), "structured output: ask for a schema and validate the result"],
  [(n) => n.includes("new_style"), "fine-tuning: consider it if prompting cannot hold the style"],
  [(n) => n.includes("high_volume_low_latency"), "fine-tuning: a smaller tuned model can replace a long prompt"],
];

const choose = (needs) => RULES.filter(([applies]) => applies(needs)).map(([, advice]) => advice);

for (const needs of [[], ["fresh_facts"], ["new_style", "high_volume_low_latency"], ["private_docs", "strict_format"]]) {
  console.log("needs: " + (needs.length ? needs.join(", ") : "(none)"));
  choose(needs).forEach((advice, i) => console.log(`  ${i + 1}. ${advice}`));
}
