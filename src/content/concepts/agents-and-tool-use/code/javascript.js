// An agent loop in JavaScript: a scripted "model" picks actions, the loop runs tools within a step budget.
const TOOLS = {
  search: () => "3 results: A 120, B 95, C 140",
  book: (arg) => `booked ${arg} for 95`,
};
const NEEDS_APPROVAL = new Set(["book"]); // actions that change the world are approved by a person
const SCRIPT = [["search", "flights to Lisbon"], ["book", "B"], ["finish", "Booked flight B for 95"]];

// Stands in for a language model: it picks the next action from what has happened so far.
const scriptedModel = (history) => SCRIPT[history.length];

function run(budget) {
  console.log(`run with budget ${budget}`);
  const history = [];
  for (let step = 1; step <= budget; step++) {
    const [action, argument] = scriptedModel(history);
    if (action === "finish") {
      console.log(`  step ${step}: finish -> ${argument}`);
      return;
    }
    const approved = NEEDS_APPROVAL.has(action) ? " [approved]" : "";
    const observation = TOOLS[action](argument);
    history.push([action, argument, observation]);
    console.log(`  step ${step}: ${action}(${argument})${approved} -> ${observation}`);
  }
  console.log(`  budget of ${budget} steps used: stopped before finishing`);
}

run(5);
run(2);
