package app.openfy.android.ui

import kotlinx.serialization.json.*

/**
 * Cards exist only for artist and album searches. A song search answers `{ songs }`, whose items carry
 * `videoId` and no `id`; treating them as cards crashed the search list on its `id` keys.
 */
fun searchCards(kind: String, result: JsonObject): List<JsonObject> =
    if(kind !in setOf("artists","albums")) emptyList()
    else (result[kind] as? JsonArray).orEmpty().mapNotNull { item ->
        (item as? JsonObject)?.takeIf { ((it["id"] as? JsonPrimitive)?.takeUnless { id -> id is JsonNull }?.contentOrNull) != null }
    }

sealed class FeaturedSearchResult {
    abstract val title: String
    abstract val subtitle: String
    abstract val artwork: String?
    abstract val themeKey: String
    abstract val isArtist: Boolean

    data class Artist(
        val id: String,
        val name: String,
        override val artwork: String?
    ) : FeaturedSearchResult() {
        override val title: String get() = name
        override val subtitle: String get() = "Artista"
        override val themeKey: String get() = "youtube:$id"
        override val isArtist: Boolean get() = true
    }

    data class Album(
        val id: String,
        override val title: String,
        val artist: String,
        override val artwork: String?
    ) : FeaturedSearchResult() {
        override val subtitle: String get() = if (artist.isNotBlank()) "Álbum · $artist" else "Álbum"
        override val themeKey: String get() = "youtube:album:$id"
        override val isArtist: Boolean get() = false
    }

    data class SongResult(
        val song: app.openfy.android.data.Song
    ) : FeaturedSearchResult() {
        override val title: String get() = song.title
        override val subtitle: String get() = if (song.artist.isNotBlank()) "Canción · ${song.artist}" else "Canción"
        override val artwork: String? get() = song.artwork
        override val themeKey: String get() = song.id
        override val isArtist: Boolean get() = false
    }
}
