using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using Openfy.Core;
using Xunit;

namespace Openfy.Tests;

public class CoreTests
{
    [Theory]
    [InlineData(null)] [InlineData(false)] [InlineData(true)]
    public void RetiredDesignPreferenceDoesNotChangeOtherDesktopSettings(bool? previous)
    {
        var expected = new DesktopSettings { Effects = false, Force24 = true, WidgetLocked = true, MiniVisible = true, WidgetVisible = true, Windows = new() { ["widget"] = new(10, 20, 360, 520, "test", 144) } };
        var json = JsonSerializer.SerializeToNode(expected, Contracts.Json)!.AsObject();
        if (previous.HasValue) json["newDesign"] = previous.Value;
        var restored = json.Deserialize<DesktopSettings>(Contracts.Json)!;
        Assert.True(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(expected, Contracts.Json), JsonSerializer.SerializeToNode(restored, Contracts.Json)));
        Assert.DoesNotContain("newDesign", JsonSerializer.Serialize(restored, Contracts.Json));
    }

    [Fact]
    public void MotionArtIsOnForOlderSettingsAndKeepsAnExplicitChoice()
    {
        Assert.True(JsonSerializer.Deserialize<DesktopSettings>("{\"effects\":false}", Contracts.Json)!.MotionArt);
        var off = JsonSerializer.Deserialize<DesktopSettings>(JsonSerializer.Serialize(new DesktopSettings { MotionArt = false }, Contracts.Json), Contracts.Json)!;
        Assert.False(off.MotionArt);
        var ready = JsonSerializer.Deserialize<MotionArtResult>("{\"status\":\"ready\",\"url\":\"/api/motion/a.mp4\",\"width\":1080,\"height\":1080}", Contracts.Json)!;
        Assert.Equal(("ready", "/api/motion/a.mp4", 1080), (ready.Status, ready.Url, ready.Width));
        Assert.Null(JsonSerializer.Deserialize<MotionArtResult>("{\"status\":\"none\"}", Contracts.Json)!.Url);
        var unresolved = JsonSerializer.Deserialize<MotionArtResult>("{\"status\":\"unmatched\",\"retryAfterMs\":86400000}", Contracts.Json)!;
        Assert.Equal(("unmatched", 86400000L, null), (unresolved.Status, unresolved.RetryAfterMs, unresolved.Url));
    }

    [Theory]
    [InlineData(null, "default")]
    [InlineData("null", "default")]
    [InlineData("42", "default")]
    [InlineData("""{"mode":"on"}""", "default")]
    [InlineData("\"unknown\"", "default")]
    [InlineData("\"default\"", "default")]
    [InlineData("\"on\"", "on")]
    [InlineData("\"off\"", "off")]
    public void TransparencyNormalizesAndRoundTrips(string? transparencyJson, string expected)
    {
        var json = transparencyJson == null ? """{"effects":false}"""
            : $$"""{"transparency":{{transparencyJson}},"effects":false}""";
        var settings = JsonSerializer.Deserialize<DesktopSettings>(json, Contracts.Json)!;
        Assert.False(settings.Effects);
        Assert.Equal(expected, settings.Transparency);
        var saved = JsonSerializer.SerializeToNode(settings, Contracts.Json)!;
        Assert.Equal(expected, saved["transparency"]!.GetValue<string>());
    }

    [Fact]
    public async Task MotionProviderRetryHeaderSurvivesTheHttpClientError()
    {
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var api = new BackendClient();
        api.SetPort(((IPEndPoint)listener.LocalEndpoint).Port);
        try {
            var response = api.SendAsync<MotionArtResult>("api/motion/resolve", HttpMethod.Post, new { test = true }, timeout.Token);
            using var connection = await listener.AcceptTcpClientAsync(timeout.Token);
            using var stream = connection.GetStream();
            using var reader = new StreamReader(stream, leaveOpen: true);
            int bytes = 0;
            while (await reader.ReadLineAsync(timeout.Token) is { Length: > 0 } line)
                if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) bytes = int.Parse(line.Split(':')[1].Trim());
            if (bytes > 0) await reader.ReadBlockAsync(new char[bytes], timeout.Token);
            byte[] body = System.Text.Encoding.UTF8.GetBytes("{\"message\":\"Motion unavailable\"}");
            byte[] headers = System.Text.Encoding.ASCII.GetBytes($"HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: {body.Length}\r\nRetry-After: 3600\r\nConnection: close\r\n\r\n");
            await stream.WriteAsync(headers, timeout.Token); await stream.WriteAsync(body, timeout.Token);
            var error = await Assert.ThrowsAsync<HttpRequestException>(async () => { await response; });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, error.StatusCode);
            Assert.Equal(3_600_000L, error.Data["RetryAfterMs"]);
        } finally { listener.Stop(); }
    }

    [Fact]
    public void SessionDiagnosticsResetBothFilesAndRemoveUrlSecrets()
    {
        string directory = Path.Combine(Path.GetTempPath(), "openfy-session-test-" + Guid.NewGuid().ToString("N"));
        try {
            SessionLog.Begin(directory);
            string first = SessionLog.SessionId;
            SessionLog.Write("request", "failed", "https://user:password@example.com/cover?token=secret", 12, error: new HttpRequestException("Failed https://example.com/cover?token=secret", null, HttpStatusCode.BadGateway));
            string log = File.ReadAllText(Path.Combine(directory, "native.jsonl"));
            Assert.DoesNotContain("secret", log); Assert.DoesNotContain("password", log); Assert.Contains("502", log);
            File.WriteAllText(Path.Combine(directory, "backend.jsonl"), "previous-session");
            SessionLog.Begin(directory);
            Assert.NotEqual(first, SessionLog.SessionId);
            Assert.DoesNotContain("request", File.ReadAllText(Path.Combine(directory, "native.jsonl")));
            Assert.Equal("", File.ReadAllText(Path.Combine(directory, "backend.jsonl")));
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
    [Fact]
    public void SavedCatalogReferencesSurviveLibraryRoundTripAndResolveInPlaylistOrder()
    {
        var song = new YouTubeSong("abcdefghijk", "Remota", ["Openfy"], null, null, 123);
        var library = new Library([], [new("list", "GYM", ["youtube:abcdefghijk"], 2, 1)], [new(song, true, 1)]);
        var restored = JsonSerializer.Deserialize<Library>(JsonSerializer.Serialize(library, Contracts.Json), Contracts.Json)!;
        var entry = restored.EntryForId(restored.Playlists[0].TrackIds[0])!;
        Assert.Equal("youtube:abcdefghijk", entry.Key);
        Assert.Equal(song.Title, entry.Song!.Title);
        Assert.True(restored.IsFavorite(entry));
        Assert.Null(restored.EntryForId("youtube:12345678901"));
        var old = JsonSerializer.Deserialize<Library>("{\"tracks\":[],\"playlists\":[]}", Contracts.Json)!;
        Assert.Empty(old.SavedSongs);
    }
    [Theory]
    [InlineData(120, false, false, 120)] [InlineData(240, false, false, 240)]
    [InlineData(120, true, false, 24)] [InlineData(240, true, false, 24)]
    [InlineData(144, false, true, 24)] [InlineData(0, false, false, 60)]
    public void RenderingUsesEachDisplayAndTheGlobalGameLimit(double hz, bool other, bool forced, double expected)
        => Assert.Equal(expected, RenderPolicy.Target(hz, true, true, true, false, other, forced));
    [Theory]
    [InlineData(false, true, true, false)] [InlineData(true, false, true, false)] [InlineData(true, true, false, false)] [InlineData(true, true, true, true)]
    public void InactiveAndReducedMotionViewsStopRendering(bool visible, bool playing, bool effects, bool reduced)
        => Assert.Equal(0, RenderPolicy.Target(240, visible, playing, effects, reduced, false, false));
    [Fact]
    public void CatalogAndLyricsPreserveTheCommonTypescriptFixture()
    {
        var json = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "desktop-catalog-contract.json")))!;
        var artist = json["artist"]!.Deserialize<ArtistProfile>(Contracts.Json)!;
        var album = json["album"]!.Deserialize<AlbumDetail>(Contracts.Json)!;
        var lyrics = json["lyrics"]!.Deserialize<LyricsResult>(Contracts.Json)!;
        Assert.Equal(2026, album.Year); Assert.True(artist.Expandable["songs"]);
        Assert.True(JsonNode.DeepEquals(json["artist"], JsonSerializer.SerializeToNode(artist, Contracts.Json)));
        Assert.True(JsonNode.DeepEquals(json["album"], JsonSerializer.SerializeToNode(album, Contracts.Json)));
        Assert.True(JsonNode.DeepEquals(json["lyrics"], JsonSerializer.SerializeToNode(lyrics, Contracts.Json)));
    }
    [Fact]
    public void SharedMixedQueueRoundTripsWithoutPrivateKeysOrLostMetadata()
    {
        string fixture = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "desktop-contract.json"));
        var snapshot = JsonSerializer.Deserialize<PlaybackSnapshot>(fixture, Contracts.Json)!;
        Assert.Equal("youtube:abcdefghijk", snapshot.Queue[1].Key);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(fixture), JsonNode.Parse(JsonSerializer.Serialize(snapshot, Contracts.Json))));
    }
    [Fact]
    public void LyricsCacheRejectsOtherRecordingsAndMeasuredDurationChanges()
    {
        var signature = new LyricsSignature("Horizonte", ["Openfy"], "Pruebas", 90);
        Assert.True(LyricsMatching.Same(signature, signature with { Title = " HORIZONTE! ", Duration = 91 }));
        Assert.False(LyricsMatching.Same(signature, signature with { Title = "Horizonte (Live)" }));
        Assert.False(LyricsMatching.Same(signature, signature with { Duration = 35 }));
        Assert.False(LyricsMatching.Same(signature, signature with { Artists = ["Otro"] }));
    }
    [Fact]
    public void LyricsFollowExactBoundariesAndBackwardSeeks()
    {
        var lines = new[] { new LyricsLine(1, "A"), new LyricsLine(3, "B"), new LyricsLine(3, "C"), new LyricsLine(5, "") };
        Assert.Null(RenderPolicy.ActiveLyricsTime(lines, 0)); Assert.Equal(3, RenderPolicy.ActiveLyricsTime(lines, 4)); Assert.Equal(1, RenderPolicy.ActiveLyricsTime(lines, 1));
    }
    [Fact]
    public async Task AtomicStateWritesRemainReadableUnderConcurrentSaves()
    {
        string root = Path.Combine(Path.GetTempPath(), "openfy-state-" + Guid.NewGuid());
        try { var store = new AtomicStore(root); await Task.WhenAll(Enumerable.Range(0, 20).Select(n => store.WriteAsync("state", new { version = n }))); Assert.NotNull(await store.ReadAsync<JsonObject>("state")); Assert.Empty(Directory.GetFiles(root, "*.tmp")); }
        finally { Assert.StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())) + Path.DirectorySeparatorChar, Path.GetFullPath(root)); if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
    [Fact]
    public void RemoteAudioSupportsSeekingAndEvictsOldBlocks()
    {
        var handler = new RangeHandler(); using var client = new HttpClient(handler); using var stream = new HttpRangeStream(client, "https://example.test/audio");
        var bytes = new byte[16];
        for (int i = 0; i < 10; i++) { stream.Position = i * 512L * 1024; Assert.Equal(16, stream.Read(bytes)); Assert.Equal((byte)i, bytes[0]); }
        int before = handler.Reads; stream.Position = 9 * 512L * 1024; stream.ReadExactly(bytes); Assert.Equal(before, handler.Reads);
        stream.Position = 0; stream.ReadExactly(bytes); Assert.Equal(before + 1, handler.Reads);
        stream.Position = 512 * 1024 - 4;
        Assert.Equal(16, stream.Read(bytes));
        Assert.Equal(new byte[] { 0, 0, 0, 0 }, bytes[..4]);
        Assert.All(bytes[4..], value => Assert.Equal(1, value));
    }
    private sealed class RangeHandler : HttpMessageHandler
    {
        public int Reads;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
        {
            const long length = 10 * 512 * 1024;
            if (request.Method == HttpMethod.Head) { var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([]) }; response.Content.Headers.ContentLength = length; return Task.FromResult(response); }
            Reads++;
            var range = request.Headers.Range!.Ranges.Single(); long start = range.From!.Value, end = range.To!.Value;
            var content = new ByteArrayContent(Enumerable.Repeat((byte)(start / (512 * 1024)), (int)(end - start + 1)).ToArray()); content.Headers.ContentRange = new ContentRangeHeaderValue(start, end, length);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = content });
        }
    }
}
