// Without the pattern: vendors are asked one after another, so the waiting times add up.

const vendors = [
  { name: "A", latency: 120, price: 105 },
  { name: "B", latency: 80, price: 99 },
  { name: "C", latency: 450, price: 90 },
  { name: "D", latency: 200, price: 102 },
  { name: "E", latency: 60, error: "out of stock feed" },
];

let waited = 0;
console.log(`Asking ${vendors.length} vendors one by one`);
for (const v of vendors) {
  waited += v.latency; // each call must finish before the next one starts
  console.log(`  ${v.name} ${v.error ? "failed" : "answered"}, total waited ${waited} ms`);
}
console.log(`Total wait: ${waited} ms`); // the slow vendor C holds up everything after it
