// An orchestrated saga in JavaScript: do each step, and on failure undo the completed ones in reverse.

class Saga {
  constructor(steps) { this.steps = steps; }

  async run(context) {
    const completed = [];
    for (const step of this.steps) {
      try {
        console.log(`do    ${step.name}`);
        await step.action(context);
        completed.push(step);
      } catch (error) {
        console.log(`FAIL  ${step.name}: ${error.message}`);
        for (const done of completed.reverse()) { // compensate in reverse order
          console.log(`undo  ${done.name}`);
          await done.compensate(context);
        }
        return false;
      }
    }
    return true;
  }
}

function tripSaga(paymentWorks) {
  return new Saga([
    { name: "reserve flight", action: async () => {}, compensate: async () => {} }, // each local step can be undone
    { name: "reserve hotel", action: async () => {}, compensate: async () => {} },
    { name: "charge card", action: async () => { if (!paymentWorks) throw new Error("card declined"); }, compensate: async () => {} },
  ]);
}

console.log("--- happy path");
console.log("booked:", await tripSaga(true).run({}));
console.log("--- payment fails");
console.log("booked:", await tripSaga(false).run({}));
