using Openfy.Core;

namespace Openfy.Windows.ViewModels;

public sealed partial class MainViewModel
{
    internal int LocalRowViewCount => localSongViews.Count;
    internal System.Collections.ObjectModel.ObservableCollection<SongRow>? CachedLocalRows(string target) => localSongViews.TryGetValue(LocalNavigationKey(target, null), out var entry) ? entry.Rows : null;
    internal BackendClient SwapCheckBackend(BackendClient replacement) { var original = Api; Api = replacement; return original; }
    internal void SeedNavigationCheck(int count, int? favoriteCount = null, bool varied = false)
    {
        var songs = Enumerable.Range(0, count).Select(i => new YouTubeSong($"perf{i:0000000}",
            $"Canción de una colección grande {i}", [varied ? $"Artista {i % 300}" : "Artista de prueba"], varied ? $"Álbum {i / 2}" : "Álbum de prueba", null, 180,
            AlbumId: varied ? "album-" + i / 2 : null)).ToArray();
        Library = new([], [new("performance-playlist", "Playlist grande", songs.Select(song => "youtube:" + song.VideoId).ToList(), 1, 1)],
            songs.Select((song, i) => new SavedYouTubeSong(song, i < (favoriteCount ?? count), count - i)).ToList());
        tracksById.Clear(); savedById = Library.SavedSongs.ToDictionary(saved => saved.Song.VideoId);
        Replace(Queue, songs.Select(song => Describe(new("youtube", Song: song, QueueId: "navigation-" + song.VideoId))));
        originalQueue.Clear(); originalQueue.AddRange(Queue.Select(row => row.Entry));
        Recommendations = Recommendations with { Songs = Enumerable.Range(0, 12).Select(i => songs[i] with { VideoId = $"disc{i:0000000}" }).ToArray() };
        Notify(nameof(Library));
    }
}
