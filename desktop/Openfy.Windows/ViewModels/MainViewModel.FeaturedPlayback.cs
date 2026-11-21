using Openfy.Core;

namespace Openfy.Windows.ViewModels;

public sealed partial class MainViewModel
{
    private int featuredPlaybackGeneration;

    public async Task PlayFeaturedArtistAsync(string id)
    {
        var own = ++featuredPlaybackGeneration;
        var navigation = contentGeneration;
        var selection = selectionGeneration;
        var cancellation = searchCancellation?.Token ?? CancellationToken.None;
        try {
            var profile = CachedPage(artistPages, id);
            if (profile == null) {
                profile = await Api.GetAsync<ArtistProfile>("api/music/artists/" + Uri.EscapeDataString(id), cancellation);
                RememberPage(artistPages, id, profile);
            }
            if (own != featuredPlaybackGeneration || navigation != contentGeneration || selection != selectionGeneration) return;
            var rows = profile.TopSongs.Select(song => Describe(new("youtube", Song: song)));
            await PlayCollectionAsync(rows, context: new("artist", "youtube:" + id, profile.Name, "Artista", profile.Artwork));
        } catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
    }

    public async Task PlayFeaturedAlbumAsync(string id)
    {
        var own = ++featuredPlaybackGeneration;
        var navigation = contentGeneration;
        var selection = selectionGeneration;
        var cancellation = searchCancellation?.Token ?? CancellationToken.None;
        var offline = OfflineCollections.FirstOrDefault(target => target.Kind == "album" && target.Id == id);
        if (offline != null) {
            await PlayCollectionAsync(offline.Entries.Select(Describe), context: new("album", "youtube:" + id, offline.Title, "YouTube Music", offline.Artwork));
            return;
        }
        try {
            var album = CachedPage(albumPages, id);
            if (album == null) {
                album = await Api.GetAsync<AlbumDetail>("api/music/albums/" + Uri.EscapeDataString(id), cancellation);
                RememberPage(albumPages, id, album);
            }
            if (own != featuredPlaybackGeneration || navigation != contentGeneration || selection != selectionGeneration) return;
            var rows = album.Songs.Select(song => Describe(new("youtube", Song: song)));
            var artists = string.Join(", ", album.Artists.Select(artist => artist.Name));
            await PlayCollectionAsync(rows, context: new("album", "youtube:" + id, album.Title, artists, album.Artwork));
        } catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
    }
}
