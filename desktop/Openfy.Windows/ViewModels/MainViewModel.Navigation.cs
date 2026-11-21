using Openfy.Core;
using System.Collections.ObjectModel;

namespace Openfy.Windows.ViewModels;

public sealed partial class MainViewModel
{
    public bool ContentLoading { get; private set; }
    public string PageLoadError { get; private set; } = "";
    public bool SearchSongsLoading { get; private set; }
    public bool SearchArtistsLoading { get; private set; }
    public bool SearchAlbumsLoading { get; private set; }
    public Func<Task> YieldForNavigationAsync { get; set; } = async () => await Task.Yield();
    public Func<string, bool> CanReuseLocalView { get; set; } = _ => false;
    private readonly ObservableCollection<SongRow> remoteSongs = new BatchedObservableCollection<SongRow>();
    private readonly Dictionary<string, (ObservableCollection<SongRow> Rows, long Used)> localSongViews = new();
    private long songViewClock;
    private void UseSongs(ObservableCollection<SongRow> rows) { if (!ReferenceEquals(Songs, rows)) { Songs = rows; Notify(nameof(Songs)); } }
    private void UseRemoteSongs() => UseSongs(remoteSongs);
    private void UseLocalSongs(string key)
    {
        var rows = localSongViews.TryGetValue(key, out var saved) ? saved.Rows : new BatchedObservableCollection<SongRow>();
        localSongViews[key] = (rows, ++songViewClock); UseSongs(rows);
        if (localSongViews.Count > 6) localSongViews.Remove(localSongViews.MinBy(pair => pair.Value.Used).Key);
    }

    private CancellationToken BeginContentNavigation(string target, bool showLoading = true)
    {
        EndAlbumPresentation();
        CancelSearchLoads();
        searchCancellation?.Cancel(); searchCancellation?.Dispose(); searchCancellation = new();
        contentGeneration++; page = target; PageLoadError = "";
        SearchSongsLoading = SearchArtistsLoading = SearchAlbumsLoading = false;
        ContentLoading = showLoading; Busy = true;
        Notify(nameof(Page)); if (showLoading) ContentChanged?.Invoke();
        return searchCancellation.Token;
    }
    private void FinishContentNavigation(int own)
    {
        if (own != contentGeneration) return;
        if (!ContentLoading && !Busy && PageLoadError.Length == 0) return;
        ContentLoading = false; Busy = false; ContentChanged?.Invoke();
    }
    public async Task NavigateLocalAsync(string target, string? id = null, bool force = false)
    {
        if (!force && target == page && LocalNavigationKey(target, id) == filterViewKey && !ContentLoading && PageLoadError.Length == 0) return;
        if (CanReuseLocalView(target)) { ShowLocal(target, id); return; }
        SaveSearch();
        var cancellation = BeginContentNavigation(target); int own = contentGeneration;
        try {
            await YieldForNavigationAsync(); cancellation.ThrowIfCancellationRequested();
            if (target is not ("settings" or "downloads")) await PrepareLibraryRowsAsync(cancellation);
            if (own != contentGeneration) return;
            ContentLoading = false;
            ShowLocalCore(target, id);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception failure) { if (own == contentGeneration) PageLoadError = failure.Message; }
        finally { FinishContentNavigation(own); }
    }
    public Task NavigateLocalAlbumAsync(string id) { if (localAlbumId != id) libraryFilter = ""; localAlbumId = id; return NavigateLocalAsync("localalbum"); }
    public Task NavigateLocalArtistAsync(string name) { if (localArtistName != name) libraryFilter = ""; localArtistName = name; return NavigateLocalAsync("localartist"); }
    public Task RetryPageAsync() => page switch {
        "artist" when catalogId != null => ArtistAsync(catalogId),
        "album" when catalogId != null => AlbumAsync(catalogId),
        "search" => SearchAsync(), "most-played" => ShowMostPlayedAsync(),
        _ => NavigateLocalAsync(page, playlistId)
    };
    private PlaybackEntry? IndexedEntry(string id) => id.StartsWith("youtube:", StringComparison.Ordinal)
        ? FindSaved(id[8..]) is { } saved ? new("youtube", Song: saved.Song) : null
        : FindTrack(id) != null ? new("local", id) : null;
    private string LocalNavigationKey(string target, string? id) => target + ":" + (target == "playlist" ? id ?? playlistId : target == "localalbum" ? localAlbumId : target == "localartist" ? localArtistName : "");
    private readonly Dictionary<string, (DateTime At, ArtistProfile Value)> artistPages = new();
    private readonly Dictionary<string, (DateTime At, AlbumDetail Value)> albumPages = new();
    private const long AlbumRetryDelay = 15 * 60_000;
    private sealed class AlbumPresentationCache
    {
        public AlbumDescription? Description;
        public AlbumPresentationColors? Colors;
        public long MetadataRetryAt, MotionRetryAt;
    }

    private readonly Dictionary<string, AlbumPresentationCache> albumPresentations = [];
    private AlbumPresentationRequest? albumPresentationRequest;
    private AlbumPresentationCache? currentAlbumPresentation;
    private AlbumDescription? albumDetailDescription;
    private CancellationTokenSource? albumPresentationCancellation;
    private bool albumMetadataLoading, albumMotionLoading, albumMotionRetried;
    public event Action? AlbumPresentationChanged;
    public AlbumDescription? CatalogAlbumDescription => currentAlbumPresentation?.Description is { Source: "apple" } editorial
        ? editorial : albumDetailDescription ?? currentAlbumPresentation?.Description;
    public string? AlbumArtworkColor => currentAlbumPresentation?.Colors?.Background;
    public MotionArtResult? AlbumMotion { get; private set; }
    public bool AlbumMetadataLoading => albumMetadataLoading;
    public int? CatalogAlbumYear { get; private set; }
    public ArtistRef[] CatalogAlbumArtists { get; private set; } = [];

    private void EndAlbumPresentation()
    {
        albumPresentationCancellation?.Cancel();
        albumPresentationCancellation?.Dispose();
        albumPresentationCancellation = null;
        albumPresentationRequest = null;
        currentAlbumPresentation = null;
        albumDetailDescription = null;
        AlbumMotion = null;
        albumMetadataLoading = albumMotionLoading = albumMotionRetried = false;
    }

    private void BeginAlbumPresentation(string key, AlbumPresentationRequest? request, string? youtubeDescription = null)
    {
        EndAlbumPresentation();
        albumDetailDescription = string.IsNullOrWhiteSpace(youtubeDescription) ? null : new(youtubeDescription, "youtube");
        if (request == null) return;
        if (!albumPresentations.TryGetValue(key, out var cached))
        {
            if (albumPresentations.Count >= 96) albumPresentations.Remove(albumPresentations.Keys.First());
            albumPresentations[key] = cached = new();
        }
        currentAlbumPresentation = cached;
        albumPresentationRequest = request;
        albumPresentationCancellation = new();
        _ = LoadAlbumPresentationAsync(motion: false);
    }

    public Task RequestAlbumMotionAsync() => LoadAlbumPresentationAsync(motion: true);

    public bool InvalidateAlbumMotionForRetry(string url)
    {
        if (albumMotionRetried || currentAlbumPresentation is not { } cached || AlbumMotion?.Url != url) return false;
        albumMotionRetried = true;
        AlbumMotion = null;
        cached.MotionRetryAt = 0;
        return true;
    }

    private async Task LoadAlbumPresentationAsync(bool motion)
    {
        if (albumPresentationRequest is not { } request || currentAlbumPresentation is not { } cached
            || albumPresentationCancellation is not { } lifetime) return;
        long now = Environment.TickCount64;
        if (albumMetadataLoading || (motion ? albumMotionLoading || AlbumMotion is { Status: "ready", Url.Length: > 0 }
            || now < cached.MotionRetryAt : now < cached.MetadataRetryAt)) return;
        if (motion) albumMotionLoading = true;
        else albumMetadataLoading = true;
        int own = contentGeneration;
        var cancellation = lifetime.Token;
        try
        {
            var (result, retry) = await Api.AlbumPresentationAsync(request with { Motion = motion }, cancellation);
            if (own != contentGeneration || cancellation.IsCancellationRequested) return;
            now = Environment.TickCount64;
            if (result.Colors is { } colors) cached.Colors = colors;
            if (result.Description is { } description && !string.IsNullOrWhiteSpace(description.Text)
                && (cached.Description?.Source != "apple" || description.Source == "apple")) cached.Description = description;
            if (motion)
            {
                AlbumMotion = result.Motion;
                cached.MotionRetryAt = result.Motion is { Status: "ready", Url.Length: > 0 } ? 0
                    : now + Math.Max(1_000, result.Motion.RetryAfterMs > 0 ? result.Motion.RetryAfterMs : retry > 0 ? retry : AlbumRetryDelay);
            }
            if (!motion || retry == 0)
                cached.MetadataRetryAt = now + (retry > 0 ? retry : cached.Colors != null || cached.Description?.Source == "apple" ? 7 * 86_400_000L : 86_400_000L);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception error)
        {
            if (own != contentGeneration || cancellation.IsCancellationRequested) return;
            long retryAt = Environment.TickCount64 + (error.Data["RetryAfterMs"] is long retry ? retry : AlbumRetryDelay);
            if (motion) cached.MotionRetryAt = retryAt;
            else cached.MetadataRetryAt = retryAt;
        }
        finally
        {
            if (own == contentGeneration && !cancellation.IsCancellationRequested)
            {
                if (motion) albumMotionLoading = false;
                else albumMetadataLoading = false;
                Description = CatalogAlbumDescription?.Text ?? "";
                AlbumPresentationChanged?.Invoke();
            }
        }
    }

    private static AlbumPresentationRequest? YouTubeAlbumPresentation(string? id, IEnumerable<string> artists, string title)
    {
        var names = artists.Where(name => !string.IsNullOrWhiteSpace(name)).Distinct().Take(20).ToArray();
        return names.Length == 0 || string.IsNullOrWhiteSpace(title) ? null : new("youtube", AlbumId: id, Artists: names, Album: title);
    }

    private static ArtistRef[] AlbumTrackArtists(YouTubeSong? song) => song == null ? []
        : song.ArtistRefs is { Length: > 0 } refs ? refs : song.Artists.Select(name => new ArtistRef(null, name)).ToArray();
    private static T? CachedPage<T>(Dictionary<string, (DateTime At, T Value)> cache, string id) where T : class
        => cache.TryGetValue(id, out var entry) && DateTime.UtcNow - entry.At < TimeSpan.FromMinutes(3) ? entry.Value : null;
    private static void RememberPage<T>(Dictionary<string, (DateTime At, T Value)> cache, string id, T value) where T : class
    {
        cache[id] = (DateTime.UtcNow, value);
        if (cache.Count > 12) cache.Remove(cache.MinBy(pair => pair.Value.At).Key);
    }
    private async Task PrepareLibraryRowsAsync(CancellationToken cancellation)
    {
        while (describedSongs == null || !ReferenceEquals(describedLibrary, Library) || !ReferenceEquals(describedStatistics, Statistics)) {
            var snapshot = Library; var statistics = Statistics;
            var local = snapshot.Tracks.ToArray(); var saved = snapshot.SavedSongs.ToArray();
            var rows = await Task.Run(() => BuildLibraryRows(local, saved, statistics, cancellation), cancellation);
            cancellation.ThrowIfCancellationRequested();
            if (!ReferenceEquals(snapshot, Library) || !ReferenceEquals(statistics, Statistics)) continue;
            describedLibrary = snapshot; describedStatistics = statistics; describedSongs = rows;
        }
    }
    private static SongRow[] BuildLibraryRows(TrackInfo[] local, SavedYouTubeSong[] saved, ListeningStats statistics, CancellationToken cancellation)
    {
        var rows = new List<SongRow>(local.Length + saved.Length);
        SongRow Stats(SongRow row, bool favorite, long added, string[] genres) {
            var value = statistics.ByTrack.GetValueOrDefault(row.Key);
            return row with { Favorite = favorite, AddedAt = added, Genres = genres, Plays = value?.Plays ?? 0, ListenedMs = value?.ListenedMs ?? 0 };
        }
        foreach (var track in local) {
            cancellation.ThrowIfCancellationRequested();
            rows.Add(Stats(new(new("local", track.Id), track.Title, track.Artist, track.Album, track.Duration, track.Artwork), track.Favorite, track.AddedAt, track.Genres ?? []));
        }
        foreach (var item in saved) {
            cancellation.ThrowIfCancellationRequested(); var song = item.Song; var audio = item.LocalAudio;
            rows.Add(Stats(new(new("youtube", Song: song), song.Title, string.Join(", ", song.Artists), song.Album ?? "YouTube Music", audio?.Duration ?? song.Duration ?? 0, audio != null ? audio.Artwork : song.Artwork), item.Favorite, item.AddedAt, song.Genres ?? []));
        }
        return rows.ToArray();
    }
}
