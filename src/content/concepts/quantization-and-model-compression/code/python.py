# 8-bit quantization in Python: round each weight to an integer from -127 to 127, then convert back.
WEIGHTS = [0.12, -0.5, 0.33, 0.9, -0.77, 0.05]

scale = max(abs(w) for w in WEIGHTS) / 127  # the largest weight maps to 127
quantized = [round(w / scale) for w in WEIGHTS]
restored = [q * scale for q in quantized]
largest_error = max(abs(a - b) for a, b in zip(WEIGHTS, restored))

print(f"scale: {scale:.5f}")
print("int8 values: " + ", ".join(str(q) for q in quantized))
print("restored:    " + ", ".join(f"{r:.4f}" for r in restored))
print(f"largest error: {largest_error:.4f}")
print(f"memory: {len(WEIGHTS) * 2} bytes as 16-bit, {len(WEIGHTS)} bytes as int8 (plus one scale)")
