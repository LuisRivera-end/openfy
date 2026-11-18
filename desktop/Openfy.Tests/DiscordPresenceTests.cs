using System.Collections.Concurrent;
using System.Text.Json;
using Openfy.Core;
using Xunit;

namespace Openfy.Tests;

public class DiscordPresenceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 18, 0, 0, TimeSpan.Zero);
    private static PlaybackPresenceSnapshot Song(long generation = 1, long sequence = 1, PlaybackPresenceState state = PlaybackPresenceState.Playing,
        double position = 30, double duration = 180, DateTimeOffset? at = null, string title = "Canción")
        => new(generation, sequence, "youtube:" + generation, state, title, "Artista", "Álbum", "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", position, duration, at ?? Now);
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DiscordPresenceTests.Now;
        public override DateTimeOffset GetUtcNow() => Now;
        public void Advance(int milliseconds = 250) => Now += TimeSpan.FromMilliseconds(milliseconds);
    }
    private sealed class Transport(bool connected = true) : IDiscordPresenceTransport
    {
        public DiscordPresenceStatus Status { get; set; } = connected ? DiscordPresenceStatus.Connected : DiscordPresenceStatus.Waiting;
        public event Action<DiscordTransportError>? Error;
        public readonly ConcurrentQueue<DiscordActivity?> Calls = new();
        public readonly List<DiscordActivity?> Visible = [];
        public DiscordActivity? Cached;
        public Action? OnPump;
        public bool Disposed;
        public void Start() { }
        public void Pump() { var action = OnPump; OnPump = null; action?.Invoke(); }
        public void SetActivity(DiscordActivity? activity) { Cached = activity; Calls.Enqueue(activity); if (Status == DiscordPresenceStatus.Connected) Visible.Add(activity); }
        public void RejectImage() { Status = DiscordPresenceStatus.Error; Error?.Invoke(new(4000, true)); }
        public void Dispose() => Disposed = true;
    }

    [Theory]
    [InlineData("{}", true)]
    [InlineData("{\"effects\":false}", true)]
    [InlineData("{\"discordPresenceEnabled\":false}", false)]
    [InlineData("{\"discordPresenceEnabled\":true}", true)]
    public void OldSettingsDefaultOnAndExplicitChoiceSurvivesRoundTrip(string json, bool expected)
    {
        var settings = JsonSerializer.Deserialize<DesktopSettings>(json, Contracts.Json)!;
        Assert.Equal(expected, settings.DiscordPresenceEnabled);
        Assert.Equal(expected, JsonSerializer.Deserialize<DesktopSettings>(JsonSerializer.Serialize(settings, Contracts.Json), Contracts.Json)!.DiscordPresenceEnabled);
    }

    [Fact]
    public void AudiblePositionDeterminesUtcTimestampsAndPausedSeekHasNoTimer()
    {
        var playing = DiscordPresencePolicy.Activity(Song(), Now)!;
        Assert.Equal(Now.AddSeconds(-30), playing.Start); Assert.Equal(Now.AddSeconds(150), playing.End);
        var sought = DiscordPresencePolicy.Activity(Song(sequence: 2, position: 100, at: Now.AddSeconds(10)), Now.AddSeconds(10))!;
        Assert.Equal(Now.AddSeconds(-90), sought.Start); Assert.Equal(Now.AddSeconds(90), sought.End);
        var paused = DiscordPresencePolicy.Activity(Song(state: PlaybackPresenceState.Paused, position: 100), Now)!;
        Assert.Equal("Canción", paused.Details); Assert.StartsWith("En pausa · Artista", paused.State); Assert.Null(paused.Start); Assert.Null(paused.End);
    }

    [Theory]
    [InlineData(0)] [InlineData(-1)] [InlineData(double.NaN)] [InlineData(double.PositiveInfinity)]
    public void UnknownDurationDoesNotCreateInvalidTimestamps(double duration)
    {
        var activity = DiscordPresencePolicy.Activity(Song(duration: duration), Now)!;
        Assert.Null(activity.Start); Assert.Null(activity.End);
    }

    [Theory]
    [InlineData(PlaybackPresenceState.Idle)] [InlineData(PlaybackPresenceState.Loading)]
    [InlineData(PlaybackPresenceState.Ended)] [InlineData(PlaybackPresenceState.Failed)]
    public void TerminalStatesNeverMasqueradeAsPausedMusic(PlaybackPresenceState state)
        => Assert.Null(DiscordPresencePolicy.Activity(Song(state: state), Now));

    [Fact]
    public void BufferingChangesToLoadingAfterTwoSecondsAndRecoveryRebasesTime()
    {
        var clock = new Clock(); var transport = new Transport(); using var session = new DiscordPresenceSession(() => transport, clock);
        session.Update(true, Song()); session.Tick();
        clock.Advance(1000); var waiting = Song(sequence: 2, state: PlaybackPresenceState.Buffering, position: 31, at: clock.Now);
        session.Update(true, waiting); session.Tick();
        clock.Advance(1999); session.Tick(); Assert.NotNull(transport.Cached!.Start); Assert.DoesNotContain("Cargando", transport.Cached.State);
        clock.Advance(1); session.Tick(); Assert.StartsWith("Cargando…", transport.Cached!.State); Assert.Null(transport.Cached.Start);
        clock.Advance(4000); session.Update(true, Song(sequence: 3, position: 31, at: clock.Now)); clock.Advance(); session.Tick();
        Assert.Equal(clock.Now.AddMilliseconds(-250).AddSeconds(-31), transport.Cached!.Start); Assert.DoesNotContain("Cargando", transport.Cached.State);
    }

    [Fact]
    public void DownloadedCatalogEntryUsesOriginalPublicMetadataRatherThanLocalCover()
    {
        var song = new YouTubeSong("abcdefghijk", "Tema", ["Artista"], null, "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", 180);
        var entry = new PlaybackEntry("youtube", Song: song);
        var stored = new StoredYouTubeAudio(new("audio", "audio/mp4", 12, "hash", "original"), 180, "C:\\Music\\private.png", [], 1);
        var saved = new SavedYouTubeSong(song, false, 1, stored);
        Assert.Equal(song.Artwork, DiscordPresencePolicy.PublicArtwork(entry, saved.Song));
        Assert.Equal(song.Artwork, DiscordPresencePolicy.PublicArtwork(entry with { Song = song with { Artwork = null } }, saved.Song));
        Assert.Null(DiscordPresencePolicy.PublicArtwork(new PlaybackEntry("local", "track"), saved.Song));
    }

    [Theory]
    [InlineData("C:\\Music\\cover.png")] [InlineData("file:///C:/cover.png")] [InlineData("http://example.com/cover.png")]
    [InlineData("https://localhost/cover.png")] [InlineData("https://192.168.1.8/cover.png")] [InlineData("https://[::1]/cover.png")]
    [InlineData("https://music.lan/cover.png")] [InlineData("https://example.com/cover?token=private")]
    [InlineData("https://user:password@example.com/cover.png")]
    public void PrivateAndSignedArtworkFallsBackToRegisteredLogo(string url)
    {
        Assert.Null(DiscordPresencePolicy.PublicArtwork(url));
        Assert.Equal(DiscordPresencePolicy.LogoAsset, DiscordPresencePolicy.Activity(Song() with { ArtworkUrl = url }, Now)!.LargeImage);
    }

    [Fact]
    public void LongUnicodeMetadataKeepsWholeGraphemesAndTheAdapterLimits()
    {
        string title = new('a', 126); title += "👩🏽‍🎤" + new string('b', 20);
        var activity = DiscordPresencePolicy.Activity(Song() with { Title = title, Artist = new string('x', 160), Album = new string('y', 160) }, Now)!;
        Assert.Equal(new string('a', 126) + "…", activity.Details); Assert.InRange(activity.State.Length, 1, 128); Assert.InRange(activity.LargeText.Length, 1, 128);
        Assert.DoesNotContain('\n', DiscordPresencePolicy.Text("Artista\n Álbum"));
        Assert.Null(DiscordPresencePolicy.PublicArtwork("https://example.com/" + new string('x', 260)));
    }

    [Fact]
    public void RapidChangesPublishOnlyLatestAfterDebounceAndOldEventsAreDiscarded()
    {
        var clock = new Clock(); var transport = new Transport(); using var session = new DiscordPresenceSession(() => transport, clock);
        session.Update(true, Song()); session.Tick(); int before = transport.Calls.Count;
        session.Update(true, Song(generation: 2, title: "Intermedia")); clock.Advance(100); session.Tick();
        session.Update(true, Song(generation: 3, title: "Actual")); clock.Advance(249); session.Tick(); Assert.Equal(before, transport.Calls.Count);
        clock.Advance(1); session.Tick(); Assert.Equal("Actual", transport.Cached!.Details);
        session.Update(true, Song(generation: 2, sequence: 999, title: "Vieja")); clock.Advance(1000); session.Tick(); Assert.Equal("Actual", transport.Cached.Details);
        int sent = transport.Calls.Count; clock.Advance(5000); session.Tick(); Assert.Equal(sent, transport.Calls.Count);
    }

    [Fact]
    public void SameSongRepeatAndBackwardSeekRespectSequenceAndRecomputeProgress()
    {
        var clock = new Clock(); var transport = new Transport(); using var session = new DiscordPresenceSession(() => transport, clock);
        session.Update(true, Song(sequence: 5, position: 100)); session.Tick();
        session.Update(true, Song(sequence: 6, position: 5)); clock.Advance(); session.Tick(); Assert.Equal(Now.AddSeconds(-5), transport.Cached!.Start);
        session.Update(true, Song(sequence: 4, position: 90)); clock.Advance(); session.Tick(); Assert.Equal(Now.AddSeconds(-5), transport.Cached.Start);
        session.Update(true, Song(generation: 2, position: 0, at: clock.Now)); clock.Advance(); session.Tick(); Assert.Equal(clock.Now.AddMilliseconds(-250), transport.Cached.Start);
    }

    [Fact]
    public void ReconnectCannotReplayAnOldSongOrAPausedProgressBar()
    {
        var clock = new Clock(); var transport = new Transport(); using var session = new DiscordPresenceSession(() => transport, clock);
        session.Update(true, Song(title: "Anterior")); session.Tick(); transport.Visible.Clear();
        transport.Status = DiscordPresenceStatus.Waiting;
        session.Update(true, Song(generation: 2, state: PlaybackPresenceState.Paused, title: "Actual"));
        transport.OnPump = () => { transport.Status = DiscordPresenceStatus.Connected; transport.Visible.Add(transport.Cached); };
        session.Tick();
        Assert.All(transport.Visible, value => { Assert.Equal("Actual", value!.Details); Assert.Null(value.Start); });
        Assert.Equal(DiscordPresenceStatus.Connected, session.Status);
    }

    [Fact]
    public void DisableCancelsPendingPublicationAndReenableUsesCurrentState()
    {
        var clock = new Clock(); var first = new Transport(); var second = new Transport(); int created = 0;
        using var session = new DiscordPresenceSession(() => ++created == 1 ? first : second, clock);
        session.Update(true, Song()); session.Tick(); session.Update(true, Song(generation: 2, title: "Pendiente"));
        session.Update(false, Song(generation: 2, title: "Pendiente")); session.Tick(); clock.Advance(1000); session.Tick();
        Assert.True(first.Disposed); Assert.Null(first.Cached); Assert.DoesNotContain(first.Calls, value => value?.Details == "Pendiente");
        Assert.Equal(DiscordPresenceStatus.Disabled, session.Status);
        session.Update(true, Song(generation: 2, title: "Pendiente")); session.Tick(); Assert.Equal("Pendiente", second.Cached!.Details);
    }

    [Fact]
    public void RejectedExternalImageRetriesWithLogoAndDisposalClearsActivity()
    {
        var clock = new Clock(); var transport = new Transport(); var session = new DiscordPresenceSession(() => transport, clock);
        session.Update(true, Song()); session.Tick(); transport.OnPump = transport.RejectImage; session.Tick();
        Assert.Equal(DiscordPresencePolicy.LogoAsset, transport.Cached!.LargeImage);
        session.Dispose(); Assert.Null(transport.Cached); Assert.True(transport.Disposed);
    }

    [Fact]
    public void RpcFailureIsContainedAndConnectionAttemptsAreBackedOff()
    {
        var clock = new Clock(); int attempts = 0;
        using var session = new DiscordPresenceSession(() => { attempts++; throw new IOException("unavailable"); }, clock);
        session.Update(true, Song()); session.Tick(); Assert.Equal(DiscordPresenceStatus.Error, session.Status);
        clock.Advance(14999); session.Tick(); Assert.Equal(1, attempts);
        clock.Advance(1); session.Tick(); Assert.Equal(2, attempts);
    }

    [Fact]
    public async Task BackgroundServiceKeepsNoPresenceAfterShutdown()
    {
        var transport = new Transport(); var service = new DiscordPresenceService(() => transport);
        service.Submit(Song()); service.SetEnabled(true);
        for (int i = 0; i < 100 && transport.Calls.IsEmpty; i++) await Task.Delay(10);
        Assert.False(transport.Calls.IsEmpty);
        await service.DisposeAsync();
        Assert.True(transport.Disposed); Assert.Null(transport.Cached);
        int count = transport.Calls.Count; service.Submit(Song(generation: 100)); service.SetEnabled(true);
        Assert.Equal(count, transport.Calls.Count);
    }
}
