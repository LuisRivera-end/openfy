using System.Globalization;
using System.Net;

namespace Openfy.Core;

public enum PlaybackPresenceState { Idle, Loading, Playing, Paused, Buffering, Ended, Failed }
public record AudioPlaybackSnapshot(long Generation, long Sequence, PlaybackPresenceState State, double Position, double Duration, DateTimeOffset CapturedAt, string? Error = null);
public record PlaybackPresenceSnapshot(long Generation, long Sequence, string? TrackKey, PlaybackPresenceState State,
    string Title, string Artist, string Album, string? ArtworkUrl, double Position, double Duration, DateTimeOffset CapturedAt);
public record DiscordActivity(string Details, string State, string LargeImage, string LargeText, DateTimeOffset? Start, DateTimeOffset? End);
public enum DiscordPresenceStatus { Disabled, Waiting, Connected, Error }
public record DiscordTransportError(int Code, bool ImageRejected = false);

/// <summary>All methods and callbacks run on the presence worker, never on the audio or UI thread.</summary>
public interface IDiscordPresenceTransport : IDisposable
{
    DiscordPresenceStatus Status { get; }
    event Action<DiscordTransportError>? Error;
    void Start();
    void Pump();
    void SetActivity(DiscordActivity? activity);
}

public static class DiscordPresencePolicy
{
    public const string ApplicationId = "1571729156608229426";
    public const string LogoAsset = "openfy";
    public static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(250);
    public static readonly TimeSpan BufferingGrace = TimeSpan.FromSeconds(2);

    // Discord's library counts UTF-16 characters. Preserve complete graphemes at the boundary.
    public static string Text(string? value, int maximum = 128)
    {
        string text = string.Join(" ", (value ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (text.Length <= maximum) return text;
        int length = 0;
        var elements = StringInfo.GetTextElementEnumerator(text);
        while (elements.MoveNext()) { int next = elements.ElementIndex + elements.GetTextElement().Length; if (next > maximum - 1) break; length = next; }
        return text[..length] + "…";
    }

    public static string? PublicArtwork(PlaybackEntry entry, YouTubeSong? saved = null)
        => entry.Source == "youtube" ? PublicArtwork(entry.Song?.Artwork) ?? PublicArtwork(saved?.Artwork) : null;

    public static string? PublicArtwork(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 256 || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(uri.UserInfo) || uri.IsLoopback
            || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) || uri.HostNameType != UriHostNameType.Dns
            || !uri.Host.Contains('.') || uri.Host.EndsWith(".local", StringComparison.OrdinalIgnoreCase)
            || uri.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith(".lan", StringComparison.OrdinalIgnoreCase)
            || IPAddress.TryParse(uri.Host, out _)) return null;
        // Use only URLs already supplied by catalog metadata. Never resolve, serve or upload local files.
        return uri.AbsoluteUri.Length <= 256 ? uri.AbsoluteUri : null;
    }

    public static DiscordActivity? Activity(PlaybackPresenceSnapshot? snapshot, DateTimeOffset now, bool logoOnly = false)
    {
        if (snapshot?.TrackKey == null || snapshot.State is PlaybackPresenceState.Idle or PlaybackPresenceState.Loading or PlaybackPresenceState.Ended or PlaybackPresenceState.Failed) return null;
        string description = string.Join(" · ", new[] { snapshot.Artist, snapshot.Album }.Where(value => !string.IsNullOrWhiteSpace(value)));
        bool waiting = snapshot.State == PlaybackPresenceState.Buffering && now - snapshot.CapturedAt >= BufferingGrace;
        if (snapshot.State == PlaybackPresenceState.Paused) description = "En pausa" + (description.Length > 0 ? " · " + description : "");
        else if (waiting) description = "Cargando…" + (description.Length > 0 ? " · " + description : "");
        DateTimeOffset? start = null, end = null;
        if (snapshot.State != PlaybackPresenceState.Paused && !waiting && double.IsFinite(snapshot.Duration) && snapshot.Duration > 0 && snapshot.Duration < 31536000
            && double.IsFinite(snapshot.Position)) {
            start = snapshot.CapturedAt - TimeSpan.FromSeconds(Math.Clamp(snapshot.Position, 0, snapshot.Duration));
            end = start + TimeSpan.FromSeconds(snapshot.Duration);
        }
        return new(Text(string.IsNullOrWhiteSpace(snapshot.Title) ? "Canción sin título" : snapshot.Title), Text(description),
            logoOnly ? LogoAsset : PublicArtwork(snapshot.ArtworkUrl) ?? LogoAsset, Text(string.IsNullOrWhiteSpace(snapshot.Album) ? "Openfy" : snapshot.Album), start, end);
    }
}

/// <summary>Deterministic connection/publication state machine; driven only by the worker or a test clock.</summary>
public sealed class DiscordPresenceSession(Func<IDiscordPresenceTransport> createTransport, TimeProvider? clock = null) : IDisposable
{
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    private IDiscordPresenceTransport? transport;
    private PlaybackPresenceSnapshot? snapshot;
    private DiscordActivity? published;
    private DateTimeOffset due, retryAt;
    private bool enabled, sent, force, logoOnly, disposed;
    public DiscordPresenceStatus Status { get; private set; } = DiscordPresenceStatus.Disabled;
    public event Action<DiscordPresenceStatus>? StatusChanged;

    public void Update(bool active, PlaybackPresenceSnapshot? value)
    {
        if (disposed) return;
        if (value != null && snapshot != null && (value.Generation < snapshot.Generation || value.Generation == snapshot.Generation && value.Sequence < snapshot.Sequence)) value = snapshot;
        bool changed = value != snapshot;
        if (changed) {
            if (value?.ArtworkUrl != snapshot?.ArtworkUrl || value?.TrackKey != snapshot?.TrackKey) logoOnly = false;
            snapshot = value;
            due = time.GetUtcNow() + DiscordPresencePolicy.Debounce;
            if (DiscordPresencePolicy.Activity(snapshot, time.GetUtcNow()) == null) due = time.GetUtcNow();
        }
        if (enabled != active) { enabled = active; due = time.GetUtcNow(); retryAt = default; force = true; }
    }

    public void Tick()
    {
        if (disposed) return;
        if (!enabled) { Stop(); SetStatus(DiscordPresenceStatus.Disabled); return; }
        var now = time.GetUtcNow();
        if (now < retryAt) return;
        try {
            if (transport == null) { transport = createTransport(); transport.Error += OnError; transport.Start(); sent = false; SetStatus(DiscordPresenceStatus.Waiting); }
            var activity = DiscordPresencePolicy.Activity(snapshot, now, logoOnly);
            // Keep the library's offline cache current BEFORE pumping READY: it replays that cache automatically.
            if (transport.Status != DiscordPresenceStatus.Connected || force || now >= due) Publish(activity);
            var before = transport.Status;
            transport.Pump();
            if (before != DiscordPresenceStatus.Connected && transport.Status == DiscordPresenceStatus.Connected) { force = true; Publish(activity); }
            if (force && time.GetUtcNow() >= retryAt) Publish(DiscordPresencePolicy.Activity(snapshot, now, logoOnly));
            SetStatus(transport.Status);
        } catch (Exception failure) {
            var frames = new System.Diagnostics.StackTrace(failure, false).GetFrames().Take(8)
                .Select(frame => frame.GetMethod()).Where(method => method != null).Select(method => method!.DeclaringType?.FullName + "." + method.Name);
            SessionLog.Write("discord.connection", "failed", error: new InvalidOperationException(failure.GetType().Name + ": " + string.Join(" > ", frames)));
            Stop(); retryAt = now + TimeSpan.FromSeconds(15); SetStatus(DiscordPresenceStatus.Error);
        }
    }
    private void Publish(DiscordActivity? activity)
    {
        if (!force && sent && activity == published) return;
        transport!.SetActivity(activity); published = activity; sent = true; force = false;
        SessionLog.Write("discord.presence", activity == null ? "cleared" : "updated");
    }
    private void OnError(DiscordTransportError error)
    {
        SessionLog.Write("discord.rpc", "failed", status: error.Code);
        if (error.ImageRejected && !logoOnly && published?.LargeImage != DiscordPresencePolicy.LogoAsset) { logoOnly = true; force = true; }
        else { retryAt = time.GetUtcNow() + TimeSpan.FromSeconds(15); force = true; }
    }
    private void SetStatus(DiscordPresenceStatus value)
    {
        if (Status == value) return;
        Status = value; SessionLog.Write("discord.connection", value.ToString().ToLowerInvariant()); StatusChanged?.Invoke(value);
    }
    private void Stop()
    {
        if (transport == null) return;
        var old = transport; transport = null;
        old.Error -= OnError;
        try { old.SetActivity(null); } catch { }
        try { old.Dispose(); } catch { }
        sent = false; published = null;
    }
    public void Dispose() { if (disposed) return; Stop(); disposed = true; SetStatus(DiscordPresenceStatus.Disabled); }
}

/// <summary>A single latest-value mailbox. No model access, blocking I/O, or RPC work occurs in Submit.</summary>
public sealed class DiscordPresenceService : IAsyncDisposable
{
    private readonly object gate = new();
    private readonly CancellationTokenSource lifetime = new();
    private readonly DiscordPresenceSession session;
    private readonly Task worker;
    private PlaybackPresenceSnapshot? latest;
    private bool enabled, disposed;
    public event Action<DiscordPresenceStatus>? StatusChanged;
    public DiscordPresenceService(Func<IDiscordPresenceTransport> factory)
    {
        session = new(factory); session.StatusChanged += status => StatusChanged?.Invoke(status);
        worker = Task.Run(async () => {
            try {
                while (!lifetime.IsCancellationRequested) {
                    bool active; PlaybackPresenceSnapshot? current;
                    lock (gate) { active = enabled; current = latest; }
                    session.Update(active, current);
                    session.Tick();
                    // Disabled: sleep until enabled or a new snapshot arrives instead of waking 20 times a second.
                    if (active) await Task.Delay(50, lifetime.Token).ConfigureAwait(false);
                    else await signal.WaitAsync(lifetime.Token).ConfigureAwait(false);
                }
            } catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
            catch (Exception failure) { SessionLog.Write("discord.worker", "failed", error: new InvalidOperationException(failure.GetType().Name)); }
            finally { session.Dispose(); }
        });
    }
    private readonly SemaphoreSlim signal = new(0, 1);
    private void Wake() { try { if (signal.CurrentCount == 0) signal.Release(); } catch (SemaphoreFullException) { } catch (ObjectDisposedException) { } }
    public void SetEnabled(bool value) { lock (gate) { if (!disposed) enabled = value; } Wake(); }
    public void Submit(PlaybackPresenceSnapshot value)
    {
        lock (gate) {
            if (disposed || latest != null && (value.Generation < latest.Generation || value.Generation == latest.Generation && value.Sequence < latest.Sequence)) return;
            latest = value;
        }
        Wake();
    }
    public async ValueTask DisposeAsync()
    {
        lock (gate) { if (disposed) return; disposed = true; enabled = false; }
        lifetime.Cancel(); await worker.ConfigureAwait(false); lifetime.Dispose();
    }
}
