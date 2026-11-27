// Without the pattern: the rule is an if-chain, copied into every place that needs it.

const customers = [
  { name: "ada", active: true, blocked: false, total: 120 },
  { name: "bob", active: true, blocked: true, total: 200 },
  { name: "cy", active: false, blocked: false, total: 150 },
  { name: "dee", active: true, blocked: false, total: 60 },
];

function discountScreen() {
  const yes = [];
  for (const c of customers) if (c.active && !c.blocked && c.total >= 100) yes.push(c.name);
  console.log(`Discount screen: ${yes.join(", ")}`);
}

function emailCampaign() {
  const yes = [];
  // Copied from the discount screen. Someone changes 100 to 150 above and forgets this one.
  for (const c of customers) if (c.active && !c.blocked && c.total >= 100) yes.push(c.name);
  console.log(`Email campaign: ${yes.join(", ")}`);
}

discountScreen();
emailCampaign();
