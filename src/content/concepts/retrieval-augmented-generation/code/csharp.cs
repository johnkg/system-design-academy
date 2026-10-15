// A tiny RAG retriever in C#: chunk, score with term overlap weighted by idf, optionally rerank, pack into a token budget.
// No embeddings: the scorer is lexical, which is enough to show where chunk size, top-k and the budget change the answer.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

var docs = new Dictionary<string, string> {
    ["returns"] = "Returns policy. Customers may return unused accessories such as cables and cases within 14 days of delivery. Opened software cannot be refunded. Refunds go back to the original payment method within 5 business days. Returns of laptops are accepted within 30 days of delivery if the device works and all original packaging is included. Gift purchases can be returned for store credit only.",
    ["shipping"] = "Shipping and delivery. Standard delivery takes 3 to 5 days and express delivery takes 1 to 2 days. A laptop ships in a padded box and needs a signature on delivery. After delivery you can track the parcel for 30 days. Delivery to islands can take 10 days.",
    ["warranty"] = "Laptop warranty. The warranty covers defects for 12 months after delivery. To claim, send the laptop back to a service centre with the order number. We repair or replace the laptop within 21 days. Damage from liquids is not covered.",
    ["payments"] = "Payments. We accept cards and bank transfer. Invoices are due in 30 days. A failed payment is retried twice before the order is cancelled.",
};
const string Answer = "laptops are accepted within 30 days of delivery";
var stop = new HashSet<string>("how can i a an the of to is are in on and or for after you your with by it".Split(' '));

string[] Words(string t) => Regex.Replace(t.ToLowerInvariant(), "[^a-z0-9 ]", " ").Split(' ', StringSplitOptions.RemoveEmptyEntries);
string Stem(string w) => w.Length > 3 && w.EndsWith('s') ? w[..^1] : w;
// integer idf in half-octave steps: rarer terms weigh more, and every language computes the same number
int IdfOf(int n, int df) {
  long x = 4096L * n / df; int b = 0;
  for (long y = x; y > 1; y /= 2) b++;
  return 2 * b + (b >= 1 ? (int)(x / (1L << (b - 1)) % 2) : 0);
}
int TokensOf(int wordCount) => (wordCount * 13 + 9) / 10 + 6; // about 1.3 tokens per word plus a citation header

List<Chunk> MakeChunks(int size, int overlap) {
  if (overlap >= size) throw new ArgumentException("overlap must be smaller than the chunk size");
  var outList = new List<Chunk>();
  foreach (var (doc, text) in docs) {
    var w = Words(text);
    for (int s = 0, n = 0; ; s += size - overlap, n++) {
      outList.Add(new Chunk($"{doc}#{n}", w.Skip(s).Take(size).ToArray()));
      if (s + size >= w.Length) break;
    }
  }
  return outList;
}

(int, List<Chunk>, List<Chunk>, int) Retrieve(string query, int size, int overlap, int k, bool rerank, int budget) {
  var chunks = MakeChunks(size, overlap);
  var terms = Words(query).Where(w => !stop.Contains(w)).Select(Stem).Distinct().ToList();
  var idf = new Dictionary<string, int>();
  foreach (var t in terms) {
    int df = chunks.Count(c => c.Words.Select(Stem).Contains(t));
    if (df > 0) idf[t] = IdfOf(chunks.Count, df);
  }
  int Idf(string t) => idf.GetValueOrDefault(t, 0);
  foreach (var c in chunks) {
    var stems = c.Words.Select(Stem).ToArray();
    c.Score = terms.Sum(t => Idf(t) * Math.Min(stems.Count(x => x == t), 2));
  }
  var ranked = chunks.Where(c => c.Score > 0).OrderBy(c => -c.Score).ThenBy(c => c.Id, StringComparer.Ordinal).ToList();
  if (rerank) { // second stage on the 8 best candidates: reward a dense 12 word window instead of scattered matches
    ranked = ranked.Take(8).ToList();
    foreach (var c in ranked) {
      var stems = c.Words.Select(Stem).ToArray();
      int best = 0;
      for (int s = 0; s < stems.Length; s++) best = Math.Max(best, terms.Where(t => stems.Skip(s).Take(12).Contains(t)).Sum(Idf));
      c.Score = best * 4 + c.Score / 4;
    }
    ranked = ranked.OrderBy(c => -c.Score).ThenBy(c => c.Id, StringComparer.Ordinal).ToList();
  }
  var context = new List<Chunk>(); int used = 0;
  foreach (var c in ranked.Take(k)) { // greedy packing: stop adding chunks that do not fit
    int cost = TokensOf(c.Words.Length);
    if (used + cost <= budget) { context.Add(c); used += cost; }
  }
  return (chunks.Count, ranked.Take(k).ToList(), context, used);
}

var answerStems = Words(Answer).Select(Stem).ToArray();
bool HasAnswer(Chunk c) {
  var s = c.Words.Select(Stem).ToArray();
  for (int i = 0; i + answerStems.Length <= s.Length; i++) if (s.Skip(i).Take(answerStems.Length).SequenceEqual(answerStems)) return true;
  return false;
}

const string Q = "how long can I send back a laptop after delivery";
var configs = new (string Name, int Size, int Overlap, int K, bool Rerank, int Budget, bool Expected)[] { // Expected: the full answer sentence must reach the prompt
  ("30 words, no overlap, k=3", 30, 0, 3, false, 300, false),
  ("30 words, overlap 10, k=3", 30, 10, 3, false, 300, true),
  ("20 words, overlap 10, k=5", 20, 10, 5, false, 300, false),
  ("same + rerank", 20, 10, 5, true, 300, true),
  ("60 words, k=3, budget 60", 60, 0, 3, false, 60, false),
};
foreach (var o in configs) {
  var (n, top, context, used) = Retrieve(Q, o.Size, o.Overlap, o.K, o.Rerank, o.Budget);
  bool hit = context.Any(HasAnswer);
  Console.WriteLine($"{o.Name}: {n} chunks, top {string.Join(" ", top.Select(c => $"{c.Id}={c.Score}"))}");
  Console.WriteLine($"  context {used}/{o.Budget} tokens, answer sentence intact: {(hit ? "true" : "false")}");
  if (hit != o.Expected || used > o.Budget) Environment.Exit(1);
}

class Chunk(string id, string[] words) { public string Id = id; public string[] Words = words; public int Score; }
