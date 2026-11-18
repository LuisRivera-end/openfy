using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Openfy.Core;
using Openfy.Windows.Services;
using Xunit;

namespace Openfy.Audio.Tests;

public class BackendTests
{
    [Fact]
    public async Task ListeningOutboxSurvivesAnUnavailableBackendAndFlushesExactlyOnce()
    {
        string temporary = Path.Combine(Path.GetTempPath(), "openfy-listening-host-" + Guid.NewGuid());
        var reservation = new TcpListener(IPAddress.Loopback, 0); reservation.Start(); int port = ((IPEndPoint)reservation.LocalEndpoint).Port; reservation.Stop();
        try
        {
            using var api = new BackendClient(); api.SetPort(port);
            var store = new AtomicStore(Path.Combine(temporary, "state"));
            var client = new ListeningClient(api, store); await client.InitializeAsync();
            var entry = new PlaybackEntry("youtube", Song: new("abcdefghijk", "Escucha nativa", ["Openfy"], null, null, .1));
            client.Select(entry); client.Sample(0, .1, true); await Task.Delay(130); client.Sample(.1, .1, false);
            await client.CheckpointAsync(); await client.FlushAsync(); Assert.Equal(1, client.PendingCount);
            var restored = new ListeningClient(api, store); await restored.InitializeAsync(); Assert.Equal(1, restored.PendingCount);
            await using (var host = new BackendHost(api, new(Workspace(), Path.Combine(temporary, "data"), port)))
            {
                await host.StartAsync(); await restored.FlushAsync(); Assert.Equal(0, restored.PendingCount);
                var stats = await api.GetAsync<ListeningStats>("api/telemetry/stats?period=all"); Assert.Equal(1, stats.ByTrack[entry.Key].Plays);
                await restored.FlushAsync(); Assert.Equal(1, (await api.GetAsync<ListeningStats>("api/telemetry/stats?period=all")).ByTrack[entry.Key].Plays);
            }
        }
        finally { Assert.StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())) + Path.DirectorySeparatorChar, Path.GetFullPath(temporary)); if (Directory.Exists(temporary)) Directory.Delete(temporary, true); }
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CancellationStopsHungStartupWithoutWaitingThirtySeconds(bool explicitCancellation)
    {
        string temporary = Path.Combine(Path.GetTempPath(), "openfy-startup-" + Guid.NewGuid());
        try
        {
            Directory.CreateDirectory(Path.Combine(temporary, "scripts")); Directory.CreateDirectory(Path.Combine(temporary, ".output", "server"));
            File.Copy(Path.Combine(Workspace(), ".openfy-runtime.json"), Path.Combine(temporary, ".openfy-runtime.json"));
            await File.WriteAllTextAsync(Path.Combine(temporary, ".output", "server", "index.mjs"), "");
            await File.WriteAllTextAsync(Path.Combine(temporary, "scripts", "serve.mjs"), "setInterval(() => {}, 1000)");
            using var api = new BackendClient(); await using var host = new BackendHost(api, new(temporary, Path.Combine(temporary, "data"), 4290));
            using var cancellation = new CancellationTokenSource();
            var startup = host.StartAsync(cancellation.Token);
            for (int i = 0; i < 100 && host.ProcessId == null; i++) await Task.Delay(10);
            Assert.NotNull(host.ProcessId);
            var clock = Stopwatch.StartNew();
            if (explicitCancellation) { cancellation.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => startup); await host.DisposeAsync(); }
            else { await host.DisposeAsync(); await Assert.ThrowsAsync<IOException>(() => startup); }
            Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5)); Assert.Null(host.ProcessId);
        }
        finally {
            Assert.StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())) + Path.DirectorySeparatorChar, Path.GetFullPath(temporary));
            // Windows can briefly retain the process working directory after termination.
            for (int attempt = 0; Directory.Exists(temporary); attempt++) {
                try { Directory.Delete(temporary, true); }
                catch (IOException) when (attempt < 19) { await Task.Delay(50); }
            }
        }
    }
    private static string Workspace()
    {
        if (Environment.GetEnvironmentVariable("OPENFY_TEST_WORKSPACE") is { Length: > 0 } isolated) return Path.GetFullPath(isolated);
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null && !File.Exists(Path.Combine(directory.FullName, "package.json"))) directory = directory.Parent;
        return directory!.FullName;
    }
    [Fact]
    public async Task OwnsOneLibraryRecoversItsProcessAndStopsCleanly()
    {
        string temporary = Path.Combine(Path.GetTempPath(), "openfy-host-" + Guid.NewGuid());
        var reservation = new TcpListener(IPAddress.Loopback, 0); reservation.Start(); int port = ((IPEndPoint)reservation.LocalEndpoint).Port; reservation.Stop();
        int node = 0;
        try
        {
            using var api = new BackendClient();
            await using (var host = new BackendHost(api, new(Workspace(), temporary, port)))
            {
                await host.StartAsync(); Assert.True(host.Connected); node = host.ProcessId!.Value;
                Assert.Empty((await api.GetAsync<Library>("api/library")).Tracks);
                using var duplicateApi = new BackendClient();
                await using var duplicate = new BackendHost(duplicateApi, new(Workspace(), temporary, port + 1));
                await Assert.ThrowsAsync<IOException>(() => duplicate.StartAsync());
                Assert.False(duplicate.Connected);
                using (var owned = Process.GetProcessById(node)) owned.Kill();
                for (int i = 0; i < 200 && (!host.Connected || host.ProcessId == null || host.ProcessId == node); i++) await Task.Delay(100);
                Assert.True(host.Connected); Assert.NotEqual(node, host.ProcessId); node = host.ProcessId!.Value;
                Assert.Empty((await api.GetAsync<Library>("api/library")).Tracks);
            }
            Assert.DoesNotContain(Process.GetProcessesByName("node"), process => { using (process) return process.Id == node; });
            Assert.False(File.Exists(Path.Combine(temporary, ".openfy-library.lock")));
        }
        finally { Assert.StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())) + Path.DirectorySeparatorChar, Path.GetFullPath(temporary)); if (Directory.Exists(temporary)) Directory.Delete(temporary, true); }
    }
    [Fact]
    public async Task OccupiedPortFailsWithoutChangingItOrLeavingAProcess()
    {
        string temporary = Path.Combine(Path.GetTempPath(), "openfy-port-" + Guid.NewGuid());
        var occupied = new TcpListener(IPAddress.Loopback, 0); occupied.Start(); int port = ((IPEndPoint)occupied.LocalEndpoint).Port;
        try
        {
            using var api = new BackendClient(); await using var host = new BackendHost(api, new(Workspace(), temporary, port));
            await Assert.ThrowsAsync<IOException>(() => host.StartAsync());
            Assert.Equal(port, host.Port); Assert.False(host.Connected); Assert.Null(host.ProcessId);
        }
        finally { occupied.Stop(); Assert.StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())) + Path.DirectorySeparatorChar, Path.GetFullPath(temporary)); if (Directory.Exists(temporary)) Directory.Delete(temporary, true); }
    }
}
