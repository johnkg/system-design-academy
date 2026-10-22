// Generating short codes in JavaScript: a counter, scrambled so it is not guessable, encoded in base62.

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BASE = 62n; // digits, lower case and upper case letters
const LENGTH = 7n;
const SPACE = BASE ** LENGTH; // 3,521,614,606,208 distinct 7-character codes
const MULTIPLIER = 1442695040888963407n; // odd and not a multiple of 31, so it shares no factor with 62^7

function encode(number) {
  let code = "";
  for (let n = number; n > 0n; n /= BASE) code = ALPHABET[Number(n % BASE)] + code;
  return code.padStart(Number(LENGTH), "0");
}

function decode(code) {
  return [...code].reduce((n, ch) => n * BASE + BigInt(ALPHABET.indexOf(ch)), 0n);
}

// Multiplying by a number that shares no factor with SPACE maps every id to a different value,
// so codes stay unique but consecutive ids no longer look consecutive.
const scramble = (id) => (id * MULTIPLIER) % SPACE;

function shortCode(id) {
  return encode(scramble(BigInt(id)));
}

const SAMPLE = 125n, ID_COUNT = 100000;
console.log(`plain base62 of 125:   ${encode(SAMPLE)}`);
console.log(`round trip of 125:     ${decode(encode(SAMPLE))}`);
for (const id of [1, 2, 3]) console.log(`id ${id} becomes code:   ${shortCode(id)}`);

const codes = new Set();
for (let id = 1; id <= ID_COUNT; id++) codes.add(shortCode(id));
console.log(`100000 ids gave ${codes.size} distinct codes`);
console.log(`7 characters allow ${SPACE} links`);
