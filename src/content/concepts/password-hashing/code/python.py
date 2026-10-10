"""Password hashing in Python: a fast unsalted hash versus a salted, slow one (PBKDF2).
The salts are fixed so the output is deterministic. Real salts come from a secure random generator."""
import hashlib
import hmac


# Bad: one fast hash, no salt. Same password gives the same hash, and guesses are very cheap.
def fast_hash(password):
    return hashlib.sha256(password.encode()).hexdigest()


# Better: a unique salt per user and many iterations, so every guess is slow.
ITERATIONS = 100_000


def slow_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, 32)


def verify(password, salt, stored):
    candidate = slow_hash(password, salt)
    return hmac.compare_digest(candidate, stored)  # constant-time compare


print("unsalted fast hash:")
print(f"  alice: {fast_hash('hunter2')[:24]}...")
print(f"  bob:   {fast_hash('hunter2')[:24]}...   <- identical, so one cracked guess breaks both")

alice_salt = bytes.fromhex("0f1e2d3c4b5a69788796a5b4c3d2e1f0")
bob_salt = bytes.fromhex("a1b2c3d4e5f60718293a4b5c6d7e8f90")
alice_stored = slow_hash("hunter2", alice_salt)
bob_stored = slow_hash("hunter2", bob_salt)

print("salted PBKDF2 (100000 iterations):")
print(f"  alice: {alice_stored.hex()[:24]}...")
print(f"  bob:   {bob_stored.hex()[:24]}...   <- different, though the password is the same")

print(f"alice logs in with hunter2: {str(verify('hunter2', alice_salt, alice_stored)).lower()}")
print(f"alice logs in with wrong1:  {str(verify('wrong1', alice_salt, alice_stored)).lower()}")
