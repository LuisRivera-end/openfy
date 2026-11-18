using System.Diagnostics;
using System.Text.Json.Serialization;

namespace Openfy.Core;

public record ListeningContext(string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Id = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Title = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Subtitle = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Artwork = null);
public record ListeningSession(string Id, string DeviceId, long Sequence, PlaybackEntry Entry, long StartedAt, long UpdatedAt,
    long? DurationMs, long ListenedMs, Dictionary<string, long> Days, long? QualifiedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ListeningContext? Context = null);
public record TrackStatistics(long ListenedMs, int Plays, long LastPlayedAt);
public record ListeningStats(string Period, Dictionary<string, TrackStatistics> ByTrack, long ListenedMs, int Plays, long LastPlayedAt)
{
    public static ListeningStats Empty(string period = "all") => new(period, [], 0, 0, 0);
}
public record LibraryItem(string Id, string Source, string Title, string Artist, string Album, string? Artwork, string[] Palette,
    double Duration, bool Favorite, string Format, PlaybackEntry Entry, string[]? Genres = null, long? AddedAt = null, string? AlbumId = null);
public record RankedTrack(LibraryItem Item, long ListenedMs, int Plays, long LastPlayedAt);
public record RecentCard(string Kind, string Key, string? Id, string Title, string Subtitle, string? Artwork, long LastPlayedAt, LibraryItem? Item);
public record RecentListening(RecentCard[] Items);
public record MostPlayedPage(RankedTrack[] Items, int Total, int Offset, int Limit);
public record Recommendations(YouTubeSong[] Songs, long GeneratedAt, bool Stale, string? Error, YouTubeAlbum[]? Releases = null, int AlgorithmVersion = 0)
{
    public const int CurrentAlgorithm = 2;
}
public record ListeningAcknowledged(string Id, long Sequence);
public record ListeningAcknowledgement(ListeningAcknowledged[] Accepted);
public sealed record LibraryFilters
{
    public string Query { get; set; } = "";
    public string Artist { get; set; } = "";
    public string Album { get; set; } = "";
    public string Genre { get; set; } = "";
    public bool Favorite { get; set; }
    public string Source { get; set; } = "all";
    public bool Downloaded { get; set; }
    public string Sort { get; set; } = "default";
    public string Direction { get; set; } = "asc";
    public LibraryFilters ForCollection() => this with { Artist = "", Album = "", Genre = "", Source = "all", Favorite = false };
}

public sealed class ListeningAccumulator
{
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("America/Mexico_City");
    public static string Day(long at) => TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(at), Zone).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
    public ListeningSession Session { get; private set; }
    private double position, clock;
    private long wall;
    private bool audible;
    public ListeningAccumulator(PlaybackEntry entry, string deviceId, string id, long at, ListeningSession? restored = null)
        => Session = restored is null ? new(id, deviceId, 0, entry, at, at, null, 0, [], null, entry.Context) : restored with { Days = new(restored.Days) };
    public void Reset(double current, double monotonic, long at, bool playing = false) { position = current; clock = monotonic; wall = at; audible = playing; }
    public void Sample(double current, double duration, double monotonic, long at, bool playing)
    {
        double advance = (current - position) * 1000, elapsed = Math.Max(0, monotonic - clock);
        long amount = audible && advance >= 0 && advance <= elapsed + 250 ? (long)Math.Floor(Math.Min(advance, elapsed)) : 0;
        long? durationMs = double.IsFinite(duration) && duration > 0 ? (long)Math.Round(duration * 1000) : Session.DurationMs;
        if (amount > 0)
        {
            long start = Math.Max(wall, at - amount);
            while (start < at)
            {
                string day = Day(start); long end = at;
                if (Day(at - 1) != day)
                {
                    long low = start, high = at;
                    while (high - low > 1) { long mid = (low + high) / 2; if (Day(mid) == day) low = mid; else high = mid; }
                    end = high;
                }
                Session.Days[day] = Session.Days.GetValueOrDefault(day) + end - start;
                start = end;
            }
        }
        long listened = Session.Days.Values.Sum();
        long? qualified = durationMs is > 0 && listened >= durationMs.Value * .9
            ? Session.QualifiedAt ?? at - (long)Math.Max(0, listened - durationMs.Value * .9) : null;
        Session = Session with { DurationMs = durationMs, ListenedMs = listened, UpdatedAt = at, QualifiedAt = qualified };
        Reset(current, monotonic, at, playing);
    }
    public ListeningSession Checkpoint() { Session = Session with { Sequence = Session.Sequence + 1 }; return Session with { Days = new(Session.Days) }; }
}

public sealed class ListeningClient(BackendClient api, AtomicStore store)
{
    public sealed record State(string DeviceId, ListeningSession? Active, Dictionary<string, ListeningSession> Pending);
    private State state = new(Guid.NewGuid().ToString(), null, []);
    private ListeningAccumulator? accumulator;
    private Task writes = Task.CompletedTask;
    private readonly SemaphoreSlim sync = new(1, 1);
    public int PendingCount => state.Pending.Count;
    public string? StorageError { get; private set; }
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static double Clock => Stopwatch.GetTimestamp() * 1000d / Stopwatch.Frequency;
    public async Task InitializeAsync() { state = await store.ReadAsync<State>("listening") ?? state; await SaveAsync(); }
    public void Select(PlaybackEntry entry, bool restore = false)
    {
        _ = CheckpointAsync();
        var previous = restore && state.Active?.Entry.Key == entry.Key ? state.Active : null;
        accumulator = new(entry, state.DeviceId, Guid.NewGuid().ToString(), Now, previous);
        accumulator.Reset(0, Clock, Now);
    }
    public void Sample(double position, double duration, bool audible) => accumulator?.Sample(position, duration, Clock, Now, audible);
    public void Reset(double position, bool audible = false) => accumulator?.Reset(position, Clock, Now, audible);
    public Task CheckpointAsync()
    {
        if (accumulator is null) return writes;
        var snapshot = accumulator.Checkpoint();
        state = state with { Active = snapshot };
        if (snapshot.ListenedMs > 0) state.Pending[snapshot.Id] = snapshot;
        return SaveAsync();
    }
    private Task SaveAsync()
    {
        var snapshot = new State(state.DeviceId, state.Active, new(state.Pending));
        return writes = WriteAfterAsync(writes, snapshot);
    }
    private async Task WriteAfterAsync(Task previous, State snapshot)
    {
        try { await previous; await store.WriteAsync("listening", snapshot); StorageError = null; }
        catch { StorageError = "No se pudo guardar la escucha en este PC."; }
    }
    public async Task FlushAsync(CancellationToken cancellation = default)
    {
        if (!await sync.WaitAsync(0)) return;
        try
        {
            await writes;
            while (state.Pending.Count > 0)
            {
                var batch = state.Pending.Values.OrderBy(item => item.UpdatedAt).Take(100).ToArray();
                var reply = await api.SendAsync<ListeningAcknowledgement>("api/telemetry/listening", HttpMethod.Post, new { sessions = batch }, cancellation);
                foreach (var accepted in reply.Accepted) if (state.Pending.TryGetValue(accepted.Id, out var pending) && pending.Sequence <= accepted.Sequence) state.Pending.Remove(accepted.Id);
                await SaveAsync();
            }
        }
        catch (HttpRequestException) { /* Persistent outbox retries after reconnect. */ }
        catch (TaskCanceledException) { }
        finally { sync.Release(); }
    }
}
