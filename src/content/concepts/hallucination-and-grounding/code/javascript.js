// A claim checker in JavaScript: a claim is "supported" if all its content words appear in one source sentence.
const SOURCES = [
  "the refund window is 30 days from delivery",
  "refunds go back to the original payment method",
  "gift cards cannot be refunded",
];
const CLAIMS = [
  "the refund window is 30 days",
  "refunds go to the original payment method",
  "refunds are also sent as store credit",
  "the refund window is 60 days",
];
const STOP_WORDS = new Set(["the", "is", "to", "are", "be", "a", "as"]);

function supported(claim) {
  const words = claim.split(" ").filter((w) => !STOP_WORDS.has(w));
  return SOURCES.some((source) => {
    const sourceWords = new Set(source.split(" "));
    return words.every((w) => sourceWords.has(w));
  });
}

let unsupported = 0;
for (const claim of CLAIMS) {
  const ok = supported(claim);
  if (!ok) unsupported += 1;
  console.log(`${ok ? "supported:  " : "unsupported:"} ${claim}`);
}
console.log(`unsupported claims: ${unsupported} of ${CLAIMS.length} (${Math.floor((unsupported * 100) / CLAIMS.length)}%)`);
