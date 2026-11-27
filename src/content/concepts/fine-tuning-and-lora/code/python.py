# Counting trainable weights in Python: full fine-tuning of one d x d matrix against a LoRA update of rank r.
D = 4096
BYTES_PER_TRAINABLE_WEIGHT = 16  # 16-bit weight + 16-bit gradient + 32-bit Adam states, as in the ZeRO accounting

full = D * D
print(f"full matrix: {D} x {D} = {full} trainable weights")
for rank in (8, 64):
    lora = 2 * D * rank  # B is d x r and A is r x d
    print(f"LoRA rank {rank}: 2 x {D} x {rank} = {lora} trainable weights ({100 * lora / full:.3f}%)")

mib = 1024 * 1024
print(f"training state: {full * BYTES_PER_TRAINABLE_WEIGHT // mib} MiB for full tuning, "
      f"{2 * D * 8 * BYTES_PER_TRAINABLE_WEIGHT // mib} MiB for LoRA rank 8 (16 bytes per trainable weight)")
