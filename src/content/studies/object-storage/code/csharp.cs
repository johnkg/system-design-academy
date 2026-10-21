// An erasure-coded object store in miniature, in C#:
// a Reed-Solomon code (4 data + 2 parity shards) over GF(256), shards placed on racks, disks and racks failing, and repair.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

const int K = 4, M = 2, N = K + M;                   // any K of the N shards rebuild the object
const int RACKS = N, DISKS = 8, OBJECTS = 200, ROUNDS = 20;
const double P_DISK = 0.02, P_RACK = 0.03;
const int OBJECT_BYTES = 64, SHARD_BYTES = OBJECT_BYTES / K;
const uint PLACE_SEED = 7, FAIL_SEED = 99;
const double P_LOSS = 0.01, PER_BILLION = 1e9; // durability maths: each disk lost with probability 1%
// GF(256): 256 elements, a multiplicative group of order 255, generated modulo x^8 + x^4 + x^3 + x^2 + 1.
const int GF_SIZE = 256, GF_ORDER = GF_SIZE - 1, GF_POLY = 0x11d;

// Arithmetic in GF(256): addition is XOR, multiplication goes through log and antilog tables.
var EXP = new int[2 * GF_SIZE]; var LOG = new int[GF_SIZE];
for (int i = 0, x = 1; i < GF_ORDER; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if ((x & GF_SIZE) != 0) x ^= GF_POLY; }
for (int i = GF_ORDER; i < 2 * GF_SIZE; i++) EXP[i] = EXP[i - GF_ORDER];
int Mul(int a, int b) => a != 0 && b != 0 ? EXP[LOG[a] + LOG[b]] : 0;
int Inv(int a) => EXP[GF_ORDER - LOG[a]];

// Row s of the coding matrix: shards 0..K-1 are the data itself, the rest are Cauchy rows, so any K rows can be inverted.
int[] Row(int s) => Enumerable.Range(0, K).Select(j => s < K ? (s == j ? 1 : 0) : Inv(s ^ j)).ToArray();

byte[][] Encode(byte[] data) {                       // data is split in K pieces, and N shards come out
  int len = data.Length / K;
  return Enumerable.Range(0, N).Select(s => {
    var r = Row(s);
    return Enumerable.Range(0, len).Select(t => (byte)Enumerable.Range(0, K).Aggregate(0, (acc, j) => acc ^ Mul(r[j], data[j * len + t]))).ToArray();
  }).ToArray();
}

int[][] Invert(int[][] a) {                          // Gauss-Jordan elimination in GF(256)
  var m = a.Select((r, i) => r.Concat(Enumerable.Range(0, K).Select(j => i == j ? 1 : 0)).ToArray()).ToArray();
  for (int c = 0; c < K; c++) {
    int p = c; while (m[p][c] == 0) p++;
    (m[c], m[p]) = (m[p], m[c]);
    int iv = Inv(m[c][c]); m[c] = m[c].Select(v => Mul(v, iv)).ToArray();
    for (int r = 0; r < K; r++) if (r != c && m[r][c] != 0) { int f = m[r][c]; int[] pivot = m[c]; m[r] = m[r].Select((v, j) => v ^ Mul(f, pivot[j])).ToArray(); }
  }
  return m.Select(r => r.Skip(K).ToArray()).ToArray();
}

byte[]? Decode(byte[]?[] shards) {                   // shards has null where a shard is gone; needs at least K of them
  var have = Enumerable.Range(0, N).Where(i => shards[i] != null).Take(K).ToArray();
  if (have.Length < K) return null;
  var back = Invert(have.Select(Row).ToArray()); int len = shards[have[0]]!.Length; var o = new byte[K * len];
  for (int j = 0; j < K; j++) for (int t = 0; t < len; t++) { int acc = 0; for (int i = 0; i < K; i++) acc ^= Mul(back[j][i], shards[have[i]]![t]); o[j * len + t] = (byte)acc; }
  return o;
}

bool Same(byte[]? a, byte[] b) => a != null && a.SequenceEqual(b);
Func<double> Mulberry32(uint a) => () => { a += 0x6D2B79F5; uint t = (a ^ (a >> 15)) * (1 | a); t = (t + (t ^ (t >> 7)) * (61 | t)) ^ t; return (t ^ (t >> 14)) / 4294967296.0; };

(int lost, int rebuilt, int read, int wrote) Simulate(bool spread) {   // spread: one shard per rack; otherwise all shards in one rack
  var place = Mulberry32(PLACE_SEED); var fail = Mulberry32(FAIL_SEED);  // separate streams, so both layouts face the same failures
  int Ri(int n) => (int)Math.Floor(place() * n);
  int Pick(int rack, HashSet<int> used) { int d; do d = rack * DISKS + Ri(DISKS); while (used.Contains(d)); return d; }
  var objects = Enumerable.Range(0, OBJECTS).Select(_ => {
    var data = Enumerable.Range(0, OBJECT_BYTES).Select(__ => (byte)Ri(GF_SIZE)).ToArray(); int home = Ri(RACKS); var used = new HashSet<int>(); var loc = new List<int>();
    for (int s = 0; s < N; s++) { int d = Pick(spread ? s : home, used); used.Add(d); loc.Add(d); }
    return (data, shards: Encode(data).Select(x => (byte[]?)x).ToArray(), loc, lost: false);
  }).ToList();
  int lost = 0, rebuilt = 0, read = 0, wrote = 0;
  for (int r = 0; r < ROUNDS; r++) {
    var dead = new HashSet<int>();
    for (int rack = 0; rack < RACKS; rack++) if (fail() < P_RACK) for (int d = 0; d < DISKS; d++) dead.Add(rack * DISKS + d);
    for (int d = 0; d < RACKS * DISKS; d++) if (fail() < P_DISK) dead.Add(d);
    for (int i = 0; i < objects.Count; i++) {
      var o = objects[i];
      if (o.lost) continue;
      for (int s = 0; s < N; s++) if (dead.Contains(o.loc[s])) o.shards[s] = null;
      var missing = Enumerable.Range(0, N).Where(s => o.shards[s] == null).ToList();
      if (missing.Count == 0) continue;
      var data = Decode(o.shards);
      if (data == null) { objects[i] = (o.data, o.shards, o.loc, true); lost++; continue; }
      var fresh = Encode(data); var used = new HashSet<int>(o.loc);
      foreach (int s in missing) { int d = Pick(o.loc[s] / DISKS, used); used.Add(d); o.loc[s] = d; o.shards[s] = fresh[s]; wrote += SHARD_BYTES; rebuilt++; }
      read += K * SHARD_BYTES;                                // one decode reads K shards of 16 bytes, however many shards are rebuilt
    }
  }
  foreach (var o in objects) if (!o.lost && !Same(Decode(o.shards), o.data)) throw new Exception("corrupt object");
  return (lost, rebuilt, read, wrote);
}

// Chance that an object is lost when each shard is lost with probability p before repair: more than tol shards gone.
double Loss(int n, int tol, double p) {
  double total = 0, c = 1;
  for (int i = 0; i <= n; i++) {
    if (i > 0) c = (c * (n - i + 1)) / i;
    double t = c; for (int j = 0; j < i; j++) t *= p; for (int j = 0; j < n - i; j++) t *= 1 - p;
    if (i > tol) total += t;
  }
  return total;
}
long PerBillion(double x) => (long)Math.Floor(x * PER_BILLION + 0.5);

// 1. Every pattern of up to M missing shards decodes; M+1 missing shards never do.
var sample = Enumerable.Range(0, OBJECT_BYTES).Select(i => (byte)((i * 37 + 11) & 255)).ToArray(); var whole = Encode(sample);
int ok = 0, fine = 0, dead2 = 0, tooMany = 0;
for (int mask = 0; mask < 1 << N; mask++) {
  int gone = Convert.ToString(mask, 2).Count(ch => ch == '1');
  if (gone > M + 1) continue;
  var o = Decode(Enumerable.Range(0, N).Select(i => (mask >> i & 1) != 0 ? null : whole[i]).ToArray());
  if (gone <= M) { fine++; if (Same(o, sample)) ok++; } else { tooMany++; if (o == null) dead2++; }
}
Console.WriteLine($"{K}+{M} code: {ok} of {fine} patterns with up to {M} lost shards decode correctly; {dead2} of {tooMany} with {M + 1} lost cannot");
Console.WriteLine($"storage overhead {((double)N / K).ToString("F2", CultureInfo.InvariantCulture)}x, against 3.00x for three copies");

// 2. Racks and disks fail for 20 rounds, and repair runs after every round.
foreach (bool spread in new[] { true, false }) {
  var s = Simulate(spread);
  Console.WriteLine($"{(spread ? "one shard per rack  " : "all shards in a rack")}: lost {s.lost} of {OBJECTS} objects, rebuilt {s.rebuilt} shards, read {s.read} bytes and wrote {s.wrote} bytes");
}

// 3. The same durability maths for three layouts when each disk is lost with probability 1%.
foreach (var (name, n, tol) in new[] { ("3 copies", 3, 2), ("4+2", 6, 2), ("10+4", 14, 4) })
  Console.WriteLine($"{name.PadRight(8)} loses {PerBillion(Loss(n, tol, P_LOSS))} objects per billion");
if (ok != fine || dead2 != tooMany || Simulate(true).lost >= Simulate(false).lost) Environment.Exit(1);
