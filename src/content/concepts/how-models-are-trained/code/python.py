# Gradient descent in Python on the loss (w - 3)^2: the weight w should end up at 3.
LEARNING_RATE = 0.1
w = 0.0

print(f"step 0: w={w:.4f}, loss={(w - 3) ** 2:.4f}")
for step in range(1, 6):
    gradient = 2 * (w - 3)  # how the loss changes if w changes a little
    w = w - LEARNING_RATE * gradient  # move against the gradient
    print(f"step {step}: w={w:.4f}, loss={(w - 3) ** 2:.4f}")
