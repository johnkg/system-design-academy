// Training-serving skew in JavaScript: one feature, days since signup, computed in two places.
const PAIRS = [[0, 48], [0, 50], [10, 130], [5, 100], [0, 24]]; // [signup hour, now hour]

const trainingDays = (signup, now) => Math.floor((now - signup) / 24); // the batch pipeline counts whole days
const servingDays = (signup, now) => Math.floor((now - signup + 23) / 24); // the live service rounds up

let mismatches = 0;
for (const [signup, now] of PAIRS) {
  const train = trainingDays(signup, now);
  const serve = servingDays(signup, now);
  const differ = train !== serve;
  if (differ) mismatches += 1;
  console.log(`signup ${signup}h, now ${now}h: training ${train}, serving ${serve}, ${differ ? "MISMATCH" : "match"}`);
}
console.log(`mismatches: ${mismatches} of ${PAIRS.length} (${Math.floor((mismatches * 100) / PAIRS.length)}%)`);
