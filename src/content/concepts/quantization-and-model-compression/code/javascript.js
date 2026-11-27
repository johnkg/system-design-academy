// 8-bit quantization in JavaScript: round each weight to an integer from -127 to 127, then convert back.
const WEIGHTS = [0.12, -0.5, 0.33, 0.9, -0.77, 0.05];

const scale = Math.max(...WEIGHTS.map(Math.abs)) / 127; // the largest weight maps to 127
const quantized = WEIGHTS.map((w) => Math.round(w / scale));
const restored = quantized.map((q) => q * scale);
const largestError = Math.max(...WEIGHTS.map((w, i) => Math.abs(w - restored[i])));

console.log(`scale: ${scale.toFixed(5)}`);
console.log("int8 values: " + quantized.join(", "));
console.log("restored:    " + restored.map((r) => r.toFixed(4)).join(", "));
console.log(`largest error: ${largestError.toFixed(4)}`);
console.log(`memory: ${WEIGHTS.length * 2} bytes as 16-bit, ${WEIGHTS.length} bytes as int8 (plus one scale)`);
