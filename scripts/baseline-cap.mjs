// How many how-to numbers scripts/walkthrough-baseline.json may hold: numbers the walkthrough check cannot reproduce on its own.
// The baseline is a list of known gaps, so it must not grow quietly. A new entry needs a hand check in a browser; only then
// raise this number in the same change, so a reviewer sees both. When the baseline shrinks, lower it to match (check:content says so).
export const BASELINE_CAP = 200;
