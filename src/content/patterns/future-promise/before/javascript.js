// Without the pattern: each lookup is awaited before the next one starts, and one failure loses everything.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function lookupPrice() { await sleep(150); return 40; }
async function lookupStock(fails) {
  await sleep(100);
  if (fails) throw new Error("stock service down");
  return 7;
}

async function show(stockFails) {
  try {
    console.log("asked for the price, waiting...");
    const price = await lookupPrice(); // nothing else happens during this wait
    console.log(`got price ${price}`);
    console.log("asked for the stock, waiting...");
    const stock = await lookupStock(stockFails); // only now does the second lookup start
    console.log(`got stock ${stock}`);
  } catch (error) {
    console.log(`page failed: ${error.message}`); // the price that had arrived is not shown
  }
}

(async () => {
  await show(false);
  await show(true);
})();
