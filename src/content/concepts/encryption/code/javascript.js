// Authenticated encryption (AES-256-GCM) in JavaScript, with tamper detection.
// The key and nonce are fixed so the output is deterministic. Real code uses a random key from a key service
// and a NEW random nonce for every message: reusing a nonce with the same key breaks the security.
import { createCipheriv, createDecipheriv } from "node:crypto";

const KEY_BYTES = 32; // 256-bit key
const NONCE_BYTES = 12; // 96-bit nonce, the size GCM is designed for

const key = Buffer.from(Array.from({ length: KEY_BYTES }, (_, i) => i));
const nonce = Buffer.from(Array.from({ length: NONCE_BYTES }, (_, i) => 100 + i));

function encrypt(plaintext) {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() }; // the tag proves the data was not changed
}

function decrypt({ ciphertext, tag }) {
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"); // throws if tampered
}

const sealed = encrypt("meet at noon");
console.log(`ciphertext: ${sealed.ciphertext.toString("hex")}`);
console.log(`tag:        ${sealed.tag.toString("hex")}`);
console.log(`decrypted:  ${decrypt(sealed)}`);

const tampered = { ciphertext: Buffer.from(sealed.ciphertext), tag: sealed.tag };
tampered.ciphertext[0] ^= 1; // an attacker flips one bit
try {
  decrypt(tampered);
} catch {
  console.log("tampered:   authentication failed, data rejected");
}
