// Adaptive bitrate selection in C#:
// the player picks a quality for each video segment from the measured network speed and the amount of video buffered.
using System;
using System.Globalization;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        // The speed the network really delivers for each segment (Mbps). The player cannot see these ahead of time.
        double[] network = { 8.0, 8.0, 6.0, 3.0, 1.2, 0.8, 2.0, 4.0, 7.0, 9.0 };

        double buffer = Player.SegmentSeconds; // the first segment is already buffered when playback starts
        double estimate = 8.0; // measured speed of the previous segment
        double stalledSeconds = 0;

        for (int i = 0; i < network.Length; i++)
        {
            double speed = network[i];
            var rendition = Player.ChooseQuality(estimate, buffer);
            double downloadSeconds = rendition.Mbps * Player.SegmentSeconds / speed;
            // While downloading, playback uses up the buffer. If it runs out first, the video freezes.
            if (downloadSeconds > buffer) stalledSeconds += downloadSeconds - buffer;
            buffer = Math.Max(0, buffer - downloadSeconds) + Player.SegmentSeconds;
            estimate = speed; // the next choice uses what this download measured
            Console.WriteLine($"segment {(i + 1).ToString().PadLeft(2)}  network {F(speed)} Mbps  -> {rendition.Name.PadRight(5)}  download {F(downloadSeconds)} s  buffer {F(buffer)} s");
        }

        Console.WriteLine($"stalled for {F(stalledSeconds)} s in total");
    }

    static string F(double value) => value.ToString("0.0", CultureInfo.InvariantCulture);
}

public record Rendition(string Name, double Mbps);

public static class Player
{
    public const double SegmentSeconds = 4;
    private const double Safety = 0.8; // only use 80% of the measured speed, to leave room for variation
    private const double LowBuffer = 4; // below this many seconds of buffered video, take the safest quality

    public static readonly Rendition[] Ladder =
    {
        new("240p", 0.4),
        new("480p", 1.0),
        new("720p", 2.5),
        new("1080p", 5.0),
    };

    // Choose the best quality that fits the estimated speed. With little buffered video, take no risks.
    public static Rendition ChooseQuality(double estimatedMbps, double bufferSeconds)
    {
        if (bufferSeconds < LowBuffer) return Ladder[0];
        var best = Ladder[0];
        foreach (var rendition in Ladder)
        {
            if (rendition.Mbps <= estimatedMbps * Safety) best = rendition;
        }
        return best;
    }
}
