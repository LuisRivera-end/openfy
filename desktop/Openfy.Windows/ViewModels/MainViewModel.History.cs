namespace Openfy.Windows.ViewModels;

/// <summary>Opaque page routes for the main window's Back/Forward history (Openfy.Core.NavigationHistory).</summary>
public sealed partial class MainViewModel
{
    /// <summary>The page on screen as "page" or "page:id"; search pages carry the query.</summary>
    public string Route => page switch {
        "playlist" => "playlist:" + playlistId,
        "localalbum" => "localalbum:" + localAlbumId,
        "localartist" => "localartist:" + localArtistName,
        "artist" or "album" => page + ":" + catalogId,
        "search" or "localSearch" => "search:" + page + ":" + query,
        _ => page,
    };

    public Task NavigateRouteAsync(string route)
    {
        int split = route.IndexOf(':');
        string target = split < 0 ? route : route[..split], id = split < 0 ? "" : route[(split + 1)..];
        switch (target)
        {
            case "artist": return ArtistAsync(id);
            case "album": return AlbumAsync(id);
            case "localalbum": return NavigateLocalAlbumAsync(id);
            case "localartist": return NavigateLocalArtistAsync(id);
            case "playlist": return NavigateLocalAsync("playlist", id);
            case "most-played": return ShowMostPlayedAsync();
            case "search":
            {
                int kind = id.IndexOf(':');
                string searchPage = kind < 0 ? "search" : id[..kind], text = kind < 0 ? "" : id[(kind + 1)..];
                Query = text;
                if (searchPage == "localSearch") return NavigateLocalAsync("localSearch");
                if (text.Trim().Length < 2) { EmptySearch(); return Task.CompletedTask; }
                return SearchAsync();
            }
            default: return NavigateLocalAsync(target);
        }
    }
}
