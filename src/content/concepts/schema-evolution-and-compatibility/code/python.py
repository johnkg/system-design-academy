# A tiny protobuf-like tag-length-value codec: field numbers, wire types, unknown fields skipped.
import json
import sys

WIRE = {"int": 0, "bool": 0, "str": 2}  # varint = 0, length-delimited = 2
ZERO = {"int": 0, "bool": False, "str": ""}
# A varint byte holds 7 value bits; its high bit says another byte follows.
VARINT_BASE, CONTINUE_BIT, VALUE_MASK = 128, 128, 127
TAG_BASE = 8  # tag = field number * 8 + wire type (3 bits)


def varint(n):
    out = []
    while n >= VARINT_BASE:
        out.append((n % VARINT_BASE) | CONTINUE_BIT)
        n //= VARINT_BASE
    out.append(n)
    return out


def encode(schema, msg):
    out = []
    for f in schema:
        if f["name"] not in msg:
            continue
        out += varint(f["num"] * TAG_BASE + WIRE[f["type"]])  # the tag: number and wire type, never the name
        if f["type"] == "str":
            data = [ord(c) for c in msg[f["name"]]]
            out += varint(len(data)) + data
        else:
            v = msg[f["name"]]
            out += varint((1 if v else 0) if f["type"] == "bool" else v)
    return out


def decode(schema, data):
    values, unknown, i = {}, [], 0

    def read_varint():
        nonlocal i
        v, m = 0, 1
        while True:
            b = data[i]
            i += 1
            v += (b & VALUE_MASK) * m
            m *= VARINT_BASE
            if not b & CONTINUE_BIT:
                return v

    while i < len(data):
        tag = read_varint()
        num, wt = tag // TAG_BASE, tag % TAG_BASE
        f = next((x for x in schema if x["num"] == num), None)
        known = f is not None and WIRE[f["type"]] == wt  # a wire-type mismatch is skipped like an unknown field
        if wt == 0:
            v = read_varint()
            if known:
                values[f["name"]] = (v != 0) if f["type"] == "bool" else v
            else:
                unknown.append(num)
        else:
            n = read_varint()
            s = "".join(chr(c) for c in data[i:i + n])
            i += n
            if known:
                values[f["name"]] = s
            else:
                unknown.append(num)
    ordered = {f["name"]: values.get(f["name"], ZERO[f["type"]]) for f in schema}  # missing means zero value
    return {"values": ordered, "unknown": unknown}


def hexs(b):
    return " ".join("%02x" % x for x in b)


def show(r):
    return json.dumps(r["values"], separators=(",", ":")) + " unknown=[" + ",".join(map(str, r["unknown"])) + "]"


def check(ok, what):
    if not ok:
        print("FAILED: " + what)
        sys.exit(1)


def F(num, name, type_):
    return {"num": num, "name": name, "type": type_}


v1 = [F(1, "id", "int"), F(2, "amount_cents", "int"), F(4, "discount_cents", "int")]
v2 = v1 + [F(5, "currency", "str")]  # add a field: new number
old = encode(v1, {"id": 7, "amount_cents": 1999, "discount_cents": 500})
new = encode(v2, {"id": 7, "amount_cents": 1999, "discount_cents": 500, "currency": "EUR"})
print("v1 bytes: " + hexs(old))
print("v2 bytes: " + hexs(new))

fwd = decode(v1, new)  # old reader, new data: forward compatible
print("old reader, new data: " + show(fwd))
check(fwd["values"]["amount_cents"] == 1999 and fwd["unknown"] == [5], "forward")
bwd = decode(v2, old)  # new reader, old data: backward compatible
print("new reader, old data: " + show(bwd))
check(bwd["values"]["amount_cents"] == 1999 and bwd["values"]["currency"] == "", "backward")

# Reuse field 4 for a different type (int cents -> bool) and the wire format cannot tell.
v3 = [F(1, "id", "int"), F(2, "amount_cents", "int"), F(4, "gift_wrap", "bool")]
wrong = decode(v3, old)
print("reused number, old data: " + show(wrong))
check(wrong["values"]["gift_wrap"] is True, "500 cents silently became gift_wrap=true")
wrong2 = decode(v1, encode(v3, {"id": 7, "amount_cents": 1999, "gift_wrap": True}))
print("reused number, new data: " + show(wrong2))
check(wrong2["values"]["discount_cents"] == 1, "gift_wrap=true silently became a 1 cent discount")

# Reuse with a different wire type is skipped instead, which is safer but still loses the value.
v4 = [F(1, "id", "int"), F(4, "promo", "str")]
skipped = decode(v4, old)
print("reused as string: " + show(skipped))
check(skipped["values"]["promo"] == "" and skipped["unknown"] == [2, 4], "wire type mismatch skipped")

# The fix: reserve 4 forever and give the new field a new number.
v5 = [f for f in v1 if f["num"] != 4] + [F(6, "gift_wrap", "bool")]
safe = decode(v5, old)
print("fresh number: " + show(safe))
check(safe["values"]["gift_wrap"] is False and safe["unknown"] == [4], "fresh number")
print("all checks passed")
