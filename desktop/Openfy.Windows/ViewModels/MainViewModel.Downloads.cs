using System.Collections.ObjectModel;
using System.Text.Json;
using Openfy.Core;

namespace Openfy.Windows.ViewModels;

public sealed partial class MainViewModel
{
    public ObservableCollection<AudioDownloadJob> Downloads { get; } = [];
    private int downloadProgressGeneration;
    private readonly Dictionary<string, int> downloadProgressVersions = new();
    public List<OfflineCollection> OfflineCollections { get; private set; } = [];
    public string? CurrentOfflineKey => CurrentPlaylist is { } playlist ? "playlist:" + playlist.Id
        : page == "album" && catalogId != null ? "album:" + catalogId
        : page == "localalbum" && localAlbumId?.StartsWith("youtube:", StringComparison.Ordinal) == true ? "album:" + localAlbumId[8..] : null;
    public OfflineCollection? CurrentOfflineCollection => OfflineCollections.FirstOrDefault(target => target.Key == CurrentOfflineKey);
    public string CollectionDownloadLabel => CurrentOfflineCollection is { Enabled: true } target
        ? $"Mantener descargado · {target.Entries.Count(IsDownloaded)}/{target.Entries.Count}" : "Descargar en este PC";
    private async Task RefreshDownloadsAsync(CancellationToken cancellation = default)
    {
        int generation = downloadProgressGeneration;
        var jobs = await Api.GetAsync<List<AudioDownloadJob>>("api/music/downloads", cancellation);
        // A pipe notification can overtake the HTTP snapshot. Keep newer progress,
        // including a just-created job that was absent when the request began.
        if (generation != downloadProgressGeneration) {
            var merged = jobs.ToDictionary(job => job.Id);
            foreach (var current in Downloads)
                if (downloadProgressVersions.GetValueOrDefault(current.Id) > generation
                    && (!merged.TryGetValue(current.Id, out var snapshot) || current.UpdatedAt >= snapshot.UpdatedAt)) merged[current.Id] = current;
            jobs = merged.Values.ToList();
        }
        CollectionUpdates.Replace(Downloads, jobs.OrderByDescending(job => job.CreatedAt), job => job.Id, SameDownload);
        OfflineCollections = await Api.GetAsync<List<OfflineCollection>>("api/offline/collections", cancellation);
    }
    private void OnDownloadProgress(JsonElement payload)
    {
        if (payload.Deserialize<AudioDownloadJob>(Contracts.Json) is not { } job) return;
        downloadProgressVersions[job.Id] = ++downloadProgressGeneration;
        int index = -1;
        for (int i = 0; i < Downloads.Count; i++) if (Downloads[i].Id == job.Id) { index = i; break; }
        if (index < 0) Downloads.Add(job); else Downloads[index] = job;
        Status = DownloadLabel(job);
    }
    private static bool SameDownload(AudioDownloadJob a, AudioDownloadJob b) => a.Id == b.Id && a.VideoId == b.VideoId && a.State == b.State
        && a.Bytes == b.Bytes && a.Total == b.Total && a.Attempts == b.Attempts && a.Error == b.Error && a.ErrorCode == b.ErrorCode
        && a.Suppressed == b.Suppressed && a.CreatedAt == b.CreatedAt && a.UpdatedAt == b.UpdatedAt
        && SameSong(a.Song, b.Song);
    public static string DownloadLabel(AudioDownloadJob job) => job.State switch {
        "queued" => "Pendiente", "downloading" => $"Descargando al PC {(job.Total > 0 ? job.Bytes * 100 / job.Total : 0)} %",
        "processing" => "Preparando audio", "ready" => "Disponible sin conexión en este PC", "cancelled" => "Descarga cancelada",
        "removed" => "Copia eliminada del PC", _ => job.Error ?? "No se pudo descargar",
    };
    public async Task DownloadSongAsync(SongRow song)
    {
        if (song.Entry.Song == null) return;
        await Api.SendAsync<AudioDownloadJob[]>("api/music/downloads", HttpMethod.Post, new { songs = new[] { song.Entry.Song }, intent = "manual" });
        await RefreshAsync();
    }
    public async Task DownloadFavoritesAsync()
    {
        // Snapshot the whole collection, independently of the current search/download filter.
        // Local files and verified YouTube assets are already available on this PC.
        var songs = Library.SavedSongs.Where(saved => saved.Favorite && saved.LocalAudio == null).Select(saved => saved.Song).ToArray();
        foreach (var batch in songs.Chunk(100))
            await Api.SendAsync<AudioDownloadJob[]>("api/music/downloads", HttpMethod.Post, new { songs = batch, intent = "manual" });
        if (songs.Length > 0) await RefreshAsync();
    }
    public async Task ToggleCollectionDownloadAsync()
    {
        if (CurrentOfflineKey is not { } key) return;
        var parts = key.Split(':', 2);
        await Api.SendAsync<OfflineCollection>($"api/offline/collections/{parts[0]}/{Uri.EscapeDataString(parts[1])}", HttpMethod.Put,
            new { enabled = CurrentOfflineCollection?.Enabled != true });
        await RefreshAsync(); ContentChanged?.Invoke();
    }
    public async Task ChangeDownloadAsync(AudioDownloadJob job, string action)
    {
        await Api.SendAsync<AudioDownloadJob>("api/music/downloads/" + job.Id, HttpMethod.Patch, new { action });
        await RefreshAsync();
    }
    public async Task RemoveDownloadAsync(string videoId)
    {
        await Api.SendAsync<JsonElement>($"api/music/youtube/{videoId}/local-audio", HttpMethod.Delete);
        await RefreshAsync();
    }
}
