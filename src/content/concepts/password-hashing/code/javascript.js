// Password hashing in JavaScript: a fast unsalted hash versus a salted, slow one (PBKDF2).
// The salts are fixed so the output is deterministic. Real salts come from a secure random generator.
import { createHash, pbkdf2Sync, timingSafeEqual } from "node:crypto";

const hex = (buffer) => buffer.toString("hex");

// Bad: one fast hash, no salt. Same password gives the same hash, and guesses are very cheap.
const fastHash = (password) => hex(createHash("sha256").update(password).digest());

// Better: a unique salt per user and many iterations, so every guess is slow.
const ITERATIONS = 100_000;
const slowHash = (password, salt) => pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");

function verify(password, salt, stored) {
  const candidate = slowHash(password, salt);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored); // constant-time compare
}

console.log("unsalted fast hash:");
console.log(`  alice: ${fastHash("hunter2").slice(0, 24)}...`);
console.log(`  bob:   ${fastHash("hunter2").slice(0, 24)}...   <- identical, so one cracked guess breaks both`);

const aliceSalt = Buffer.from("0f1e2d3c4b5a69788796a5b4c3d2e1f0", "hex");
const bobSalt = Buffer.from("a1b2c3d4e5f60718293a4b5c6d7e8f90", "hex");
const aliceStored = slowHash("hunter2", aliceSalt);
const bobStored = slowHash("hunter2", bobSalt);

console.log("salted PBKDF2 (100000 iterations):");
console.log(`  alice: ${hex(aliceStored).slice(0, 24)}...`);
console.log(`  bob:   ${hex(bobStored).slice(0, 24)}...   <- different, though the password is the same`);

console.log(`alice logs in with hunter2: ${verify("hunter2", aliceSalt, aliceStored)}`);
console.log(`alice logs in with wrong1:  ${verify("wrong1", aliceSalt, aliceStored)}`);
