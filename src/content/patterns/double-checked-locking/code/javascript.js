// Double-checked creation in JavaScript. One thread runs your code, so the check cannot be interrupted;
// the race is across an await. Storing the promise, not the value, is the equivalent of the second check.

let instance = null; // Instance field: holds the in-flight or finished creation

let created = 0;
async function createExpensiveService() { // slow to build
  await new Promise((resolve) => setTimeout(resolve, 50));
  created += 1;
  return { id: created };
}

function getInstance() {
  if (instance === null) instance = createExpensiveService(); // check and store happen with no await in between
  return instance; // every later caller gets the same promise
}

(async () => {
  const callers = Array.from({ length: 8 }, () => getInstance());
  const results = await Promise.all(callers);
  console.log(`${callers.length} callers asked for the instance`);
  console.log(`Instances created: ${created}`);
  console.log(`All callers got the same instance: ${results.every((r) => r === results[0])}`);
})();
