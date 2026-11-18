using System.Text.Json;
using Openfy.Core;
using Xunit;

namespace Openfy.Tests;

public class DownloadTests
{
    [Fact]
    public void DownloadedYouTubeRetainsPlaylistKeyFavoriteAndSource()
    {
        var song = new YouTubeSong("download001", "Canción", ["Openfy"], "Álbum", null, 10);
        var audio = new StoredYouTubeAudio(new("asset", "audio/mp4", 100, "hash", "original"), 10.5, "/api/artwork/cover.webp", ["#112233"], 1);
        var library = new Library([], [new("playlist", "Sin conexión", ["youtube:download001"], 7, 1)], [new(song, true, 1, audio)]);
        var restored = JsonSerializer.Deserialize<Library>(JsonSerializer.Serialize(library, Contracts.Json), Contracts.Json)!;
        var entry = restored.EntryForId(restored.Playlists[0].TrackIds[0])!;
        Assert.Equal("youtube:download001", entry.Key);
        Assert.Equal("youtube", entry.Source);
        Assert.True(restored.IsFavorite(entry));
        Assert.True(restored.IsDownloaded(entry));
        Assert.Equal("asset", restored.AudioFor(entry)!.Asset.Id);
        Assert.Equal(7, restored.Playlists[0].Revision);
        Assert.Empty(restored.Tracks);
    }

    [Fact]
    public void RemovingTheLocalAssociationKeepsTheSongPlayableByItsCatalogReference()
    {
        var song = new YouTubeSong("download001", "Canción", ["Openfy"], null, null, 10);
        var library = new Library([], [], [new(song, false, 1)]);
        var entry = library.EntryForId("youtube:download001")!;
        Assert.False(library.IsDownloaded(entry));
        Assert.Null(library.AudioFor(entry));
        Assert.Equal("youtube:download001", entry.Key);
    }
}
