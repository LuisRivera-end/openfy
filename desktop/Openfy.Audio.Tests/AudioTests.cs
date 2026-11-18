using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using NAudio.Wave;
using Openfy.Core;
using Openfy.Windows.Audio;
using Xunit;

namespace Openfy.Audio.Tests;

public class AudioTests
{
    private static string ProjectRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null && !File.Exists(Path.Combine(directory.FullName, "package.json"))) directory = directory.Parent;
        return directory?.FullName ?? throw new IOException("Ejecuta las pruebas desde el checkout de Openfy.");
    }
    private static async Task<string> FixtureAsync(bool fragmented = false, string format = "aac")
    {
        string root = ProjectRoot(), path = Path.Combine(Path.GetTempPath(), "openfy-audio-" + Guid.NewGuid() + (format == "aac" ? ".m4a" : "." + format));
        var info = new ProcessStartInfo(Path.Combine(root, "node_modules", "ffmpeg-static", "ffmpeg.exe")) { CreateNoWindow = true, UseShellExecute = false, RedirectStandardError = true };
        foreach (var arg in new[] { "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", format == "mp3" ? "libmp3lame" : format }) info.ArgumentList.Add(arg);
        if (format == "aac") { info.ArgumentList.Add("-movflags"); info.ArgumentList.Add(fragmented ? "dash+frag_keyframe+empty_moov+default_base_moof" : "+faststart"); }
        if (fragmented) { info.ArgumentList.Add("-frag_duration"); info.ArgumentList.Add("500000"); }
        info.ArgumentList.Add(path);
        using var process = Process.Start(info)!; await process.WaitForExitAsync();
        Assert.Equal(0, process.ExitCode); return path;
    }
    [Fact]
    public async Task FragmentedAacUsesTheNativeDecoderAndRetainsSeekWithoutAudioFiles()
    {
        string path = await FixtureAsync(true);
        try
        {
            using var client = new HttpClient(new MemoryRanges(await File.ReadAllBytesAsync(path)));
            using var network = new HttpRangeStream(client, "https://example.test/fragmented.m4a");
            using var indexed = FragmentedMp4Stream.Open(network);
            using var reader = await Task.Run(() => new StreamMediaFoundationReader(indexed, new() { RequestFloatOutput = true, SingleReaderObject = true }, "audio/mp4", "track.m4a"));
            Assert.InRange(reader.TotalTime.TotalSeconds, 1.8, 2.2);
            Assert.True(await Task.Run(() => reader.Read(new byte[16384], 0, 16384)) > 0);
            Assert.True(await Task.Run(() => { reader.CurrentTime = TimeSpan.FromSeconds(1); return reader.Read(new byte[16384], 0, 16384); }) > 0);
        }
        finally { File.Delete(path); }
    }
    [Fact]
    public async Task MemoryOnlyRemoteAudioDecodesAndSeeksInsteadOfEndingPrematurely()
    {
        string path = await FixtureAsync();
        try
        {
            byte[] data = await File.ReadAllBytesAsync(path);
            using var client = new HttpClient(new MemoryRanges(data));
            using var stream = new HttpRangeStream(client, "https://example.test/track.m4a");
            using var reader = await Task.Run(() => new StreamMediaFoundationReader(stream, new() { RequestFloatOutput = true, SingleReaderObject = true }, "audio/mp4", "track.m4a"));
            Assert.InRange(reader.TotalTime.TotalSeconds, 1.8, 2.2);
            int bytes = await Task.Run(() => { reader.CurrentTime = TimeSpan.Zero; return reader.Read(new byte[16384], 0, 16384); });
            Assert.True(bytes > 0, "El primer bloque decodificado debe contener audio.");
            int sought = await Task.Run(() => { reader.CurrentTime = TimeSpan.FromSeconds(1); return reader.Read(new byte[16384], 0, 16384); });
            Assert.True(sought > 0, "Seek no debe finalizar prematuramente el audio.");
        }
        finally { File.Delete(path); }
    }
    [Theory]
    [InlineData("aac")] [InlineData("mp3")] [InlineData("flac")]
    public async Task WasapiPlaybackAdvancesAndPausesWithNoAudibleOutput(string format)
    {
        string path = await FixtureAsync(format: format);
        try
        {
            using var client = new BackendClient(); await using var engine = new AudioEngine(client);
            string? failure = null; engine.Failed += message => failure = message;
            engine.SetVolume(0); await engine.OpenAsync(path, false, 0, true);
            await Task.Delay(700); Assert.Null(failure); Assert.True(engine.Position > .1, "El reloj WASAPI debe avanzar.");
            engine.Pause(); double at = engine.Position; await Task.Delay(200); Assert.InRange(engine.Position - at, -.01, .05);
        }
        finally { File.Delete(path); }
    }
    [Fact]
    public async Task OpeningSeekingAndEndDetectionDoNotWaitForTheUiContext()
    {
        string path = await FixtureAsync();
        try {
            using var client = new BackendClient(); await using var engine = new AudioEngine(client);
            engine.SetVolume(0);
            var ended = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            engine.Ended += () => ended.TrySetResult();
            var ui = new BlockedUiContext();
            var previous = SynchronizationContext.Current;
            Task opening;
            try {
                SynchronizationContext.SetSynchronizationContext(ui);
                opening = engine.OpenAsync(path, false, 1, true);
            } finally { SynchronizationContext.SetSynchronizationContext(previous); }
            await opening.WaitAsync(TimeSpan.FromSeconds(5));
            await ended.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(0, ui.Posts);
            Assert.False(engine.Playing);
        } finally { File.Delete(path); }
    }
    [Fact]
    public async Task PresenceDistinguishesUserPauseFromNaturalEndAndKeepsSelectionIdentity()
    {
        string path = await FixtureAsync();
        try {
            using var client = new BackendClient(); await using var engine = new AudioEngine(client);
            engine.SetVolume(0);
            var snapshots = new System.Collections.Concurrent.ConcurrentQueue<AudioPlaybackSnapshot>();
            var ended = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            engine.PresenceChanged += snapshots.Enqueue;
            engine.Ended += () => ended.TrySetResult();
            await engine.OpenAsync(path, false, 0, true, 10); await Task.Delay(250);
            engine.Pause();
            var paused = engine.CapturePresence(); Assert.Equal(10, paused.Generation); Assert.Equal(PlaybackPresenceState.Paused, paused.State);
            await engine.OpenAsync(path, false, 1.5, true, 11);
            await ended.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(11, engine.CapturePresence().Generation); Assert.Equal(PlaybackPresenceState.Ended, engine.CapturePresence().State);
            engine.Pause(); Assert.Equal(PlaybackPresenceState.Ended, engine.CapturePresence().State);
            Assert.Contains(snapshots, value => value.Generation == 10 && value.State == PlaybackPresenceState.Paused);
            Assert.Contains(snapshots, value => value.Generation == 11 && value.State == PlaybackPresenceState.Ended);
        } finally { File.Delete(path); }
    }
    [Fact]
    public async Task SupersededOpenCannotReplaceANewerSelectionAndOpenFailureIsNotPause()
    {
        string path = await FixtureAsync();
        try {
            using var client = new BackendClient(); await using var engine = new AudioEngine(client);
            engine.SetVolume(0); engine.InvalidateSelection(20);
            await engine.OpenAsync("missing-obsolete-file", false, 0, true, 19);
            Assert.Equal(PlaybackPresenceState.Idle, engine.CapturePresence().State);
            await engine.OpenAsync(path, false, 0, false, 20);
            await engine.OpenAsync("missing-obsolete-file", false, 0, true, 19);
            Assert.Equal(20, engine.CapturePresence().Generation);
            await Assert.ThrowsAnyAsync<Exception>(() => engine.OpenAsync(Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".flac"), false, 0, true, 21));
            Assert.Equal(21, engine.CapturePresence().Generation); Assert.Equal(PlaybackPresenceState.Failed, engine.CapturePresence().State);
            engine.Pause(); Assert.Equal(PlaybackPresenceState.Failed, engine.CapturePresence().State);
        } finally { File.Delete(path); }
    }
    private sealed class BlockedUiContext : SynchronizationContext
    {
        public int Posts;
        public override void Post(SendOrPostCallback callback, object? state) => Interlocked.Increment(ref Posts);
    }
    private sealed class MemoryRanges(byte[] data) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
        {
            if (request.Method == HttpMethod.Head) { var head = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([]) }; head.Content.Headers.ContentLength = data.Length; return Task.FromResult(head); }
            var range = request.Headers.Range!.Ranges.Single(); int first = (int)range.From!.Value, last = (int)range.To!.Value;
            var content = new ByteArrayContent(data[first..(last + 1)]); content.Headers.ContentRange = new ContentRangeHeaderValue(first, last, data.Length);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = content });
        }
    }
}
