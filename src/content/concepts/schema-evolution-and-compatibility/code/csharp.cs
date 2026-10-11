// A tiny protobuf-like tag-length-value codec: field numbers, wire types, unknown fields skipped.
using System;
using System.Collections.Generic;
using System.Linq;

record Field(int Num, string Name, string Type);
record Decoded(List<(string Name, object Value)> Values, List<int> Unknown);

static class Codec
{
    static int Wire(string type) => type == "str" ? 2 : 0; // varint = 0, length-delimited = 2

    static object Zero(string type) => type == "int" ? 0L : type == "bool" ? false : "";

    static void Varint(List<int> o, long n)
    {
        while (n >= 128) { o.Add((int)(n % 128) | 128); n /= 128; }
        o.Add((int)n);
    }

    public static List<int> Encode(Field[] schema, Dictionary<string, object> msg)
    {
        var o = new List<int>();
        foreach (var f in schema)
        {
            if (!msg.ContainsKey(f.Name)) continue;
            Varint(o, f.Num * 8 + Wire(f.Type)); // the tag: number and wire type, never the name
            var v = msg[f.Name];
            if (f.Type == "str")
            {
                var s = (string)v;
                Varint(o, s.Length);
                o.AddRange(s.Select(c => (int)c));
            }
            else Varint(o, f.Type == "bool" ? ((bool)v ? 1 : 0) : Convert.ToInt64(v));
        }
        return o;
    }

    public static Decoded Decode(Field[] schema, List<int> data)
    {
        var values = new Dictionary<string, object>();
        var unknown = new List<int>();
        int i = 0;
        long ReadVarint()
        {
            long v = 0, m = 1; int b;
            do { b = data[i++]; v += (b & 127) * m; m *= 128; } while ((b & 128) != 0);
            return v;
        }
        while (i < data.Count)
        {
            long tag = ReadVarint();
            int num = (int)(tag / 8), wt = (int)(tag % 8);
            var f = schema.FirstOrDefault(x => x.Num == num);
            bool known = f != null && Wire(f.Type) == wt; // a wire-type mismatch is skipped like an unknown field
            if (wt == 0)
            {
                long v = ReadVarint();
                if (known) values[f!.Name] = f.Type == "bool" ? v != 0 : v; else unknown.Add(num);
            }
            else
            {
                int n = (int)ReadVarint();
                string s = new string(data.Skip(i).Take(n).Select(c => (char)c).ToArray());
                i += n;
                if (known) values[f!.Name] = s; else unknown.Add(num);
            }
        }
        var ordered = schema.Select(f => (f.Name, values.TryGetValue(f.Name, out var v) ? v : Zero(f.Type))).ToList(); // missing means zero value
        return new Decoded(ordered, unknown);
    }
}

static class Program
{
    static string Hex(List<int> b) => string.Join(" ", b.Select(x => x.ToString("x2")));

    static string Show(Decoded r)
    {
        string V(object v) => v is string s ? "\"" + s + "\"" : v is bool b ? (b ? "true" : "false") : v.ToString()!;
        return "{" + string.Join(",", r.Values.Select(p => "\"" + p.Name + "\":" + V(p.Value))) + "} unknown=[" + string.Join(",", r.Unknown) + "]";
    }

    static void Check(bool ok, string what)
    {
        if (!ok) { Console.WriteLine("FAILED: " + what); Environment.Exit(1); }
    }

    static object Get(Decoded r, string name) => r.Values.First(p => p.Name == name).Value;

    static void Main()
    {
        var v1 = new[] { new Field(1, "id", "int"), new Field(2, "amount_cents", "int"), new Field(4, "discount_cents", "int") };
        var v2 = v1.Append(new Field(5, "currency", "str")).ToArray(); // add a field: new number
        var old = Codec.Encode(v1, new() { ["id"] = 7, ["amount_cents"] = 1999, ["discount_cents"] = 500 });
        var neu = Codec.Encode(v2, new() { ["id"] = 7, ["amount_cents"] = 1999, ["discount_cents"] = 500, ["currency"] = "EUR" });
        Console.WriteLine("v1 bytes: " + Hex(old));
        Console.WriteLine("v2 bytes: " + Hex(neu));

        var fwd = Codec.Decode(v1, neu); // old reader, new data: forward compatible
        Console.WriteLine("old reader, new data: " + Show(fwd));
        Check((long)Get(fwd, "amount_cents") == 1999 && string.Join(",", fwd.Unknown) == "5", "forward");
        var bwd = Codec.Decode(v2, old); // new reader, old data: backward compatible
        Console.WriteLine("new reader, old data: " + Show(bwd));
        Check((long)Get(bwd, "amount_cents") == 1999 && (string)Get(bwd, "currency") == "", "backward");

        // Reuse field 4 for a different type (int cents -> bool) and the wire format cannot tell.
        var v3 = new[] { new Field(1, "id", "int"), new Field(2, "amount_cents", "int"), new Field(4, "gift_wrap", "bool") };
        var wrong = Codec.Decode(v3, old);
        Console.WriteLine("reused number, old data: " + Show(wrong));
        Check((bool)Get(wrong, "gift_wrap"), "500 cents silently became gift_wrap=true");
        var wrong2 = Codec.Decode(v1, Codec.Encode(v3, new() { ["id"] = 7, ["amount_cents"] = 1999, ["gift_wrap"] = true }));
        Console.WriteLine("reused number, new data: " + Show(wrong2));
        Check((long)Get(wrong2, "discount_cents") == 1, "gift_wrap=true silently became a 1 cent discount");

        // Reuse with a different wire type is skipped instead, which is safer but still loses the value.
        var v4 = new[] { new Field(1, "id", "int"), new Field(4, "promo", "str") };
        var skipped = Codec.Decode(v4, old);
        Console.WriteLine("reused as string: " + Show(skipped));
        Check((string)Get(skipped, "promo") == "" && string.Join(",", skipped.Unknown) == "2,4", "wire type mismatch skipped");

        // The fix: reserve 4 forever and give the new field a new number.
        var v5 = v1.Where(f => f.Num != 4).Append(new Field(6, "gift_wrap", "bool")).ToArray();
        var safe = Codec.Decode(v5, old);
        Console.WriteLine("fresh number: " + Show(safe));
        Check(!(bool)Get(safe, "gift_wrap") && string.Join(",", safe.Unknown) == "4", "fresh number");
        Console.WriteLine("all checks passed");
    }
}
