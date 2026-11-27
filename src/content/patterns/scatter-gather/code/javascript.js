// Scatter-Gather in JavaScript. Ask every vendor at once, then gather what arrives before the deadline.
// The clock is simulated (each vendor has a fixed answer time) so that the output is the same every run.

const vendors = [
  { name: "A", latency: 120, price: 105 },
  { name: "B", latency: 80, price: 99 },
  { name: "C", latency: 450, price: 90 }, // cheap, but too slow
  { name: "D", latency: 200, price: 102 },
  { name: "E", latency: 60, error: "out of stock feed" },
];

function ask(vendor) { // Worker: answers or fails
  if (vendor.error) throw new Error(vendor.error);
  return vendor.price;
}

function scatterGather(workers, deadline) {
  console.log(`Scatter: asking ${workers.length} vendors, deadline ${deadline} ms`);
  const gathered = [];
  const byArrival = [...workers].sort((a, b) => a.latency - b.latency); // all were asked at time 0
  for (const worker of byArrival) { // Gatherer: handles answers in the order they arrive
    if (worker.latency > deadline) {
      console.log(`  ${worker.name} too slow (${worker.latency} ms), ignored`);
      continue;
    }
    try {
      const price = ask(worker);
      gathered.push({ name: worker.name, price });
      console.log(`  ${worker.name} answered in ${worker.latency} ms: ${price}`);
    } catch (error) {
      console.log(`  ${worker.name} failed at ${worker.latency} ms: ${error.message}`);
    }
  }
  console.log(`Gathered ${gathered.length} of ${workers.length} answers`);
  return gathered.reduce((best, g) => (g.price < best.price ? g : best));
}

const best = scatterGather(vendors, 300);
console.log(`Best price: ${best.price} (${best.name})`);
