// Without the pattern: the app calls the partner directly, with no retry, timeout or breaker policy.

const RATES = { EUR: "1.08", GBP: "1.27", JPY: "0.0067" };
let calls = 0;
function partner(currency) {
  calls += 1;
  if (calls === 1 || calls === 3) throw new Error("partner error"); // the partner fails now and then
  return RATES[currency];
}

for (const currency of ["EUR", "GBP", "JPY"]) {
  console.log(`app asks for ${currency}`);
  try {
    console.log(`${currency} = ${partner(currency)}`);
  } catch (error) {
    console.log(`${currency} unavailable: ${error.message}`); // every failure goes straight to the user
  }
}
