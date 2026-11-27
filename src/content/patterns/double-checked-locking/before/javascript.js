// Without the pattern: check, then create across an await. Every early caller sees "nothing yet" and builds its own.

let instance = null;
let created = 0;

async function createExpensiveService() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  created += 1;
  return { id: created };
}

async function getInstance() {
  if (instance === null) instance = await createExpensiveService(); // the check is stale by the time the await returns
  return instance;
}

(async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => getInstance()));
  console.log(`Instances created: ${created}`); // 8, not 1
  console.log(`Distinct instances handed out: ${new Set(results).size}`);
})();
