using System.Net.Http.Json;
using System.Text.Json;

namespace Openfy.Core;

public sealed class BackendClient : IDisposable
{
    public HttpClient Http { get; } = new() { Timeout = TimeSpan.FromSeconds(30) };
    public void SetPort(int port) { var address = new Uri($"http://127.0.0.1:{port}/"); if (Http.BaseAddress != address) Http.BaseAddress = address; }
    // Large JSON snapshots and request serialization must not run on WinUI,
    // including when a buffered localhost response completes synchronously.
    public Task<T> GetAsync<T>(string path, CancellationToken cancellation = default)
        => Task.Run(() => GetCoreAsync<T>(path, cancellation), cancellation);
    private async Task<T> GetCoreAsync<T>(string path, CancellationToken cancellation)
    {
        var elapsed = System.Diagnostics.Stopwatch.StartNew();
        SessionLog.Write("http.GET", "started", path.Split('?')[0]);
        try {
            using var response = await Http.GetAsync(path, cancellation);
            await EnsureAsync(response);
            var result = (await response.Content.ReadFromJsonAsync<T>(Contracts.Json, cancellation))!;
            SessionLog.Write("http.GET", "completed", path.Split('?')[0], elapsed.Elapsed.TotalMilliseconds, (int)response.StatusCode);
            return result;
        } catch (Exception error) { SessionLog.Write("http.GET", "failed", path.Split('?')[0], elapsed.Elapsed.TotalMilliseconds, error: error); throw; }
    }
    public Task<T> SendAsync<T>(string path, HttpMethod method, object? body = null, CancellationToken cancellation = default)
        => Task.Run(() => SendCoreAsync<T>(path, method, body, cancellation), cancellation);
    public Task<(AlbumPresentation Presentation, long RetryAfterMs)> AlbumPresentationAsync(AlbumPresentationRequest request, CancellationToken cancellation = default)
        => Task.Run(async () => {
            long retryAfter = 0;
            var result = await SendCoreAsync<AlbumPresentation>("api/albums/presentation", HttpMethod.Post, request, cancellation,
                response => retryAfter = RetryAfterMilliseconds(response));
            return (result, retryAfter);
        }, cancellation);

    private async Task<T> SendCoreAsync<T>(string path, HttpMethod method, object? body, CancellationToken cancellation, Action<HttpResponseMessage>? readHeaders = null)
    {
        using var request = new HttpRequestMessage(method, path) { Content = body is null ? null : JsonContent.Create(body, options: Contracts.Json) };
        var elapsed = System.Diagnostics.Stopwatch.StartNew();
        SessionLog.Write("http." + method, "started", path.Split('?')[0]);
        try {
            using var response = await Http.SendAsync(request, cancellation);
            await EnsureAsync(response);
            readHeaders?.Invoke(response);
            var result = (await response.Content.ReadFromJsonAsync<T>(Contracts.Json, cancellation))!;
            SessionLog.Write("http." + method, "completed", path.Split('?')[0], elapsed.Elapsed.TotalMilliseconds, (int)response.StatusCode);
            return result;
        } catch (Exception error) { SessionLog.Write("http." + method, "failed", path.Split('?')[0], elapsed.Elapsed.TotalMilliseconds, error: error); throw; }
    }
    private static async Task EnsureAsync(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        string message = $"No se pudo completar la operación ({(int)response.StatusCode}).";
        try { message = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString() ?? message; } catch { }
        var failure = new HttpRequestException(message, null, response.StatusCode);
        long retryMs = RetryAfterMilliseconds(response);
        if (retryMs > 0) failure.Data["RetryAfterMs"] = retryMs;
        throw failure;
    }

    private static long RetryAfterMilliseconds(HttpResponseMessage response)
    {
        var retry = response.Headers.RetryAfter;
        double? retryMs = retry?.Delta?.TotalMilliseconds;
        if (retryMs == null && retry?.Date is { } date) retryMs = (date - DateTimeOffset.UtcNow).TotalMilliseconds;
        return retryMs > 0 ? (long)Math.Min(retryMs.Value, 30L * 24 * 3_600_000) : 0;
    }
    public void Dispose() => Http.Dispose();
}
