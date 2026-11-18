using Openfy.Core;

namespace Openfy.Windows.ViewModels;

public sealed partial class MainViewModel
{
    public ListeningClient Listening { get; }
    public ListeningStats Statistics { get; private set; } = ListeningStats.Empty();
    public ListeningStats PeriodStatistics { get; private set; } = ListeningStats.Empty("30d");
    public MostPlayedPage Ranking { get; private set; } = new([], 0, 0, 50);
    public Recommendations Recommendations { get; private set; } = new([], 0, false, null);
    public RecentListening RecentListening { get; private set; } = new([]);
    public string ListeningPeriod { get; private set; } = "30d";
    public string RankingOrder { get; private set; } = "plays";
    public bool RecommendationsBusy { get; private set; }
    public bool IsDiscoverySong(YouTubeSong song) => !Library.SavedSongs.Any(saved => saved.Song.VideoId == song.VideoId)
        && Statistics.ByTrack.GetValueOrDefault("youtube:" + song.VideoId)?.ListenedMs is not > 0;
    public LibraryFilters Filters { get; private set; } = new();
    public SongRow[] UnfilteredSongs { get; private set; } = [];
    private DateTime lastListeningSave;
    private string filterViewKey = "";
    private Task? listeningRefreshTask;
    private DateTime lastRecommendationsAttempt;
    public static string SavedAlbumKey(YouTubeSong song) => "youtube:" + (song.AlbumId ?? string.Join(", ", song.Artists) + "\u001f" + (song.Album ?? "YouTube Music"));
    private SongRow DecorateSong(SongRow row)
    {
        var track = FindTrack(row.Entry.TrackId);
        var saved = FindSaved(row.Entry.Song?.VideoId);
        var stats = Statistics.ByTrack.GetValueOrDefault(row.Key);
        return row with { Genres = track?.Genres ?? (saved?.Song.Genres is { Length: > 0 } known ? known : row.Entry.Song?.Genres) ?? [], Favorite = track?.Favorite ?? saved?.Favorite ?? false, Plays = stats?.Plays ?? 0, ListenedMs = stats?.ListenedMs ?? 0, AddedAt = track?.AddedAt ?? saved?.AddedAt ?? 0 };
    }
    private void SampleListening()
    {
        if (engineKey != Current?.Key) return;
        Listening.Sample(Engine.Position, Engine.Duration, Engine.Playing && !Engine.Buffering);
    }
    private async Task SaveListeningAsync() { await Listening.CheckpointAsync(); await Listening.FlushAsync(); }
    public Task RefreshListeningAsync(CancellationToken cancellation = default)
    {
        if (listeningRefreshTask is { IsCompleted: false }) return listeningRefreshTask;
        return listeningRefreshTask = RefreshListeningCoreAsync(cancellation);
    }
    private async Task RefreshListeningCoreAsync(CancellationToken cancellation)
    {
        try
        {
            Statistics = await Api.GetAsync<ListeningStats>("api/telemetry/stats?period=all", cancellation);
            try {
                RecentListening = await Api.GetAsync<RecentListening>("api/telemetry/recent", cancellation);
                await Store.WriteAsync("listening-recent-v2", RecentListening);
            } catch { RecentListening = await Store.ReadAsync<RecentListening>("listening-recent-v2") ?? RecentListening; }
            cancellation.ThrowIfCancellationRequested();
            PeriodStatistics = await Api.GetAsync<ListeningStats>("api/telemetry/stats?period=" + ListeningPeriod, cancellation);
            if (page == "most-played") await LoadRankingAsync();
            await Store.WriteAsync("listening-stats", Statistics);
            cancellation.ThrowIfCancellationRequested();
            Notify(nameof(Statistics));
            if (page == "home" && Recommendations.Songs.Count(IsDiscoverySong) < 6 && (Statistics.ListenedMs > 0 || Library.SavedSongs.Any()) && DateTime.UtcNow - lastRecommendationsAttempt > TimeSpan.FromMinutes(1)) _ = LoadRecommendationsAsync(cancellation: cancellation);
            if (page is "home" or "most-played") ContentChanged?.Invoke();
            else if (IsLocalPage && !ContentLoading) ShowLocal(page);
        }
        catch when (!cancellation.IsCancellationRequested) { Statistics = await Store.ReadAsync<ListeningStats>("listening-stats") ?? Statistics; RecentListening = await Store.ReadAsync<RecentListening>("listening-recent-v2") ?? RecentListening; }
    }
    public async Task SetListeningPeriodAsync(string period) { ListeningPeriod = period; await RefreshListeningAsync(); }
    private Task? recommendationsTask;
    public Task LoadRecommendationsAsync(bool refresh = false, CancellationToken cancellation = default)
    {
        if (recommendationsTask is { IsCompleted: false }) return recommendationsTask;
        return recommendationsTask = LoadRecommendationsCoreAsync(refresh, cancellation);
    }
    private async Task LoadRecommendationsCoreAsync(bool refresh, CancellationToken cancellation)
    {
        if (RecommendationsBusy) return;
        RecommendationsBusy = true;
        lastRecommendationsAttempt = DateTime.UtcNow;
        try
        {
            var cached = await Store.ReadAsync<Recommendations>("listening-discovery-v2", cancellation);
            if (cached?.AlgorithmVersion == Openfy.Core.Recommendations.CurrentAlgorithm) Recommendations = cached;
            if (page == "home") ContentChanged?.Invoke();
            Recommendations = await Api.GetAsync<Recommendations>("api/music/recommendations" + (refresh ? "?refresh=true" : ""), cancellation);
            await Store.WriteAsync("listening-discovery-v2", Recommendations);
        }
        catch when (!cancellation.IsCancellationRequested) { Recommendations = Recommendations with { Stale = true, Error = "No se pudieron actualizar las recomendaciones. Vuelve a intentarlo." }; }
        finally { RecommendationsBusy = false; if (page == "home") ContentChanged?.Invoke(); }
    }
    public async Task ShowMostPlayedAsync()
    {
        filterViewKey = "most-played:"; Filters = Settings.LibraryFilters.GetValueOrDefault(filterViewKey) ?? new(); Settings.LibraryFilters[filterViewKey] = Filters;
        SaveSearch(); Heading = "Tus más reproducidas";
        var cancellation = BeginContentNavigation("most-played"); int own = contentGeneration;
        UseRemoteSongs(); Songs.Clear();
        try { await LoadRankingAsync(); }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception failure) { if (own == contentGeneration) PageLoadError = failure.Message; }
        finally { FinishContentNavigation(own); }
    }
    private int rankingGeneration;
    public async Task LoadRankingAsync(bool more = false)
    {
        int own = ++rankingGeneration, navigation = contentGeneration;
        string query = "api/telemetry/top?period=" + ListeningPeriod + "&sort=" + RankingOrder + "&limit=50&offset=" + (more ? Ranking.Items.Length : 0);
        if (page == "most-played") query += "&query=" + Uri.EscapeDataString(Filters.Query) + "&artist=" + Uri.EscapeDataString(Filters.Artist) + "&album=" + Uri.EscapeDataString(Filters.Album) + "&genre=" + Uri.EscapeDataString(Filters.Genre) + "&source=" + Filters.Source + "&favorite=" + Filters.Favorite.ToString().ToLowerInvariant();
        MostPlayedPage result;
        try { result = await Api.GetAsync<MostPlayedPage>(query, searchCancellation?.Token ?? default); }
        catch (OperationCanceledException) when (navigation != contentGeneration || page != "most-played") { return; }
        if (own != rankingGeneration || navigation != contentGeneration || page != "most-played") return;
        Ranking = more ? result with { Items = [.. Ranking.Items, .. result.Items] } : result;
        if (page == "most-played") {
            UnfilteredSongs = LibrarySongs.Concat(Ranking.Items.Select(item => Describe(item.Item.Entry))).DistinctBy(row => row.Key).ToArray();
            Replace(Songs, Ranking.Items.Select(item => Describe(item.Item.Entry) with { Plays = item.Plays, ListenedMs = item.ListenedMs }));
            if (!ContentLoading) ContentChanged?.Invoke();
        }
    }
    public async Task SortRankingAsync(string sort) { RankingOrder = sort; await LoadRankingAsync(); }
    public void UpdateFilters(Action<LibraryFilters> change)
    {
        change(Filters); libraryFilter = Filters.Query;
        if (page == "most-played") _ = RunAsync(() => LoadRankingAsync());
        else if (IsLocalPage) ShowLocal(page);
        _ = PersistAsync();
    }
    public void SortLibrary(string sort) => UpdateFilters(filter => { filter.Direction = filter.Sort == sort && filter.Direction == "asc" ? "desc" : filter.Sort == sort ? "asc" : sort is "plays" or "minutes" or "addedAt" ? "desc" : "asc"; filter.Sort = sort; });
    public void ResetFilters() => UpdateFilters(filter => { filter.Query = filter.Artist = filter.Album = filter.Genre = ""; filter.Source = "all"; filter.Favorite = false; filter.Downloaded = false; filter.Sort = "default"; filter.Direction = "asc"; });
    public IEnumerable<SongRow> ApplyFilters(IEnumerable<SongRow> rows, LibraryFilters filter)
    {
        var result = rows.Where(row => MatchesFilter(row.Title + " " + row.Artist + " " + row.Album, filter.Query)
            && (filter.Artist.Length == 0 || row.Artist == filter.Artist) && (filter.Album.Length == 0 || row.Album == filter.Album)
            && (filter.Genre.Length == 0 || (row.Genres.Length > 0 ? row.Genres : ["Sin género"]).Contains(filter.Genre))
            && (!filter.Favorite || row.Favorite) && (!filter.Downloaded || IsDownloaded(row.Entry)) && (filter.Source == "all" || row.Entry.Source == filter.Source));
        Func<SongRow, IComparable> value = filter.Sort switch {
            "title" => row => row.Title, "artist" => row => row.Artist, "album" => row => row.Album, "genre" => row => row.Genre,
            "favorite" => row => row.Favorite, "duration" => row => row.Duration, "plays" => row => row.Plays, "minutes" => row => row.ListenedMs, "addedAt" => row => row.AddedAt, _ => row => row.AddedAt,
        };
        if (filter.Sort == "default") return page is "library" or "favorites" ? result.OrderByDescending(row => row.AddedAt) : result;
        return (filter.Direction == "desc" ? result.OrderByDescending(value) : result.OrderBy(value)).ThenBy(row => row.Title).ThenBy(row => row.Key);
    }
}
