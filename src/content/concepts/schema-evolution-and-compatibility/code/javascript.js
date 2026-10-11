// A tiny protobuf-like tag-length-value codec: field numbers, wire types, unknown fields skipped.
const WIRE = { int: 0, bool: 0, str: 2 }; // varint = 0, length-delimited = 2
const ZERO = { int: 0, bool: false, str: "" };

function varint(n) {
  const out = [];
  while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); }
  out.push(n);
  return out;
}

function encode(schema, msg) {
  const out = [];
  for (const f of schema) {
    if (!(f.name in msg)) continue;
    out.push(...varint(f.num * 8 + WIRE[f.type])); // the tag: number and wire type, never the name
    if (f.type === "str") {
      const bytes = [...msg[f.name]].map((c) => c.charCodeAt(0));
      out.push(...varint(bytes.length), ...bytes);
    } else out.push(...varint(f.type === "bool" ? (msg[f.name] ? 1 : 0) : msg[f.name]));
  }
  return out;
}

function decode(schema, bytes) {
  const values = {}, unknown = [];
  let i = 0;
  const readVarint = () => { let v = 0, m = 1, b; do { b = bytes[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
  while (i < bytes.length) {
    const tag = readVarint(), num = Math.floor(tag / 8), wt = tag % 8;
    const f = schema.find((x) => x.num === num);
    const known = f && WIRE[f.type] === wt; // a wire-type mismatch is skipped like an unknown field
    if (wt === 0) { const v = readVarint(); if (known) values[f.name] = f.type === "bool" ? v !== 0 : v; else unknown.push(num); }
    else { const n = readVarint(); const s = String.fromCharCode(...bytes.slice(i, i + n)); i += n; if (known) values[f.name] = s; else unknown.push(num); }
  }
  const ordered = {};
  for (const f of schema) ordered[f.name] = f.name in values ? values[f.name] : ZERO[f.type]; // missing means zero value
  return { values: ordered, unknown };
}

const hex = (b) => b.map((x) => x.toString(16).padStart(2, "0")).join(" ");
const show = (r) => JSON.stringify(r.values) + " unknown=[" + r.unknown.join(",") + "]";
const check = (ok, what) => { if (!ok) { console.log("FAILED: " + what); process.exit(1); } };

const v1 = [{ num: 1, name: "id", type: "int" }, { num: 2, name: "amount_cents", type: "int" }, { num: 4, name: "discount_cents", type: "int" }];
const v2 = [...v1, { num: 5, name: "currency", type: "str" }]; // add a field: new number
const old = encode(v1, { id: 7, amount_cents: 1999, discount_cents: 500 });
const neu = encode(v2, { id: 7, amount_cents: 1999, discount_cents: 500, currency: "EUR" });
console.log("v1 bytes: " + hex(old));
console.log("v2 bytes: " + hex(neu));

const fwd = decode(v1, neu); // old reader, new data: forward compatible
console.log("old reader, new data: " + show(fwd));
check(fwd.values.amount_cents === 1999 && fwd.unknown.join() === "5", "forward");
const bwd = decode(v2, old); // new reader, old data: backward compatible
console.log("new reader, old data: " + show(bwd));
check(bwd.values.amount_cents === 1999 && bwd.values.currency === "", "backward");

// Reuse field 4 for a different type (int cents -> bool) and the wire format cannot tell.
const v3 = [{ num: 1, name: "id", type: "int" }, { num: 2, name: "amount_cents", type: "int" }, { num: 4, name: "gift_wrap", type: "bool" }];
const wrong = decode(v3, old);
console.log("reused number, old data: " + show(wrong));
check(wrong.values.gift_wrap === true, "500 cents silently became gift_wrap=true");
const wrong2 = decode(v1, encode(v3, { id: 7, amount_cents: 1999, gift_wrap: true }));
console.log("reused number, new data: " + show(wrong2));
check(wrong2.values.discount_cents === 1, "gift_wrap=true silently became a 1 cent discount");

// Reuse with a different wire type is skipped instead, which is safer but still loses the value.
const v4 = [{ num: 1, name: "id", type: "int" }, { num: 4, name: "promo", type: "str" }];
const skipped = decode(v4, old);
console.log("reused as string: " + show(skipped));
check(skipped.values.promo === "" && skipped.unknown.join() === "2,4", "wire type mismatch skipped");

// The fix: reserve 4 forever and give the new field a new number.
const v5 = [...v1.filter((f) => f.num !== 4), { num: 6, name: "gift_wrap", type: "bool" }];
const safe = decode(v5, old);
console.log("fresh number: " + show(safe));
check(safe.values.gift_wrap === false && safe.unknown.join() === "4", "fresh number");
console.log("all checks passed");
