using System.Net;
using Openfy.Core;

namespace Openfy.Windows.ViewModels;

public sealed partial class MainViewModel
{
    public sealed class SearchLoadState
    {
        public bool Started, Loading, Expired;
        public string Error = "";
    }
    private readonly Dictionary<string, SearchLoadState> searchLoads = new() { ["song"] = new(), ["artist"] = new(), ["album"] = new() };
    private string loadedSearchQuery = "";
    public int SearchRevision { get; private set; }
    public SearchLoadState SearchState(string kind) => searchLoads[kind];
    public bool SearchSettled => searchLoads.Values.All(state => state.Started && !state.Loading);
    public bool SearchHasMore(string kind) => kind switch { "song" => nextCursor != null, "artist" => artistCursor != null, _ => albumCursor != null };
    private void CancelSearchLoads() { foreach (var state in searchLoads.Values) state.Loading = false; }
    private void ResetSearchLoads()
    {
        SearchRevision++; loadedSearchQuery = ""; savedSearch = null;
        foreach (var state in searchLoads.Values) { state.Started = state.Loading = state.Expired = false; state.Error = ""; }
    }
    public async Task SearchAsync(bool more = false, bool moreArtists = false, bool moreAlbums = false)
    {
        if (Query.Trim().Length is < 2 or > 200) return;
        if (more || moreArtists || moreAlbums) { await LoadSearchSectionAsync(moreArtists ? "artist" : moreAlbums ? "album" : "song"); return; }
        if (loadedSearchQuery != Query.Trim() || page != "search")
        {
            BeginContentNavigation("search", false); ResetSearchLoads(); loadedSearchQuery = Query.Trim();
            UseRemoteSongs(); Songs.Clear(); Artists.Clear(); Albums.Clear(); Singles.Clear(); SimilarArtists.Clear();
            nextCursor = artistCursor = albumCursor = null;
            Description = ""; CatalogArtwork = null; CatalogSubtitle = ""; CatalogKind = ""; Heading = "Buscar música";
        }
        await Task.WhenAll(searchLoads.Where(pair => !pair.Value.Started && !pair.Value.Loading).Select(pair => LoadSearchSectionAsync(pair.Key)).ToArray());
    }
    public async Task LoadSearchSectionAsync(string kind, bool refresh = false)
    {
        var state = searchLoads[kind];
        if (page != "search" || Query.Trim().Length < 2 || state.Loading || (!refresh && state.Started && !SearchHasMore(kind))) return;
        int own = contentGeneration;
        var cancellation = searchCancellation?.Token ?? CancellationToken.None;
        string? cursor = refresh ? null : kind switch { "song" => nextCursor, "artist" => artistCursor, _ => albumCursor };
        state.Loading = true; state.Error = "";
        UpdateSearchLoading(); ContentChanged?.Invoke();
        try
        {
            string path = "api/music/search?q=" + Uri.EscapeDataString(Query.Trim()) + (kind == "song" ? "" : "&type=" + kind) + (cursor == null ? "" : "&cursor=" + Uri.EscapeDataString(cursor));
            if (kind == "song") {
                var result = await Api.GetAsync<SongPage>(path, cancellation); if (own != contentGeneration) return;
                if (cursor == null) Songs.Clear();
                foreach (var song in result.Songs) if (!Songs.Any(row => row.Key == "youtube:" + song.VideoId)) Songs.Add(Describe(new("youtube", Song: song)));
                nextCursor = result.NextCursor;
            } else if (kind == "artist") {
                var result = await Api.GetAsync<ArtistPage>(path, cancellation); if (own != contentGeneration) return;
                if (cursor == null) Artists.Clear();
                foreach (var artist in result.Artists) if (!Artists.Any(item => item.Id == artist.Id)) Artists.Add(artist);
                artistCursor = result.NextCursor;
            } else {
                var result = await Api.GetAsync<AlbumSearchPage>(path, cancellation); if (own != contentGeneration) return;
                if (cursor == null) Albums.Clear();
                foreach (var album in result.Albums) if (!Albums.Any(item => item.Id == album.Id)) Albums.Add(album);
                albumCursor = result.NextCursor;
            }
            state.Started = true; state.Expired = false;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception failure) { if (own == contentGeneration) { state.Error = failure.Message; state.Expired = failure is HttpRequestException { StatusCode: HttpStatusCode.Gone }; state.Started = true; } }
        finally { if (own == contentGeneration) { state.Loading = false; UpdateSearchLoading(); ContentChanged?.Invoke(); } }
    }
    private void UpdateSearchLoading()
    {
        SearchSongsLoading = searchLoads["song"].Loading; SearchArtistsLoading = searchLoads["artist"].Loading; SearchAlbumsLoading = searchLoads["album"].Loading;
        Busy = SearchSongsLoading || SearchArtistsLoading || SearchAlbumsLoading;
    }
}
