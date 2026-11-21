using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Openfy.Core;
using Openfy.Windows.Audio;
using Openfy.Windows.Services;

namespace Openfy.Windows.ViewModels;

public record SongRow(PlaybackEntry Entry, string Title, string Artist, string Album, double Duration, string? Artwork)
{
    public string[] Genres { get; init; } = [];
    public string Genre => Genres.Length > 0 ? string.Join(", ", Genres) : "Sin género";
    public bool Favorite { get; init; }
    public int Plays { get; init; }
    public long ListenedMs { get; init; }
    public string Minutes => (ListenedMs / 60000d).ToString("N1");
    public long AddedAt { get; init; }
    public string Length => TimeSpan.FromSeconds(Math.Max(0, Duration)).ToString(@"m\:ss");
    public string Key => Entry.Key;
    public override string ToString() => Title + " · " + Artist;
}

public sealed partial class MainViewModel : INotifyPropertyChanged, IAsyncDisposable
{
    private const int RepeatShuffleRecoveryMatches = 5;
    public BackendClient Api { get; private set; } = new();
    public BackendHost Host { get; }
    private ArtworkService? artworkService;
    public ArtworkService Artwork => artworkService ??= new(Host);
    public AudioEngine Engine { get; }
    public AtomicStore Store { get; } = new(StateDirectory());
    public DesktopSettings Settings { get; private set; } = new();
    public Library Library { get; private set; } = new([], []);
    private Dictionary<string, TrackInfo> tracksById = new();
    private Dictionary<string, SavedYouTubeSong> savedById = new();
    private TrackInfo? FindTrack(string? id) => id != null ? tracksById.GetValueOrDefault(id) : null;
    private SavedYouTubeSong? FindSaved(string? id) => id != null ? savedById.GetValueOrDefault(id) : null;
    public bool IsDownloaded(PlaybackEntry entry) => entry.Source == "local" ? FindTrack(entry.TrackId) != null : FindSaved(entry.Song?.VideoId)?.LocalAudio != null;
    private Library? describedLibrary;
    private ListeningStats? describedStatistics;
    private SongRow[]? describedSongs;
    public IReadOnlyList<SongRow> LibrarySongs {
        get {
            if (describedSongs == null || !ReferenceEquals(describedLibrary, Library) || !ReferenceEquals(describedStatistics, Statistics)) {
                describedLibrary = Library; describedStatistics = Statistics;
                describedSongs = BuildLibraryRows(Library.Tracks.ToArray(), Library.SavedSongs.ToArray(), Statistics, default);
            }
            return describedSongs;
        }
    }
    public ObservableCollection<SongRow> Queue { get; } = new BatchedObservableCollection<SongRow>();
    public ObservableCollection<SongRow> Upcoming { get; } = new BatchedObservableCollection<SongRow>();
    public int CurrentIndex => index;
    public event Action? QueueChanged;
    private void RefreshQueue() { Replace(Upcoming, Queue.Skip(index + 1)); QueueChanged?.Invoke(); }
    public ObservableCollection<SongRow> Songs { get; private set; } = new BatchedObservableCollection<SongRow>();
    public ObservableCollection<YouTubeArtist> Artists { get; } = [];
    public ObservableCollection<YouTubeAlbum> Albums { get; } = [];
    public ObservableCollection<YouTubeAlbum> Singles { get; } = [];
    public ObservableCollection<YouTubeArtist> SimilarArtists { get; } = [];
    private readonly Action<Action> ui;
    private Task? refreshTask;
    private bool refreshPending;
    private readonly List<PlaybackEntry> originalQueue = [];
    private SongRow[]? nextShuffleRound;
    private int index, selectionGeneration, lyricsGeneration;
    private string repeat = "off", heading = "Tu música, a tu manera.", status = "Iniciando Openfy…", error = "", title = "Tu música, contigo", artist = "Elige una canción para empezar", album = "", cover = "", query = "", page = "home";
    private bool shuffle, busy, initialized;
    private double position, duration, volume = .75;
    private LyricsResult? lyrics;
    private string? nextCursor, artistCursor, albumCursor, releaseCursor, singlesCursor, catalogId;
    private string? playlistId;
    private string? localAlbumId, localArtistName;
    private string libraryFilter = "";
    private DateTime lastSave = DateTime.MinValue;
    private string? engineKey;
    private bool engineRemote;
    private string? artworkIdentity;
    private int contentGeneration;
    private CancellationTokenSource? searchCancellation;
    private bool artistSongsStarted;
    private bool albumsStarted, singlesStarted;
    private SearchSnapshot? savedSearch;
    private record SearchSnapshot(string Query, SongRow[] Songs, YouTubeArtist[] Artists, YouTubeAlbum[] Albums, string? Cursor, string? ArtistCursor, string? AlbumCursor);
    public SongRow? Current => index >= 0 && index < Queue.Count ? Queue[index] : null;
    public string Heading { get => heading; private set { heading = value; Notify(); } }
    public string Description { get; private set; } = "";
    public string? CatalogArtwork { get; private set; }
    /** Wide artist header image; null when the provider only has a portrait. */
    public string? CatalogBanner { get; private set; }
    public string CatalogSubtitle { get; private set; } = "";
    public string CatalogKind { get; private set; } = "";
    public string LibraryFilter => libraryFilter;
    public bool MoreArtistsAvailable => artistCursor != null;
    public bool MoreSongsAvailable => page == "search" ? nextCursor != null : page == "artist" && (!artistSongsStarted || nextCursor != null);
    public bool MoreAlbumsAvailable => page == "search" ? albumCursor != null : !albumsStarted || releaseCursor != null;
    public bool MoreSinglesAvailable => !singlesStarted || singlesCursor != null;
    public Playlist? CurrentPlaylist => page == "playlist" ? Library.Playlists.Find(list => list.Id == playlistId) : null;
    public string Status { get => status; private set { status = value; Notify(); } }
    public string Error { get => error; private set { error = value; Notify(); } }
    public string Title { get => title; private set { title = value; Notify(); } }
    public string Artist { get => artist; private set { artist = value; Notify(); } }
    public string Album { get => album; private set { album = value; Notify(); } }
    public string Cover { get => cover; private set { cover = value; Notify(); } }
    public string Query { get => query; set { query = value; Notify(); } }
    public string Page => page;
    public bool Busy { get => busy; private set { busy = value; Notify(); } }
    public bool Playing => Engine.Playing;
    public string PlayLabel => Playing ? "Pausar" : "Reproducir";
    public bool ShuffleEnabled => shuffle;
    public string RepeatMode => repeat;
    public SongRow? NextAutomatic {
        get {
            if (Immersive.NextIndex(Queue.Count, index, repeat) is not int next) return null;
            var entry = (StartsNewShuffleRound(next) ? NextShuffleRound()[0] : Queue[next]).Entry;
            return entry.Source == "youtube" || FindTrack(entry.TrackId) != null ? Describe(entry) : null;
        }
    }
    public int SelectionGeneration => selectionGeneration;
    public double Position { get => position; private set { if (position == value) return; position = value; Notify(); Notify(nameof(PositionText)); } }
    public double Duration { get => duration; private set { if (duration == value) return; duration = value; Notify(); Notify(nameof(DurationText)); } }
    public double Volume { get => volume; set { volume = value; Engine.SetVolume(value); Notify(); } }
    public string PositionText => TimeSpan.FromSeconds(Math.Max(0, Position)).ToString(@"m\:ss");
    public string DurationText => TimeSpan.FromSeconds(Math.Max(0, Duration)).ToString(@"m\:ss");
    public LyricsResult? Lyrics { get => lyrics; private set { lyrics = value; Notify(); } }
    public bool LyricsVisible { get; set; }
    /// <summary>A lyrics request for the current song is in flight (Lyrics is null while loading and after a failure).</summary>
    public bool LyricsPending { get; private set; }
    /// <summary>Set while the mini or widget is visible; with Settings.CompactLyrics they show the sung line.</summary>
    public bool CompactLyricsVisible { get; set; }
    public bool WantsLyrics => LyricsVisible || CompactLyricsVisible && Settings.CompactLyrics;
    public string[] Palette { get; private set; } = ["#28483e", "#18212e", "#111113"];
    /// <summary>64×64 BGRA cover for the ambient shader; null falls back to <see cref="Palette"/>.</summary>
    public byte[]? AmbientPixels { get; private set; }
    /// <summary>True between a track change and its artwork arriving; renderers keep the previous cover meanwhile.</summary>
    public bool ArtworkPending { get; private set; }
    public Func<string[]> RenderDiagnostics { get; set; } = () => [];
    public event PropertyChangedEventHandler? PropertyChanged;
    public event Action? ContentChanged;
    public event Action? SearchLeaving;
    public event Action? ArtworkChanged;
    public event Action? LyricsChanged;
    public MainViewModel(Action<Action> dispatch)
    {
        Queue.CollectionChanged += (_, _) => { nextShuffleRound = null; queueRevision++; };
        ui = dispatch; Host = new(Api); Engine = new(Api); Listening = new(Api, Store);
        Host.Status += value => ui(() => Status = value);
        Host.Event += (type, payload) => {
            if (type == "tracksChanged") ui(() => {
                if (refreshTask is { IsCompleted: false }) refreshPending = true;
                foreach (var track in payload.GetProperty("tracks").Deserialize<TrackInfo[]>(Contracts.Json) ?? []) {
                    int at = Library.Tracks.FindIndex(old => old.Id == track.Id);
                    if (at < 0) Library.Tracks.Insert(0, track); else Library.Tracks[at] = track;
                    tracksById[track.Id] = track;
                }
                Library = Library with { };
                describedSongs = null;
                if (IsLocalPage && !ContentLoading) ShowLocal(page);
                Notify(nameof(Library));
            });
            if (type == "libraryChanged") ui(() => _ = RunAsync(RefreshAsync));
            if (type == "lyricsChanged") ui(() => { if (WantsLyrics && Current?.Key == payload.GetProperty("key").GetString()) _ = RunAsync(() => LoadLyricsAsync()); });
            if (type == "telemetryChanged") ui(QueueTelemetryRefresh);
            if (type == "importProgress") ui(() => Status = "Importando: " + payload.GetProperty("filename").GetString());
            if (type == "conversionProgress") ui(() => Status = "Preparando audio para iPhone: " + payload.GetProperty("progress").GetInt32() + "%");
            if (type == "downloadProgress") ui(() => OnDownloadProgress(payload));
        };
        Host.Reconnected += () => ui(() => { if (initialized) _ = RunAsync(async () => { await RefreshAsync(); await ActivityAsync(); await Listening.FlushAsync(); await RefreshListeningAsync(); }); });
        Engine.PresenceChanged += snapshot => ui(() => OnAudioPresence(snapshot));
        Engine.Changed += () => ui(() => { SampleListening(); if (!Engine.Playing) _ = Listening.CheckpointAsync(); Notify(nameof(Playing)); Notify(nameof(PlayLabel)); _ = ActivityAsync(); });
    }
    private readonly Dictionary<string, Task> startupStages = new();
    private async Task StartupStageAsync(string name, Func<Task> action, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (startupStages.TryGetValue(name, out var previous) && (previous.IsCanceled || previous.IsFaulted)) startupStages.Remove(name);
        if (!startupStages.TryGetValue(name, out var task)) startupStages[name] = task = action();
        try { await task.WaitAsync(cancellation); }
        catch { if (task.IsCompleted) startupStages.Remove(name); throw; }
        cancellation.ThrowIfCancellationRequested();
    }
    public async Task InitializeAsync(CancellationToken cancellation = default)
    {
        await PrepareStartupSettingsAsync(cancellation);
        await StartupStageAsync("listening", Listening.InitializeAsync, cancellation);
        await Host.StartAsync(cancellation);
        await StartupStageAsync("library", () => RefreshAsync(cancellation), cancellation);
        await StartupStageAsync("playback", async () => {
            var saved = await Store.ReadAsync<JsonElement>("playback", cancellation);
            if (saved.ValueKind == JsonValueKind.Object) await RestoreSnapshotAsync(saved);
        }, cancellation);
        initialized = true;
    }
    public Task PrepareStartupSettingsAsync(CancellationToken cancellation) => StartupStageAsync("settings", async () => Settings = await Store.ReadAsync<DesktopSettings>("settings", cancellation) ?? new(), cancellation);
    public async Task PrepareStartupContentAsync(CancellationToken cancellation)
    {
        var statistics = await Store.ReadAsync<ListeningStats>("listening-stats", cancellation);
        Statistics = statistics ?? Statistics;
        var recent = await Store.ReadAsync<RecentListening>("listening-recent-v2", cancellation);
        RecentListening = recent ?? RecentListening;
        var discovery = await Store.ReadAsync<Recommendations>("listening-discovery-v2", cancellation);
        if (discovery?.AlgorithmVersion == Openfy.Core.Recommendations.CurrentAlgorithm) Recommendations = discovery;
        if (IsLocalPage) ShowLocal(page);
        var history = RefreshListeningAsync(cancellation);
        var suggestions = LoadRecommendationsAsync(cancellation: cancellation);
        await Task.WhenAll(recent == null || statistics == null ? history : Task.CompletedTask, discovery?.AlgorithmVersion == Openfy.Core.Recommendations.CurrentAlgorithm ? Task.CompletedTask : suggestions);
    }
    private int operations;
    public int Operations => Volatile.Read(ref operations);
    public string ActivityId => ClientId;
    public DesktopUpdates? Updates { get; set; }
    public async Task RunAsync(Func<Task> action)
    {
        Interlocked.Increment(ref operations);
        try { Error = ""; await action(); }
        catch (Exception failure) { SessionLog.Write("app.operation", "failed", error: failure); Error = failure.Message; }
        finally { Interlocked.Decrement(ref operations); }
    }
    public Task RefreshAsync() => RefreshAsync(CancellationToken.None);
    private Task RefreshAsync(CancellationToken cancellation)
    {
        if (refreshTask is { IsCompleted: false }) { refreshPending = true; return refreshTask; }
        return refreshTask = RefreshCoreAsync(cancellation);
    }
    private async Task RefreshCoreAsync(CancellationToken cancellation)
    {
        do
        {
            refreshPending = false;
            Library = await Api.GetAsync<Library>("api/library", cancellation);
            tracksById = Library.Tracks.ToDictionary(track => track.Id);
            savedById = Library.SavedSongs.ToDictionary(saved => saved.Song.VideoId);
            await RefreshDownloadsAsync(cancellation);
            if (engineRemote && Current is { } current && engineKey == current.Key && Library.AudioFor(current.Entry) != null) {
                SampleListening(); await Listening.CheckpointAsync();
                await LoadCurrentAsync(Playing, Engine.Position, true);
            }
            if (IsLocalPage && !ContentLoading) ShowLocal(page);
            else if (page == "album") ContentChanged?.Invoke();
            Notify(nameof(Library));
        } while (refreshPending);
    }
    public async Task RetryBackendAsync() { if (!initialized) await InitializeAsync(); else { await Host.StartAsync(); await RefreshAsync(); await ActivityAsync(); } }
    public SongRow Describe(PlaybackEntry entry)
    {
        if (entry.Source == "youtube") { var song = entry.Song!; var saved = FindSaved(song.VideoId); var audio = saved?.LocalAudio; return DecorateSong(new(entry, song.Title, string.Join(", ", song.Artists), song.Album ?? saved?.Song.Album ?? "YouTube Music", audio?.Duration ?? song.Duration ?? 0, audio != null ? audio.Artwork : song.Artwork)); }
        var track = FindTrack(entry.TrackId);
        return DecorateSong(track == null ? new(entry, "Archivo no disponible", "", "", 0, null) : new(entry, track.Title, track.Artist, track.Album, track.Duration, track.Artwork));
    }
    public void ShowLocal(string target, string? id = null)
    {
        ContentLoading = false; PageLoadError = "";
        SearchSongsLoading = SearchArtistsLoading = SearchAlbumsLoading = false;
        SaveSearch();
        // Filtering and library refreshes keep the same album presentation in flight.
        if (page != "localalbum" || target != "localalbum" || LocalNavigationKey(target, id) != filterViewKey)
        {
            EndAlbumPresentation();
            contentGeneration++; searchCancellation?.Cancel(); CancelSearchLoads();
        }
        ShowLocalCore(target, id);
    }
    private void ShowLocalCore(string target, string? id)
    {
        string key = LocalNavigationKey(target, id);
        bool sameAlbum = target == "localalbum" && page == target && key == filterViewKey && albumPresentationCancellation != null;
        Description = sameAlbum ? CatalogAlbumDescription?.Text ?? "" : "";
        if (filterViewKey != key) {
            filterViewKey = key;
            var previousFilters = Settings.LibraryFilters.GetValueOrDefault(key);
            Filters = previousFilters ?? new();
            if (target is "library" or "favorites" or "playlist" or "localalbum" or "localartist" or "localSearch") Filters = Filters.ForCollection();
            Settings.LibraryFilters[key] = Filters; libraryFilter = Filters.Query;
            if (previousFilters != null && previousFilters != Filters) _ = PersistAsync();
        }
        page = target; if (id != null) playlistId = id;
        Busy = false; Artists.Clear(); Albums.Clear(); Singles.Clear(); nextCursor = artistCursor = null;
        IEnumerable<TrackInfo> tracks = Library.Tracks;
        Heading = target switch { "home" => "Tu música, a tu manera.", "downloads" => "Descargas", "settings" => "Ajustes", "favorites" => "Tus favoritas", "localSearch" => "Encuentra tu próxima canción", "playlist" => Library.Playlists.Find(item => item.Id == playlistId)?.Name ?? "Playlist", "localalbum" => Library.Tracks.Find(track => track.AlbumId == localAlbumId)?.Album ?? Library.SavedSongs.FirstOrDefault(saved => SavedAlbumKey(saved.Song) == localAlbumId)?.Song.Album ?? "Álbum no disponible", "localartist" => localArtistName ?? "Artista no disponible", _ => "Tu biblioteca" };
        if (target == "favorites") tracks = tracks.Where(track => track.Favorite);
        if (target == "localalbum") tracks = tracks.Where(track => track.AlbumId == localAlbumId).OrderBy(track => track.Disc).ThenBy(track => track.TrackNumber);
        if (target == "localartist") tracks = tracks.Where(track => track.Artist == localArtistName);
        IEnumerable<SongRow> rows = target switch {
            "home" or "downloads" or "settings" => [],
            "favorites" => LibrarySongs.Where(row => row.Favorite),
            "library" or "localSearch" => LibrarySongs,
            _ => tracks.Select(track => Describe(new("local", track.Id)))
        };
        if (target is "localalbum" or "localartist")
            rows = rows.Concat(Library.SavedSongs.Where(saved => (target != "favorites" || saved.Favorite) && (target != "localartist" || string.Join(", ", saved.Song.Artists) == localArtistName) && (target != "localalbum" || SavedAlbumKey(saved.Song) == localAlbumId)).Select(saved => Describe(new("youtube", Song: saved.Song))));
        if (target == "playlist") rows = (CurrentPlaylist?.TrackIds ?? []).Select(IndexedEntry).OfType<PlaybackEntry>().Select(Describe);
        if (target == "localalbum" && OfflineCollections.FirstOrDefault(item => "youtube:" + item.Id == localAlbumId) is { } cachedAlbum) rows = cachedAlbum.Entries.Select(Describe);
        var collection = rows.ToArray();
        UnfilteredSongs = collection;
        CatalogArtwork = target == "favorites" ? null : collection.FirstOrDefault(track => track.Artwork != null)?.Artwork;
        CatalogSubtitle = "";
        CatalogKind = target switch { "favorites" => "Hecha por ti", "playlist" => "Playlist personal", "localartist" => "Artista en tu biblioteca", _ => "" };
        if (target == "localalbum")
        {
            var first = tracks.FirstOrDefault();
            var saved = collection.FirstOrDefault()?.Entry.Song;
            var verified = saved?.AlbumId is { } albumId ? CachedPage(albumPages, albumId) : null;
            CatalogAlbumArtists = first != null
                ? [new(null, string.IsNullOrWhiteSpace(first.AlbumArtist) ? first.Artist : first.AlbumArtist)]
                : verified?.Artists is { Length: > 0 } credits ? credits : AlbumTrackArtists(saved);
            var years = tracks.Select(track => track.Year).Where(year => year is > 0).Distinct().Take(2).ToArray();
            CatalogAlbumYear = first != null ? years.Length == 1 ? years[0] : null : verified?.Year;
            CatalogSubtitle = string.Join(", ", CatalogAlbumArtists.Select(artist => artist.Name));
            if (!sameAlbum)
            {
                var request = first != null ? new AlbumPresentationRequest("local", TrackId: first.Id)
                    : YouTubeAlbumPresentation(saved?.AlbumId, CatalogAlbumArtists.Select(artist => artist.Name), Heading);
                BeginAlbumPresentation(key, request, verified?.Description);
                Description = CatalogAlbumDescription?.Text ?? "";
            }
        }
        string filter = target == "localSearch" ? Query : libraryFilter;
        rows = ApplyFilters(collection, Filters with { Query = filter });
        // Hidden pages keep the last collection's containers and rows ready for
        // returning to it; Home renders its own shelves from LibrarySongs.
        if (target is not ("home" or "downloads" or "settings")) { UseLocalSongs(key); Replace(Songs, rows); }
        Notify(nameof(Page)); Notify(nameof(LibraryFilter));
        ContentChanged?.Invoke();
    }
    private bool IsLocalPage => page is "home" or "settings" or "downloads" or "library" or "favorites" or "playlist" or "localSearch" or "localalbum" or "localartist";
    public void ShowLocalAlbum(string id) { if (localAlbumId != id) libraryFilter = ""; localAlbumId = id; ShowLocal("localalbum"); }
    public void ShowLocalArtist(string name) { if (localArtistName != name) libraryFilter = ""; localArtistName = name; ShowLocal("localartist"); }
    public void FilterLibrary(string value) { libraryFilter = value; Filters.Query = value; if (IsLocalPage) ShowLocal(page); _ = PersistAsync(); }
    public static bool MatchesFilter(string text, string filter)
    {
        if (string.IsNullOrWhiteSpace(filter)) return true;
        static string Normalize(string value) => string.Concat(value.Normalize(System.Text.NormalizationForm.FormD).Where(character => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(character) != System.Globalization.UnicodeCategory.NonSpacingMark));
        return Normalize(text).Contains(Normalize(filter.Trim()), StringComparison.CurrentCultureIgnoreCase);
    }
    public async Task ArtistAsync(string id)
    {
        SaveSearch();
        var cached = CachedPage(artistPages, id); catalogId = id;
        var cancellation = BeginContentNavigation("artist", cached == null); int own = contentGeneration;
        UseRemoteSongs(); Songs.Clear(); Artists.Clear(); Albums.Clear(); Singles.Clear();
        try
        {
            var profile = cached ?? await Api.GetAsync<ArtistProfile>("api/music/artists/" + Uri.EscapeDataString(id), cancellation);
            if (own != contentGeneration) return;
            if (cached == null) RememberPage(artistPages, id, profile);
            page = "artist"; catalogId = id; artistSongsStarted = albumsStarted = singlesStarted = false;
            nextCursor = releaseCursor = singlesCursor = null;
            Heading = profile.Name; Description = profile.Description ?? ""; CatalogArtwork = profile.Artwork; CatalogBanner = profile.Banner; CatalogSubtitle = "YouTube Music"; CatalogKind = "Artista"; Artists.Clear();
            Replace(SimilarArtists, profile.Similar ?? []);
            Replace(Songs, profile.TopSongs.Select(song => Describe(new("youtube", Song: song))));
            Replace(Albums, profile.Albums); Replace(Singles, profile.Singles);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception failure) { if (own == contentGeneration) PageLoadError = failure.Message; }
        finally { FinishContentNavigation(own); }
    }
    public async Task ArtistSongsAsync(bool reset = false)
    {
        if (catalogId == null) return;
        int own = contentGeneration;
        var result = await Api.GetAsync<SongPage>($"api/music/artists/{Uri.EscapeDataString(catalogId)}/songs" + (!reset && nextCursor != null ? "?cursor=" + Uri.EscapeDataString(nextCursor) : ""));
        if (own != contentGeneration || page != "artist") return;
        if (reset || !artistSongsStarted) Songs.Clear();
        artistSongsStarted = true;
        Replace(Songs, Songs.Concat(result.Songs.Select(song => Describe(new("youtube", Song: song)))).DistinctBy(row => row.Key));
        nextCursor = result.NextCursor; ContentChanged?.Invoke();
    }
    public async Task ReleasesAsync(bool singles = false)
    {
        if (catalogId == null) return;
        if (singles ? !MoreSinglesAvailable : !MoreAlbumsAvailable) return;
        int own = contentGeneration;
        var cursor = singles ? singlesCursor : releaseCursor;
        var result = await Api.GetAsync<ReleasePage>($"api/music/artists/{Uri.EscapeDataString(catalogId)}/releases?kind={(singles ? "singles" : "albums")}" + (cursor != null ? "&cursor=" + Uri.EscapeDataString(cursor) : ""));
        if (own != contentGeneration || page != "artist") return;
        var collection = singles ? Singles : Albums;
        if (cursor == null) collection.Clear();
        foreach (var item in result.Albums) if (!collection.Any(old => old.Id == item.Id)) collection.Add(item);
        if (singles) singlesCursor = result.NextCursor; else releaseCursor = result.NextCursor;
        if (singles) singlesStarted = true; else albumsStarted = true;
        ContentChanged?.Invoke();
    }
    public async Task AlbumAsync(string id)
    {
        SaveSearch();
        var offline = OfflineCollections.FirstOrDefault(target => target.Kind == "album" && target.Id == id);
        var remembered = CachedPage(albumPages, id); catalogId = id;
        var cancellation = BeginContentNavigation("album", offline == null && remembered == null); int own = contentGeneration;
        UseRemoteSongs(); Songs.Clear(); Artists.Clear(); Albums.Clear(); Singles.Clear();
        try
        {
            var album = offline != null ? new AlbumDetail(id, offline.Title, remembered?.Artists ?? [], offline.Artwork, remembered?.Year,
                offline.Entries.Where(entry => entry.Song != null).Select(entry => entry.Song!).ToArray(), remembered?.Description)
                : remembered ?? await Api.GetAsync<AlbumDetail>("api/music/albums/" + Uri.EscapeDataString(id), cancellation);
            if (own != contentGeneration) return;
            if (remembered == null && offline == null) RememberPage(albumPages, id, album);
            page = "album"; catalogId = id; Heading = album.Title; CatalogArtwork = album.Artwork; CatalogKind = ""; nextCursor = null;
            CatalogAlbumArtists = album.Artists.Length > 0 ? album.Artists : AlbumTrackArtists(album.Songs.FirstOrDefault());
            CatalogAlbumYear = album.Year;
            CatalogSubtitle = string.Join(", ", CatalogAlbumArtists.Select(artist => artist.Name));
            UnfilteredSongs = album.Songs.Select(song => Describe(new("youtube", Song: song))).ToArray();
            Replace(Songs, UnfilteredSongs);
            BeginAlbumPresentation("album:" + id, YouTubeAlbumPresentation(id, CatalogAlbumArtists.Select(artist => artist.Name), album.Title), album.Description);
            Description = CatalogAlbumDescription?.Text ?? "";
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception failure) { if (own == contentGeneration) PageLoadError = failure.Message; }
        finally { FinishContentNavigation(own); }
    }
    public async Task MoreAsync() { if (page == "search" && nextCursor != null) await SearchAsync(true); else if (page == "artist" && (!artistSongsStarted || nextCursor != null)) await ArtistSongsAsync(); }
    private void SaveSearch() { if (page == "search" && Songs.Count + Artists.Count + Albums.Count > 0) { SearchLeaving?.Invoke(); savedSearch = new(Query, Songs.ToArray(), Artists.ToArray(), Albums.ToArray(), nextCursor, artistCursor, albumCursor); } }
    public bool RestoreSearch()
    {
        if (savedSearch == null) return false;
        EndAlbumPresentation();
        UseRemoteSongs();
        ContentLoading = false; PageLoadError = ""; SearchSongsLoading = SearchArtistsLoading = SearchAlbumsLoading = false;
        contentGeneration++; searchCancellation?.Cancel(); searchCancellation?.Dispose(); searchCancellation = new(); CancelSearchLoads(); Busy = false; page = "search"; Heading = "Buscar música"; Description = ""; CatalogArtwork = null; CatalogSubtitle = ""; CatalogKind = ""; Query = savedSearch.Query;
        Replace(Songs, savedSearch.Songs); Replace(Artists, savedSearch.Artists); Replace(Albums, savedSearch.Albums); Singles.Clear(); SimilarArtists.Clear(); nextCursor = savedSearch.Cursor; artistCursor = savedSearch.ArtistCursor; albumCursor = savedSearch.AlbumCursor; ContentChanged?.Invoke(); return true;
    }
    public void EmptySearch()
    {
        EndAlbumPresentation();
        ResetSearchLoads();
        UseRemoteSongs();
        ContentLoading = false; PageLoadError = ""; SearchSongsLoading = SearchArtistsLoading = SearchAlbumsLoading = false;
        contentGeneration++; searchCancellation?.Cancel(); Busy = false; page = "search"; Heading = "Encuentra tu próxima canción"; Description = ""; CatalogArtwork = null; CatalogSubtitle = ""; CatalogKind = "";
        Songs.Clear(); Artists.Clear(); Albums.Clear(); Singles.Clear(); SimilarArtists.Clear(); nextCursor = artistCursor = albumCursor = null; ContentChanged?.Invoke();
    }
    public ListeningContext? PageContext => page switch {
        "favorites" => new("favorites"),
        "playlist" when playlistId != null => new("playlist", playlistId),
        "localalbum" when localAlbumId != null => new("album", localAlbumId, Heading, CatalogSubtitle, CatalogArtwork),
        "localartist" when localArtistName != null => new("artist", localArtistName, Heading, "Artista", CatalogArtwork),
        "album" when catalogId != null => new("album", "youtube:" + catalogId, Heading, CatalogSubtitle, CatalogArtwork),
        "artist" when catalogId != null => new("artist", "youtube:" + catalogId, Heading, "Artista", CatalogArtwork),
        _ => null,
    };
    public ListeningContext? ItemContext => page is "search" or "localSearch" or "artist" ? new("song") : PageContext;
    public Task PlayAsync(SongRow song, IEnumerable<SongRow>? collection = null, ListeningContext? context = null)
    {
        var rows = (collection ?? [song]).ToArray();
        return StartCollectionAsync(rows, Math.Max(0, Array.IndexOf(rows, song)), false, context);
    }
    public Task PlayCollectionAsync(IEnumerable<SongRow> collection, bool shuffled = false, ListeningContext? context = null) => StartCollectionAsync(collection.ToArray(), 0, shuffled, context);
    private async Task StartCollectionAsync(SongRow[] rows, int start, bool shuffled, ListeningContext? context)
    {
        if (rows.Length == 0) return;
        SampleListening(); await Listening.CheckpointAsync();
        Engine.Pause();
        index = start;
        Replace(Queue, rows.Select(row => row with { Entry = row.Entry with { QueueId = Guid.NewGuid().ToString(), Context = context } }));
        originalQueue.Clear(); originalQueue.AddRange(Queue.Select(item => item.Entry)); shuffle = shuffled;
        if (shuffled) Replace(Queue, CollectionQueue.Mix(Queue));
        Notify(nameof(ShuffleEnabled));
        Listening.Select(Current!.Entry);
        await LoadCurrentAsync(true, 0);
    }
    public void Enqueue(SongRow song) => Enqueue(song, ItemContext);
    public void Enqueue(SongRow song, ListeningContext? context) { var row = song with { Entry = song.Entry with { QueueId = Guid.NewGuid().ToString(), Context = context } }; Queue.Add(row); originalQueue.Add(row.Entry); RefreshQueue(); _ = PersistAsync(); }
    public async Task JumpAsync(int value) { if (value < 0 || value >= Queue.Count) return; SampleListening(); await Listening.CheckpointAsync(); index = value; Listening.Select(Current!.Entry); await LoadCurrentAsync(true, 0); }
    public void RemoveQueue(int value) { if (value < 0 || value >= Queue.Count || value == index) return; originalQueue.RemoveAll(entry => entry.QueueId == Queue[value].Entry.QueueId); Queue.RemoveAt(value); if (value < index) index--; RefreshQueue(); _ = PersistAsync(); }
    public async Task ToggleAsync()
    {
        if (Current == null) return;
        if (Engine.Duration == 0 || engineKey != Current.Key || !Engine.Playing && error.Length > 0 || Engine.CapturePresence().State == PlaybackPresenceState.Ended) await LoadCurrentAsync(true, Engine.CapturePresence().State == PlaybackPresenceState.Ended ? 0 : Position);
        else { presenceStarted = true; Engine.Toggle(); }
        await PersistAsync();
    }
    private async Task LoadCurrentAsync(bool autoplay, double restore, bool prepare = false)
    {
        Listening.Reset(restore);
        var row = Current; if (row == null) return;
        // A download may have completed since the queue was created.
        row = Describe(row.Entry); Queue[index] = row;
        int own = ++selectionGeneration;
        BeginDiscordSelection(row, own, autoplay);
        try {
        lyricsGeneration++;
        Error = ""; Title = row.Title; Artist = row.Artist; Album = row.Album; Duration = row.Duration; Position = restore;
        if (artworkIdentity != row.Artwork) { artworkIdentity = row.Artwork; Cover = ""; Palette = ["#28483e", "#18212e", "#111113"]; AmbientPixels = null; ArtworkPending = row.Artwork != null; ArtworkChanged?.Invoke(); }
        Lyrics = null; LyricsPending = WantsLyrics; LyricsChanged?.Invoke();
        if (row.Artwork != null) _ = PrepareArtworkAsync(row.Artwork, own);
        if (autoplay || prepare)
        {
            if (row.Entry.Source == "youtube") {
                var local = Library.AudioFor(row.Entry);
                engineRemote = local == null;
                if (local != null) {
                    try { var path = await Host.CallAsync<AssetPath>("resolveAsset", new { id = local.Asset.Id }); await Engine.OpenAsync(path.Path, false, restore, autoplay, own); }
                    catch (Exception failure) when (failure is IOException or System.Net.Http.HttpRequestException or InvalidOperationException) {
                        SessionLog.Write("audio.local", "failed", row.Key, error: failure);
                        throw new IOException("No se pudo abrir la copia descargada. Vuelve a descargar esta canción.", failure);
                    }
                }
                else await Engine.OpenAsync($"http://127.0.0.1:{Host.Port}/api/music/youtube/{row.Entry.Song!.VideoId}/stream", true, restore, autoplay, own);
            }
            else
            {
                engineRemote = false;
                var track = Library.Tracks.Find(track => track.Id == row.Entry.TrackId) ?? throw new IOException("La canción ya no está en la biblioteca.");
                var original = await Host.CallAsync<AssetPath>("resolveAsset", new { id = track.Original.Id });
                try { await Engine.OpenAsync(original.Path, false, restore, autoplay, own); }
                catch when (track.Mobile != null && track.Mobile.Id != track.Original.Id)
                {
                    var mobile = await Host.CallAsync<AssetPath>("resolveAsset", new { id = track.Mobile.Id });
                    await Engine.OpenAsync(mobile.Path, false, restore, autoplay, own);
                }
            }
            if (own != selectionGeneration) return;
            engineKey = row.Key;
            Duration = Engine.Duration;
            if (row.Entry.Source == "youtube" && row.Entry.Song is { } song)
            {
                var entry = row.Entry with { Song = song with { Duration = Duration } };
                for (int i = 0; i < Queue.Count; i++) if (Queue[i].Key == row.Key) Queue[i] = Describe(Queue[i].Entry with { Song = entry.Song });
                for (int i = 0; i < Songs.Count; i++) if (Songs[i].Key == row.Key) Songs[i] = Describe(Songs[i].Entry with { Song = entry.Song });
            }
        }
        else Engine.Pause();
        CompleteDiscordSelection(own);
        Notify(nameof(Current)); RefreshQueue();
        if (WantsLyrics) await LoadLyricsAsync();
        await PersistAsync();
        } catch { FailDiscordSelection(own); throw; }
    }
    private async Task PrepareArtworkAsync(string url, int own)
    {
        try
        {
            var artwork = await Artwork.GetAsync(url, 1024);
            byte[]? pixels = null;
            try { pixels = await Graphics.ArtworkPixels.LoadAsync(artwork.Path); } catch (Exception failure) { SessionLog.Write("artwork.ambient", "failed", error: failure); }
            if (own == selectionGeneration) { Cover = artwork.Path; Palette = artwork.Palette; AmbientPixels = pixels; ArtworkPending = false; ArtworkChanged?.Invoke(); }
        }
        catch { if (own == selectionGeneration && ArtworkPending) { ArtworkPending = false; ArtworkChanged?.Invoke(); } }
    }
    public async Task SeekAsync(double seconds)
    {
        SampleListening(); await Listening.CheckpointAsync();
        bool playing = Playing;
        if (Current == null) return;
        double target = Math.Clamp(seconds, 0, Duration);
        // Reopen on the decoder worker so network seeks never block the output thread.
        await LoadCurrentAsync(playing, target, true);
        Position = target; await PersistAsync();
    }
    public async Task AdvanceAsync(int direction, bool automatic = false, long? expectedGeneration = null)
    {
        SampleListening(); await Listening.CheckpointAsync();
        if (expectedGeneration.HasValue && expectedGeneration.Value != selectionGeneration) return;
        if (direction < 0 && Position > 3) { await SeekAsync(0); return; }
        int next = automatic ? Immersive.NextIndex(Queue.Count, index, repeat) ?? Queue.Count : index + direction;
        if (next >= Queue.Count) { if (repeat == "all") next = 0; else { Engine.Pause(); return; } }
        if (Queue.Count == 0) return;
        if ((automatic || direction > 0) && StartsNewShuffleRound(next)) Replace(Queue, NextShuffleRound());
        index = Math.Max(0, next); Listening.Select(Current!.Entry); await LoadCurrentAsync(true, 0);
    }
    private bool StartsNewShuffleRound(int next) => shuffle && repeat == "all" && Queue.Count > 1 && index == Queue.Count - 1 && next == 0;
    private SongRow[] NextShuffleRound()
    {
        if (nextShuffleRound != null) return nextShuffleRound;
        var mixed = CollectionQueue.Mix(Queue);
        if (mixed[0].Entry.QueueId == Current!.Entry.QueueId) {
            int other = Random.Shared.Next(1, mixed.Length);
            (mixed[0], mixed[other]) = (mixed[other], mixed[0]);
        }
        // Big Picture previews the same round that transport will start.
        return nextShuffleRound = mixed;
    }
    public void Shuffle()
    {
        if (Current == null) return;
        nextShuffleRound = null;
        if (!shuffle) {
            originalQueue.Clear(); originalQueue.AddRange(Queue.Select(row => row.Entry));
            MixUpcoming();
        } else {
            var ranks = originalQueue.Select((entry, i) => (entry.QueueId, i)).ToDictionary(pair => pair.QueueId!, pair => pair.i);
            var remaining = Queue.Skip(index + 1).OrderBy(row => ranks.GetValueOrDefault(row.Entry.QueueId!, int.MaxValue));
            Replace(Queue, Queue.Take(index + 1).Concat(remaining));
        }
        shuffle = !shuffle; Notify(nameof(ShuffleEnabled)); RefreshQueue(); _ = PersistAsync();
    }
    private void MixUpcoming() => Replace(Queue, Queue.Take(index + 1).Concat(CollectionQueue.Mix(Queue.Skip(index + 1))));
    public void ReorderUpcoming(IEnumerable<string> ids)
    {
        var remaining = Queue.Skip(index + 1).ToDictionary(row => row.Entry.QueueId!);
        var order = ids.Distinct().Where(remaining.ContainsKey).Select(id => remaining[id]).ToArray();
        if (order.Length != remaining.Count) return;
        Replace(Queue, Queue.Take(index + 1).Concat(order));
        if (!shuffle) { originalQueue.Clear(); originalQueue.AddRange(Queue.Select(row => row.Entry)); }
        RefreshQueue(); _ = PersistAsync();
    }
    public void MoveUpcoming(string id, int direction)
    {
        var ids = Upcoming.Select(row => row.Entry.QueueId!).ToList(); int from = ids.IndexOf(id), to = from + direction;
        if (from < 0 || to < 0 || to >= ids.Count) return;
        ids.RemoveAt(from); ids.Insert(to, id); ReorderUpcoming(ids);
    }
    public void CycleRepeat() { nextShuffleRound = null; repeat = repeat == "off" ? "all" : repeat == "all" ? "one" : "off"; Notify(nameof(RepeatMode)); Status = "Repetición: " + (repeat == "off" ? "desactivada" : repeat == "all" ? "toda la cola" : "una canción"); _ = PersistAsync(); }
    public async Task FavoriteAsync(SongRow song)
    {
        bool favorite = !Library.IsFavorite(song.Entry);
        if (song.Entry.Source == "youtube")
            await Api.SendAsync<SavedYouTubeSong>("api/music/saved", HttpMethod.Put, new { song = song.Entry.Song, favorite });
        else await Api.SendAsync<JsonElement>($"api/tracks/{song.Entry.TrackId}/favorite", HttpMethod.Put, new { favorite });
        await RefreshAsync();
    }
    public async Task CreatePlaylistAsync(string name) { await Api.SendAsync<Playlist>("api/playlists", HttpMethod.Post, new { name }); await RefreshAsync(); }
    public async Task AddToPlaylistAsync(SongRow song, Playlist list)
    {
        if (song.Entry.Source == "youtube") await Api.SendAsync<SavedYouTubeSong>("api/music/saved", HttpMethod.Put, new { song = song.Entry.Song });
        // A save can refresh the sidebar while this menu still holds an older playlist.
        list = Library.Playlists.Find(current => current.Id == list.Id) ?? list;
        await Api.SendAsync<Playlist>($"api/playlists/{list.Id}", HttpMethod.Put, new { list.Name, trackIds = list.TrackIds.Append(song.Key).Distinct(), list.Revision }); await RefreshAsync();
    }
    public async Task EditPlaylistAsync(Playlist list, string? name = null, string? remove = null)
    { await Api.SendAsync<Playlist>($"api/playlists/{list.Id}", HttpMethod.Put, new { name = name ?? list.Name, trackIds = list.TrackIds.Where(id => id != remove), list.Revision }); await RefreshAsync(); }
    public async Task DeletePlaylistAsync(Playlist list) { await Api.SendAsync<JsonElement>($"api/playlists/{list.Id}", HttpMethod.Delete); await RefreshAsync(); ShowLocal("library"); }
    /// <summary>Re-render the lyrics views after a display setting changes.</summary>
    public void RefreshLyricsViews() => LyricsChanged?.Invoke();
    public async Task LoadLyricsAsync(bool refresh = false)
    {
        var current = Current; if (current == null) return;
        int own = ++lyricsGeneration;
        LyricsPending = true;
        var cached = await Store.ReadAsync<LyricsResult>(AtomicStore.CacheKey(current.Key));
        var expected = new LyricsSignature(current.Title, current.Entry.Source == "youtube" ? current.Entry.Song!.Artists : current.Artist == "Artista desconocido" ? [] : [current.Artist],
            current.Album is "Sin álbum" or "YouTube Music" ? null : current.Album, Duration > 0 ? Duration : null);
        bool matches = cached != null && LyricsMatching.Same(cached.Signature, expected);
        try
        {
            var result = await Api.SendAsync<LyricsResult>("api/lyrics/resolve", HttpMethod.Post, new { entry = current.Entry, duration = Duration > 0 ? (double?)Duration : null, refresh });
            if (own != lyricsGeneration) return;
            Lyrics = result; await Store.WriteAsync(AtomicStore.CacheKey(current.Key), result);
        }
        catch { if (own == lyricsGeneration) { Lyrics = matches ? cached : null; if (!matches) Status = "La letra no está disponible. Puedes reintentar."; } }
        if (own == lyricsGeneration) { LyricsPending = false; LyricsChanged?.Invoke(); }
    }
    public void Tick()
    {
        SampleListening();
        if (initialized && DateTime.UtcNow - lastListeningSave > TimeSpan.FromSeconds(10)) { lastListeningSave = DateTime.UtcNow; _ = SaveListeningAsync(); }
        if (Engine.Playing && Engine.Duration > 0 && engineKey == Current?.Key) { Position = Engine.Position; Duration = Engine.Duration; }
        // The snapshot carries the whole queue; transport changes persist immediately, so the periodic checkpoint only keeps the position fresh.
        if (initialized && Playing && DateTime.UtcNow - lastSave > TimeSpan.FromSeconds(10)) { lastSave = DateTime.UtcNow; if (PlaybackSignature() != persistedSignature) _ = PersistAsync(); }
        if (initialized && Playing && DateTime.UtcNow - lastActivityBeat > TimeSpan.FromSeconds(30)) { lastActivityBeat = DateTime.UtcNow; _ = ActivityAsync(); }
    }
    private long queueRevision, persistedSignature = -1;
    private DateTime lastActivityBeat = DateTime.MinValue;
    private byte[]? persistedSettings;
    private long PlaybackSignature() => HashCode.Combine(queueRevision, Queue.Count, originalQueue.Count, index, Math.Round(Position, 1), repeat, shuffle, Volume);
    public async Task PersistAsync()
    {
        long signature = PlaybackSignature();
        await Store.WriteAsync("playback", new PlaybackSnapshot(3, Queue.Select(row => row.Entry).ToList(), index, Position, repeat, shuffle, Volume, originalQueue.Select(entry => entry.QueueId!).ToList()) {
            RepeatShuffleMigrated = shuffle && repeat == "all" && Queue.Count - index > RepeatShuffleRecoveryMatches,
        });
        persistedSignature = signature;
        // Settings rarely change: skip identical rewrites.
        var settings = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(Settings, Contracts.Json);
        if (persistedSettings != null && settings.AsSpan().SequenceEqual(persistedSettings)) return;
        await Store.WriteAsync("settings", Settings);
        persistedSettings = settings;
    }
    public async Task RestoreAsync(PlaybackSnapshot saved)
    {
        var seen = new HashSet<string>();
        var identified = saved.Queue.Select(entry => entry with { QueueId = entry.QueueId is { } id && seen.Add(id) ? id : Guid.NewGuid().ToString() }).ToArray();
        string? selected = identified.ElementAtOrDefault(saved.Index)?.QueueId;
        Replace(Queue, identified.Where(entry => entry.Source == "youtube" && entry.Song != null || Library.Tracks.Any(track => track.Id == entry.TrackId)).Select(Describe));
        index = Math.Max(0, Queue.ToList().FindIndex(row => row.Entry.QueueId == selected)); repeat = saved.Repeat; shuffle = saved.Shuffle; Volume = saved.Volume;
        var rank = (saved.OriginalOrder ?? []).Select((id, i) => (id, i)).DistinctBy(pair => pair.id).ToDictionary(pair => pair.id, pair => pair.i);
        originalQueue.Clear(); originalQueue.AddRange(Queue.OrderBy(row => rank.GetValueOrDefault(row.Entry.QueueId!, int.MaxValue)).Select(row => row.Entry));
        // Old builds wrapped into the original prefix. Require five pending matches before repairing it.
        int prefixLength = index + 1 + RepeatShuffleRecoveryMatches;
        if (shuffle && repeat == "all" && !saved.RepeatShuffleMigrated && saved.OriginalOrder != null && Queue.Count >= prefixLength
            && Queue.Take(prefixLength).Select(row => row.Entry.QueueId).SequenceEqual(originalQueue.Take(prefixLength).Select(entry => entry.QueueId)))
            MixUpcoming();
        Notify(nameof(ShuffleEnabled)); Notify(nameof(RepeatMode));
        RefreshQueue();
        if (Current != null) { Listening.Select(Current.Entry, true); await LoadCurrentAsync(false, saved.Position); }
    }
    public async Task ExportSessionAsync(string path)
    {
        await PersistAsync();
        var playback = await Store.ReadAsync<PlaybackSnapshot>("playback");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(new { version = 1, playback, preferences = new { effects = Settings.Effects } }, Contracts.Json));
    }
    public async Task ImportSessionAsync(string path)
    {
        var json = JsonSerializer.Deserialize<JsonElement>(await File.ReadAllTextAsync(path));
        if (json.TryGetProperty("preferences", out var preferences) && preferences.TryGetProperty("effects", out var effects)) Settings.Effects = effects.GetBoolean();
        var snapshot = json.TryGetProperty("playback", out var playback) ? playback : json;
        await RestoreSnapshotAsync(snapshot);
        await PersistAsync();
    }
    private async Task RestoreSnapshotAsync(JsonElement snapshot)
    {
        if (!snapshot.TryGetProperty("version", out _))
        {
            var legacy = snapshot.Deserialize<LegacySnapshot>(Contracts.Json)!;
            await RestoreAsync(new(2, legacy.Queue.Select(id => new PlaybackEntry("local", id)).ToList(), legacy.Index, legacy.Position, legacy.Repeat, legacy.Shuffle, legacy.Volume));
        }
        else await RestoreAsync(snapshot.Deserialize<PlaybackSnapshot>(Contracts.Json)!);
    }
    public async Task ActivityAsync(bool closed = false) { try { await Api.SendAsync<JsonElement>("api/activity", HttpMethod.Post, new { clientId = ClientId, playing = Playing, ready = !Playing && !Busy && Operations == 0, closed }); } catch { } }
    private string ClientId { get; } = Guid.NewGuid().ToString();
    public async Task ExportDiagnosticsAsync(string path) => await File.WriteAllTextAsync(path, JsonSerializer.Serialize(new { at = DateTimeOffset.UtcNow, backend = Host.Connected, Host.Port, Playing, Position, Duration, audio = "WASAPI", process = Environment.ProcessId, rendering = RenderDiagnostics() }, Contracts.Json));
    public async ValueTask DisposeAsync() {
        EndAlbumPresentation();
        await CloseDiscordAsync();
        SampleListening(); Engine.Pause();
        if (initialized) { await Listening.CheckpointAsync(); using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2)); await Listening.FlushAsync(deadline.Token); await PersistAsync(); await ActivityAsync(true); }
        await Engine.DisposeAsync(); await Host.DisposeAsync(); Api.Dispose();
    }
    private static void Replace<T>(ObservableCollection<T> target, IEnumerable<T> values)
    {
        var copied = values.ToArray();
        if (target.Count == 0 && copied.Length > 1 && target is BatchedObservableCollection<T> batch) { batch.ReplaceAll(copied); return; }
        if (typeof(T) == typeof(SongRow)) {
            if (target is BatchedObservableCollection<T> changing && target.Count > 0) {
                string Id(T item) { var row = (SongRow)(object)item!; return row.Entry.QueueId ?? row.Key; }
                int different = Math.Abs(target.Count - copied.Length);
                for (int i = 0; i < Math.Min(target.Count, copied.Length) && different <= 32; i++) if (Id(target[i]) != Id(copied[i])) different++;
                if (different > 32) { changing.ReplaceAll(copied); return; }
            }
            CollectionUpdates.Replace(target, copied, item => { var row = (SongRow)(object)item!; return row.Entry.QueueId ?? row.Key; },
                (left, right) => SameSongRow((SongRow)(object)left!, (SongRow)(object)right!));
            return;
        }
        for (int i = 0; i < copied.Length; i++) {
            if (i < target.Count && EqualityComparer<T>.Default.Equals(target[i], copied[i])) continue;
            int found = -1;
            for (int j = i + 1; j < target.Count; j++) if (EqualityComparer<T>.Default.Equals(target[j], copied[i])) { found = j; break; }
            if (found >= 0) target.Move(found, i);
            else target.Insert(i, copied[i]);
        }
        while (target.Count > copied.Length) target.RemoveAt(target.Count - 1);
    }
    private static bool SameSongRow(SongRow left, SongRow right)
    {
        if (ReferenceEquals(left, right)) return true;
        if (left.Key != right.Key || left.Entry.QueueId != right.Entry.QueueId || left.Entry.Context != right.Entry.Context
            || left.Title != right.Title || left.Artist != right.Artist || left.Album != right.Album || left.Duration != right.Duration
            || left.Artwork != right.Artwork || left.Favorite != right.Favorite || left.Plays != right.Plays
            || left.ListenedMs != right.ListenedMs || left.AddedAt != right.AddedAt || !left.Genres.SequenceEqual(right.Genres)) return false;
        return SameSong(left.Entry.Song, right.Entry.Song);
    }
    private static bool SameSong(YouTubeSong? a, YouTubeSong? b)
    {
        if (ReferenceEquals(a, b)) return true;
        if (a == null || b == null) return a == b;
        return a.VideoId == b.VideoId && a.Title == b.Title && a.Album == b.Album && a.AlbumId == b.AlbumId && a.Artwork == b.Artwork && a.Duration == b.Duration
            && a.Artists.SequenceEqual(b.Artists) && (a.ArtistRefs ?? []).SequenceEqual(b.ArtistRefs ?? []) && (a.Genres ?? []).SequenceEqual(b.Genres ?? []);
    }
    private void Notify([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new(name));
    private record LegacySnapshot(List<string> Queue, int Index, double Position, string Repeat, bool Shuffle, double Volume);
    public static string StateDirectory() { var args = Environment.GetCommandLineArgs(); int at = Array.IndexOf(args, "--state-dir"); return at >= 0 && at + 1 < args.Length ? Path.GetFullPath(args[at + 1]) : Environment.GetEnvironmentVariable("OPENFY_STATE_DIR") is { Length: > 0 } state ? Path.GetFullPath(state) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Openfy", "desktop"); }
}
