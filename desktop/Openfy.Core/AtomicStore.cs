using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Openfy.Core;

public sealed class AtomicStore(string root)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    public string Root { get; } = root;
    public async Task<T?> ReadAsync<T>(string name, CancellationToken cancellation = default)
    {
        try { return JsonSerializer.Deserialize<T>(await File.ReadAllTextAsync(Path.Combine(Root, name + ".json"), cancellation), Contracts.Json); }
        catch (Exception error) when (error is IOException or JsonException) { return default; }
    }
    public async Task WriteAsync<T>(string name, T value)
    {
        await gate.WaitAsync();
        string? temporary = null;
        try
        {
            Directory.CreateDirectory(Root);
            string path = Path.Combine(Root, name + ".json");
            temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            // Stream straight to disk: large snapshots would otherwise allocate a string on the large object heap per write.
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.Asynchronous))
                await JsonSerializer.SerializeAsync(stream, value, Contracts.Json);
            File.Move(temporary, path, true);
        }
        finally { if (temporary != null && File.Exists(temporary)) File.Delete(temporary); gate.Release(); }
    }
    public static string CacheKey(string key) => "lyrics-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
}

public static class RenderPolicy
{
    public static double Target(double refresh, bool visible, bool playing, bool effects, bool reducedMotion, bool fullscreenOther, bool force24)
        => !visible || !playing || !effects || reducedMotion ? 0 : fullscreenOther || force24 ? Math.Min(24, ValidRefresh(refresh)) : ValidRefresh(refresh);
    private static double ValidRefresh(double refresh) => double.IsFinite(refresh) && refresh >= 10 && refresh <= 1000 ? refresh : 60;
    public static double? ActiveLyricsTime(IReadOnlyList<LyricsLine> lines, double position)
    {
        int low = 0, high = lines.Count - 1, found = -1;
        while (low <= high) { int mid = (low + high) / 2; if (lines[mid].Time <= position) { found = mid; low = mid + 1; } else high = mid - 1; }
        return found < 0 ? null : lines[found].Time;
    }
    /// <summary>Twin of activeLyricsWord in shared/utils/lyrics.ts (tests/fixtures/lyrics-contract.json).</summary>
    public static (int Index, double Progress)? ActiveLyricsWord(LyricsLine? line, double? nextTime, double position)
    {
        var words = line?.Words;
        if (words is not { Length: > 0 }) return null;
        if (position < words[0].Time) return (-1, 0);
        int low = 0, high = words.Length - 1, found = 0;
        while (low <= high) { int mid = (low + high) / 2; if (words[mid].Time <= position) { found = mid; low = mid + 1; } else high = mid - 1; }
        double start = words[found].Time, end = found + 1 < words.Length ? words[found + 1].Time : line!.End ?? nextTime ?? start + 1;
        return (found, end <= start ? 1 : Math.Clamp((position - start) / (end - start), 0, 1));
    }
}
