using System.Text.Json;
using System.Text.Json.Serialization;

namespace Openfy.Core;

public static class Contracts
{
    public const int Protocol = 1;
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = false };
}
public record Asset(string Id, string Mime, long Bytes, string Hash, string Variant);
public record TrackInfo(string Id, string Title, string Artist, string AlbumArtist, string Album, string AlbumId,
    double Duration, int TrackNumber, int Disc, int? Year, string Format, string? Artwork, string[] Palette,
    Asset Original, Asset? Mobile, string Conversion, string? ConversionError, int ConversionProgress, bool Favorite, long AddedAt, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? Genres = null);
public record Playlist(string Id, string Name, List<string> TrackIds, int Revision, long UpdatedAt);
public record StoredYouTubeAudio(Asset Asset, double Duration, string? Artwork, string[] Palette, long DownloadedAt);
public record SavedYouTubeSong(YouTubeSong Song, bool Favorite, long AddedAt, StoredYouTubeAudio? LocalAudio = null);
public record AudioDownloadJob(string Id, string VideoId, YouTubeSong Song, string State, long Bytes, long Total,
    int Attempts, string? Error, string? ErrorCode, bool Suppressed, long CreatedAt, long UpdatedAt);
public record OfflineCollection(string Key, string Kind, string Id, string Title, string? Artwork, List<PlaybackEntry> Entries, int? Revision, bool Enabled, long UpdatedAt);
public record Library(List<TrackInfo> Tracks, List<Playlist> Playlists, List<SavedYouTubeSong>? YouTubeSongs = null)
{
    [JsonIgnore] public IEnumerable<SavedYouTubeSong> SavedSongs => YouTubeSongs ?? [];
    public StoredYouTubeAudio? AudioFor(PlaybackEntry entry) => entry.Source == "youtube" ? SavedSongs.FirstOrDefault(saved => saved.Song.VideoId == entry.Song?.VideoId)?.LocalAudio : null;
    public bool IsDownloaded(PlaybackEntry entry) => entry.Source == "local" ? Tracks.Any(track => track.Id == entry.TrackId) : AudioFor(entry) != null;
    public PlaybackEntry? EntryForId(string id) => id.StartsWith("youtube:", StringComparison.Ordinal)
        ? SavedSongs.FirstOrDefault(saved => "youtube:" + saved.Song.VideoId == id) is { } saved ? new("youtube", Song: saved.Song) : null
        : Tracks.Any(track => track.Id == id) ? new("local", id) : null;
    public bool IsFavorite(PlaybackEntry entry) => entry.Source == "youtube"
        ? SavedSongs.Any(saved => saved.Song.VideoId == entry.Song?.VideoId && saved.Favorite)
        : Tracks.Any(track => track.Id == entry.TrackId && track.Favorite);
}
public record ArtistRef(string? Id, string Name);
public record YouTubeSong(string VideoId, string Title, string[] Artists, string? Album, string? Artwork,
    double? Duration, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ArtistRef[]? ArtistRefs = null, string? AlbumId = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? Genres = null);
public record YouTubeArtist(string Id, string Name, string? Artwork);
public record YouTubeAlbum(string Id, string Title, ArtistRef[] Artists, string? Artwork, int? Year);
public record ArtistProfile(string Id, string Name, string? Artwork, string? Description, YouTubeSong[] TopSongs,
    YouTubeAlbum[] Albums, YouTubeAlbum[] Singles, Dictionary<string, bool> Expandable, string? Banner = null, YouTubeArtist[]? Similar = null);
public record AlbumDetail(string Id, string Title, ArtistRef[] Artists, string? Artwork, int? Year, YouTubeSong[] Songs);
public record SongPage(YouTubeSong[] Songs, string? NextCursor);
public record ArtistPage(YouTubeArtist[] Artists, string? NextCursor);
public record ReleasePage(YouTubeAlbum[] Albums, string? NextCursor);
public record AlbumSearchPage(YouTubeAlbum[] Albums, string? NextCursor);
public record PlaybackEntry(string Source, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TrackId = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] YouTubeSong? Song = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? QueueId = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ListeningContext? Context = null)
{
    [JsonIgnore]
    public string Key => Source == "local" ? TrackId ?? "" : "youtube:" + Song?.VideoId;
}
public record PlaybackSnapshot(int Version, List<PlaybackEntry> Queue, int Index, double Position, string Repeat, bool Shuffle, double Volume, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] List<string>? OriginalOrder = null)
{
    public static PlaybackSnapshot Empty => new(2, [], 0, 0, "off", false, .75);
}
/// <summary>A timed fragment of a line; fragments concatenate to the line text (shared/types/lyrics.ts).</summary>
public record LyricsWord(double Time, string Text);
/// <summary>Words exist only when the source carries real per-word timing; End is the source's explicit end of the last word.</summary>
public record LyricsLine(double Time, string Text, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] LyricsWord[]? Words = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? End = null);
public record LyricsSignature(string Title, string[] Artists, string? Album, double? Duration);
public record LyricsResult(string Key, LyricsSignature Signature, string Status, string? Source,
    string? Attribution, string? SourceUrl, long FetchedAt, long ExpiresAt, string PlainText, LyricsLine[] Lines);
// Width and Height are physical pixels at Dpi; 0 marks placements saved before Dpi was recorded.
public record WindowPlacement(int X, int Y, int Width, int Height, string Monitor = "", int Dpi = 0);
public sealed class DesktopSettings
{
    public bool DiscordPresenceEnabled { get; set; } = true;
    public bool Effects { get; set; } = true;
    public bool Force24 { get; set; }
    public bool WidgetLocked { get; set; }
    public bool MiniVisible { get; set; }
    public bool WidgetVisible { get; set; }
    /// <summary>Mini and widget show the sung line of synchronized lyrics.</summary>
    public bool CompactLyrics { get; set; } = true;
    /// <summary>Fullscreen replaces the cover with the album's looping video when it has one.</summary>
    public bool MotionArt { get; set; } = true;
    public Dictionary<string, WindowPlacement> Windows { get; set; } = [];
    public Dictionary<string, LibraryFilters> LibraryFilters { get; set; } = [];
}
/// <summary>POST /api/motion/resolve: "ready", verified "none", or retryable "unmatched" (shared/types/music.ts).</summary>
public record MotionArtResult(string Status, string? Url = null, int Width = 0, int Height = 0, long RetryAfterMs = 0);
public record ArtworkResult(string Path, string[] Palette, int Width = 0, int Height = 0, string Key = "");
public record AssetPath(string Path);
public record BackendStatus(bool Online, bool ConversionPaused, string Version, string? DesktopInstance);
public record ImportJob(string Id, string Filename, string State, string? TrackId, string? Error, long CreatedAt);
public record AudioAnalysis(double Time, float Bass, float Mid, float High);
