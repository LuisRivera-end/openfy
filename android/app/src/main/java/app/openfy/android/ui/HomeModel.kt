package app.openfy.android.ui

import app.openfy.android.data.ListeningRow
import app.openfy.android.data.RecentContext
import app.openfy.android.data.Song
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import java.text.Normalizer
import java.time.ZoneId
import java.time.ZonedDateTime

private val homeZone = ZoneId.of("America/Mexico_City")
private val quickAccessKinds = setOf("playlist", "album", "artist")
internal val homeFavorites = RecentContext("favorites", "favorites", "Tus favoritas")

internal fun homeGreeting(now: ZonedDateTime = ZonedDateTime.now(homeZone)): String =
    when (now.withZoneSameInstant(homeZone).hour) {
        in 5..11 -> "Buenos días"
        in 12..19 -> "Buenas tardes"
        else -> "Buenas noches"
    }

internal fun homeYear() = ZonedDateTime.now(homeZone).year

internal val RecentContext.homeKey: String get() = "$kind:$id"

internal fun quickAccess(
    hasFavorites: Boolean,
    recents: List<RecentContext>,
    playlists: List<RecentContext>,
): List<RecentContext> = sequence {
    if (hasFavorites) yield(homeFavorites)
    yieldAll(recents.asSequence().filter { it.kind in quickAccessKinds })
    yieldAll(playlists)
}.distinctBy { it.homeKey }.take(8).toList().takeIf { it.size >= 2 }.orEmpty()

internal fun currentYearReleases(releases: List<JsonObject>, year: Int = homeYear()): List<JsonObject> =
    releases.asSequence()
        .filter { (it["year"] as? JsonPrimitive)?.intOrNull == year && it.homeAlbumId != null }
        .distinctBy { it.homeAlbumId }
        .take(12)
        .toList()

internal val JsonObject.homeAlbumId: String?
    get() = (this["id"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

internal fun recentHomeSongs(listening: List<ListeningRow>, songs: List<Song>): List<Song> {
    val songMap = songs.associateBy { it.id }
    return listening.asSequence()
        .sortedWith(compareByDescending<ListeningRow> { it.lastPlayedAt }.thenBy { it.songId })
        .distinctBy { it.songId }
        .mapNotNull { songMap[it.songId] }
        .take(12)
        .toList()
}

internal fun discoverySeeds(library: LibraryState): List<Song> {
    val songs = library.songs.filter { it.source == "youtube" }.associateBy { it.id }
    val artistIds = mutableSetOf<String>()
    val artistNames = mutableSetOf<String>()
    return library.listening.groupingBy { it.songId }
        .fold(0L) { total, row -> total + row.listenedMs }
        .asSequence()
        .filter { it.value > 0 }
        .sortedWith(compareByDescending<Map.Entry<String, Long>> { it.value }.thenBy { it.key })
        .mapNotNull { songs[it.key] }
        .filter { song ->
            val name = discoveryArtist(song.artist.substringBefore(','))
            val id = song.artistId.orEmpty()
            if ((name.isEmpty() && id.isEmpty()) || name in artistNames || id in artistIds) {
                false
            } else {
                if (name.isNotEmpty()) artistNames.add(name)
                if (id.isNotEmpty()) artistIds.add(id)
                true
            }
        }.take(3).toList()
}

private val marks = Regex("\\p{M}+")
private val nonWords = Regex("[^\\p{L}\\p{N}]+")
private val topic = Regex("\\s*-\\s*topic$")
private val artistsSeparator = Regex("[,;]\\s*")
private val titleQualifiers = Regex(
    "\\([^)]*\\)|\\[[^]]*]|\\b(?:feat|ft|featuring)\\b.*$|" +
        "\\b(?:official|oficial|audio|video|lyrics?|letra|visualizer|remaster(?:ed)?|version|single|deluxe|edition|anniversary|sped up|slowed|reverb|(?:19|20)\\d{2})\\b",
)

private fun discoveryText(value: String): String =
    Normalizer.normalize(value.trim(), Normalizer.Form.NFKD).lowercase().replace(marks, "")

private fun discoveryArtist(value: String): String = discoveryText(value).replace(topic, "").replace(nonWords, " ").trim()

internal fun discoverySongKeys(song: Song): List<String> {
    val title = discoveryText(song.title).replace(titleQualifiers, " ").replace(nonWords, " ").trim()
    if (title.isEmpty()) return emptyList()
    val artists = song.artist.split(artistsSeparator).map(::discoveryArtist).filter { it.isNotEmpty() }
    val idKey = song.artistId?.takeIf { it.isNotEmpty() }?.let { "id:$it" }
    return (artists + listOfNotNull(idKey)).map { "$it\u001f$title" }
}

internal fun <T, K> interleaveDiscovery(groups: List<List<T>>, key: (T) -> K): Sequence<T> = sequence {
    val size = groups.maxOfOrNull { it.size } ?: 0
    for (index in 0 until size) {
        for (group in groups) group.getOrNull(index)?.let { yield(it) }
    }
}.distinctBy(key)
