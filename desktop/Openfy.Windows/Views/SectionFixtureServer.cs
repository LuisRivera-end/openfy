using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Openfy.Core;

namespace Openfy.Windows.Views;

// Used only by --sections-check with a disposable data/state directory.
internal sealed class SectionFixtureServer : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource lifetime = new();
    private readonly ConcurrentBag<Task> replies = new();
    private readonly Task accepting;
    private int artistRequests;
    public int ArtistRequests => Volatile.Read(ref artistRequests);
    private int searchRequests, continuations;
    public int SearchRequests => Volatile.Read(ref searchRequests);
    public int SearchContinuations => Volatile.Read(ref continuations);
    public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;
    private static readonly YouTubeSong[] songs = Enumerable.Range(0, 30).Select(i => new YouTubeSong($"netw{i:0000000}", "Canción de red " + i, ["Artista de red"], "Álbum de red", null, 180)).ToArray();
    public SectionFixtureServer() { listener.Start(); accepting = Task.Run(AcceptAsync); }
    private async Task AcceptAsync()
    {
        try { while (!lifetime.IsCancellationRequested) { var client = await listener.AcceptTcpClientAsync(lifetime.Token); replies.Add(ReplyAsync(client)); } }
        catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or SocketException) { }
    }
    private async Task ReplyAsync(TcpClient client)
    {
        using (client) try {
            using var stream = client.GetStream(); using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
            var first = await reader.ReadLineAsync(lifetime.Token); if (first == null) return;
            while (await reader.ReadLineAsync(lifetime.Token) is { Length: > 0 }) { }
            var uri = new Uri("http://127.0.0.1" + first.Split(' ')[1]);
            string path = uri.AbsolutePath; int delay = 500, status = 200; object body = new { };
            if (path.StartsWith("/api/music/artists/")) {
                Interlocked.Increment(ref artistRequests);
                if (path.EndsWith("failure")) { status = 503; body = new { message = "Servicio de prueba no disponible." }; }
                else body = new ArtistProfile("fixture-artist", "Artista de red", null, "Biografía de prueba", songs, [], [], new());
            } else if (path.StartsWith("/api/music/albums/")) body = new AlbumDetail("fixture-album", "Álbum de red", [], null, 2026, songs);
            else if (path == "/api/music/search") {
                Interlocked.Increment(ref searchRequests);
                bool more = uri.Query.Contains("cursor="); if (more) Interlocked.Increment(ref continuations);
                if (uri.Query.Contains("type=artist")) { delay = 350; body = new ArtistPage(Enumerable.Range(more ? 6 : 0, 6).Select(i => new YouTubeArtist("related" + i, "Artista encontrado " + i, null)).ToArray(), more ? null : "artists:6"); }
                else if (uri.Query.Contains("type=album")) { delay = 700; body = new AlbumSearchPage(Enumerable.Range(more ? 6 : 0, 6).Select(i => new YouTubeAlbum("release" + i, "Álbum encontrado " + i, [], null, 2026)).ToArray(), more ? null : "albums:6"); }
                else { delay = 80; body = new SongPage(more ? songs.Skip(20).ToArray() : songs.Take(20).ToArray(), more ? null : "songs:20"); }
            } else if (path == "/api/telemetry/top") {
                string title = uri.Query.Contains("query=slow") ? "slow" : uri.Query.Contains("query=fast") ? "fast" : "base";
                delay = title == "slow" ? 600 : 150;
                var song = songs[0] with { Title = title }; var entry = new PlaybackEntry("youtube", Song: song);
                body = new MostPlayedPage([new(new(entry.Key, "youtube", title, "Artista", "Álbum", null, [], 180, false, "YouTube", entry), 1000, 1, 1)], 1, 0, 50);
            }
            await Task.Delay(delay, lifetime.Token);
            byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(body, Contracts.Json);
            byte[] headers = Encoding.ASCII.GetBytes($"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {bytes.Length}\r\nConnection: close\r\n\r\n");
            await stream.WriteAsync(headers, lifetime.Token); await stream.WriteAsync(bytes, lifetime.Token);
        } catch (Exception error) when (error is IOException or OperationCanceledException or ObjectDisposedException or SocketException) { }
    }
    public async ValueTask DisposeAsync() { lifetime.Cancel(); listener.Stop(); await accepting; await Task.WhenAll(replies); lifetime.Dispose(); }
}
