using Openfy.Core;

namespace Openfy.Windows.Services;

public sealed class ArtworkService(BackendHost host)
{
    private readonly Dictionary<string, Task<ArtworkResult>> pending = [];
    private readonly Dictionary<string, (ArtworkResult Result, long Checked)> ready = [];
    public async Task<ArtworkResult> GetAsync(string url, int size = 128)
    {
        string key = size + ":" + url;
        if (ready.TryGetValue(key, out var cached) && File.Exists(cached.Result.Path) && (Math.Max(cached.Result.Width, cached.Result.Height) >= size || Environment.TickCount64 - cached.Checked < 300000)) return cached.Result;
        if (!pending.TryGetValue(key, out var work)) pending[key] = work = host.CallAsync<ArtworkResult>("prepareArtwork", new { url, size });
        try { var result = await work; ready[key] = (result, Environment.TickCount64); return result; }
        finally { if (pending.GetValueOrDefault(key) == work) pending.Remove(key); }
    }
}
