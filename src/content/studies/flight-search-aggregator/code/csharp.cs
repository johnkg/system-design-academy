// A flight search fan-out in C#: ask every provider at once with its own timeout and one global deadline, stream the
// answers as they arrive, serve fares from a short-lived cache, skip a failing provider with a circuit breaker, merge the same
// itinerary sold by several providers, and check the chosen price live before handing the traveller over.
// Time is simulated (milliseconds within a search, minutes between searches), so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Linq;

public record Provider(string Name, int Typical, int Markup);
public record Itinerary(string Key, string Label, int Base, int[] Sellers);
public record Offer(string Key, int Price, int Seller);
public record Event(int At, int P, string Text, List<Offer> Offers);
public record Row(Itinerary It, List<Offer> Offers);
public class Breaker { public int Fails; public int OpenUntil = -1; }
public record Cached(int At, List<Offer> Offers);

public static class Program
{
    const int DeadlineMs = 3000; // the whole search closes here
    const int TimeoutFactor = 2; // a provider's own timeout is twice its typical latency, capped by the deadline
    const int TtlMin = 5; // a cached fare is served for 5 minutes
    const int BreakerFails = 2; // failures in a row that open a provider's breaker
    const int BreakerOpenMin = 4; // minutes the breaker stays open before one trial call
    const int CacheMs = 5; // time to answer from the cache
    const int JitterMin = 50, JitterSpan = 100; // a live call takes 50% to 149% of the provider's typical latency

    static readonly Provider[] Providers =
    {
        new("airline-1", 400, 0), new("airline-2", 700, 0), new("ota-1", 1200, 9), new("ota-2", 1500, 4), new("gds-1", 2000, -6),
    };
    static readonly Itinerary[] Itineraries = // the same flights are sold by several providers
    {
        new("XA101", "07:10 nonstop 7h10", 420, new[] { 0, 2, 3, 4 }),
        new("XA105", "13:40 nonstop 7h25", 395, new[] { 0, 3, 4 }),
        new("YB220+YB31", "09:05 one stop 10h40", 330, new[] { 1, 2, 4 }),
    };
    const string FareRiseKey = "YB220+YB31"; const int FareRiseMinute = 7, FareRiseBy = 34; // the cheap fare class sells out at minute 7
    const int OutageProvider = 4, OutageFrom = 5, OutageTo = 11; // gds-1 stops answering from minute 5 to minute 11
    static readonly int[] Searches = { 0, 3, 6, 7, 8, 12 }; // minutes at which travellers search the same route
    const int SelectAt = 8; // the traveller at minute 8 picks the cheapest result

    static long seed = 7;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }
    static string Plural(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";

    static int Fare(Itinerary it, int minute) => it.Base + (it.Key == FareRiseKey && minute >= FareRiseMinute ? FareRiseBy : 0);
    static List<Offer> OffersOf(int p, int minute) =>
        Itineraries.Where(it => it.Sellers.Contains(p)).Select(it => new Offer(it.Key, Fare(it, minute) + Providers[p].Markup, p)).ToList();

    static readonly Dictionary<int, Cached> Cache = new(); // provider -> cached offers
    static readonly Breaker[] Breakers = Providers.Select(_ => new Breaker()).ToArray();
    static int live, cached, timeouts, skipped;

    static List<Row> Search(int minute)
    {
        var events = new List<Event>();
        for (int p = 0; p < Providers.Length; p++)
        {
            var prov = Providers[p]; var br = Breakers[p];
            if (Cache.TryGetValue(p, out var hit) && minute - hit.At < TtlMin)
            {
                cached++;
                events.Add(new Event(CacheMs, p, $"{Plural(hit.Offers.Count, "offer")} from cache (age {minute - hit.At} min)", hit.Offers));
                continue;
            }
            if (br.OpenUntil > minute) { skipped++; events.Add(new Event(0, p, "skipped, breaker open", new List<Offer>())); continue; }
            live++;
            int timeout = Math.Min(TimeoutFactor * prov.Typical, DeadlineMs);
            int latency = prov.Typical * (JitterMin + Random(JitterSpan)) / 100;
            bool down = p == OutageProvider && minute >= OutageFrom && minute < OutageTo;
            if (down || latency > timeout)
            {
                timeouts++; br.Fails++;
                var text = $"no answer, gave up at {timeout} ms";
                if (br.Fails >= BreakerFails) { br.OpenUntil = minute + BreakerOpenMin; text += $"; breaker opens until minute {br.OpenUntil}"; }
                events.Add(new Event(timeout, p, text, new List<Offer>()));
                continue;
            }
            br.Fails = 0;
            var offers = OffersOf(p, minute);
            Cache[p] = new Cached(minute, offers);
            events.Add(new Event(latency, p, $"{Plural(offers.Count, "offer")} live", offers));
        }
        events = events.OrderBy(e => e.At).ThenBy(e => e.P).ToList();
        Console.WriteLine($"search at minute {minute}");
        foreach (var e in events) Console.WriteLine($"  +{e.At.ToString().PadLeft(4)} ms  {Providers[e.P].Name.PadRight(9)} {e.Text}"); // streamed to the browser in this order
        var answered = events.Where(e => e.Offers.Count > 0).ToList();
        int first = answered.Count > 0 ? answered[0].At : DeadlineMs;
        int complete = events.Select(e => e.At).Prepend(0).Max();
        Console.WriteLine($"  first prices after {first} ms, search complete after {complete} ms, {answered.Count} of {Providers.Length} providers answered");
        return Merge(answered.SelectMany(e => e.Offers).ToList());
    }

    // One row per itinerary, with every seller's price, sorted by the best price.
    static List<Row> Merge(List<Offer> offers)
    {
        var rows = Itineraries
            .Select(it => new Row(it, offers.Where(o => o.Key == it.Key).OrderBy(o => o.Price).ThenBy(o => o.Seller).ToList()))
            .Where(r => r.Offers.Count > 0)
            .OrderBy(r => r.Offers[0].Price).ThenBy(r => r.It.Key, StringComparer.Ordinal)
            .ToList();
        Console.WriteLine($"  merged {offers.Count} offers into {rows.Count} itineraries:");
        foreach (var r in rows) Console.WriteLine($"    {r.It.Label.PadRight(21)} {r.Offers[0].Price} at {Providers[r.Offers[0].Seller].Name}, {r.Offers.Count} sellers");
        return rows;
    }

    public static int Main()
    {
        Row? chosen = null; int chosenMinute = 0;
        foreach (var minute in Searches)
        {
            var rows = Search(minute);
            if (minute == SelectAt) { chosen = rows[0]; chosenMinute = minute; }
        }

        // The traveller clicks the top result. The shown price may come from the cache, so ask the seller for the live price first.
        var best = chosen!.Offers[0];
        var it = chosen.It;
        int livePrice = Fare(it, chosenMinute) + Providers[best.Seller].Markup;
        Console.WriteLine($"selected {it.Key} at {best.Price} from {Providers[best.Seller].Name}; live price check says {livePrice}");
        Console.WriteLine(livePrice == best.Price ? "price confirmed, handing over to the seller" : $"price changed by {livePrice - best.Price}, shown to the traveller before handing over");
        Console.WriteLine($"provider calls {live}, answered from cache {cached}, timed out {timeouts}, skipped by breaker {skipped}");

        if (cached == 0 || skipped == 0 || livePrice == best.Price) return 1;
        return 0;
    }
}
