// Future/Promise in JavaScript. Start both lookups, then wait for the futures together.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function lookupPrice() { // the returned promise is the future of the value
  await sleep(150);
  return 40;
}

async function lookupStock(fails) {
  await sleep(100);
  if (fails) throw new Error("stock service down");
  return 7;
}

async function show(stockFails) {
  console.log("started price and stock lookups");
  const priceFuture = lookupPrice(); // the work has begun, the value is not here yet
  const stockFuture = lookupStock(stockFails);

  const [price, stock] = await Promise.allSettled([priceFuture, stockFuture]); // wait for both, keep each outcome
  if (stock.status === "fulfilled") {
    console.log(`price ${price.value}, stock ${stock.value}`);
  } else {
    console.log(`stock failed: ${stock.reason.message}`);
    console.log(`price still arrived: ${price.value}`);
  }
}

(async () => {
  await show(false);
  await show(true);
})();
