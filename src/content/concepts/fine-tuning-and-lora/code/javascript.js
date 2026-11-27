// Counting trainable weights in JavaScript: full fine-tuning of one d x d matrix against a LoRA update of rank r.
const D = 4096;
const BYTES_PER_TRAINABLE_WEIGHT = 16; // 16-bit weight + 16-bit gradient + 32-bit Adam states, as in the ZeRO accounting

const full = D * D;
console.log(`full matrix: ${D} x ${D} = ${full} trainable weights`);
for (const rank of [8, 64]) {
  const lora = 2 * D * rank; // B is d x r and A is r x d
  console.log(`LoRA rank ${rank}: 2 x ${D} x ${rank} = ${lora} trainable weights (${((100 * lora) / full).toFixed(3)}%)`);
}

const MIB = 1024 * 1024;
console.log(`training state: ${(full * BYTES_PER_TRAINABLE_WEIGHT) / MIB} MiB for full tuning, ` +
  `${(2 * D * 8 * BYTES_PER_TRAINABLE_WEIGHT) / MIB} MiB for LoRA rank 8 (16 bytes per trainable weight)`);
