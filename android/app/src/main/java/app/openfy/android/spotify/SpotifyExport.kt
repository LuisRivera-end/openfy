package app.openfy.android.spotify

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.text.Normalizer
import java.util.zip.ZipInputStream

@Serializable
internal data class SpotifyTrack(
    val title: String,
    val artists: List<String>,
    val album: String? = null,
    val uri: String? = null,
    val durationMs: Long? = null,
    val isrc: String? = null,
    val saved: Boolean = false
)

@Serializable
internal data class SpotifyPlaylist(val name: String, val tracks: List<Int>)

@Serializable
internal data class SpotifyLibrary(val tracks: List<SpotifyTrack>, val playlists: List<SpotifyPlaylist>)

internal enum class SpotifyExportError { UNSUPPORTED, TOO_LARGE }

internal class SpotifyExportException(val reason: SpotifyExportError) : IOException()

internal object SpotifyExport {
    private const val EntryLimit = 50 * 1024 * 1024
    private const val ArchiveLimit = 200 * 1024 * 1024
    private const val EntryCountLimit = 1024
    private val PlaylistFile = Regex("Playlist\\d*\\.json", RegexOption.IGNORE_CASE)
    private val TrackUri = Regex("spotify:track:[A-Za-z0-9]+")

    suspend fun read(context: Context, uri: Uri): SpotifyLibrary = withContext(Dispatchers.IO) {
        val coroutine = currentCoroutineContext()
        val input = context.contentResolver.openInputStream(uri) ?: throw IOException()
        input.use { read(it, coroutine::ensureActive) }
    }

    internal fun read(input: InputStream, checkCancelled: () -> Unit = {}): SpotifyLibrary {
        val result = ExportBuilder()
        val buffer = input.buffered()
        val budget = ReadBudget(checkCancelled)
        buffer.mark(4)
        val header = buffer.readNBytesCompat(4)
        buffer.reset()
        val zipSignature = header.size == 4 && header[0] == 0x50.toByte() && header[1] == 0x4b.toByte()
        if (zipSignature) {
            ZipInputStream(buffer).use { zip ->
                var entries = 0
                val discard = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    checkCancelled()
                    val entry = zip.nextEntry ?: break
                    if (++entries > EntryCountLimit || entry.size > EntryLimit) tooLarge()
                    val stream = budget.limitEntry(zip)
                    val name = entry.name.substringAfterLast('/').substringAfterLast('\\')
                    val libraryFile = name.equals("YourLibrary.json", ignoreCase = true)
                    val playlistFile = PlaylistFile.matches(name)
                    if (!entry.isDirectory && (libraryFile || playlistFile)) {
                        readJson(stream)?.let { result.add(it, libraryFile, playlistFile) }
                    }
                    // Count all expanded bytes, including ignored and malformed entries.
                    while (stream.read(discard) != -1) { }
                    zip.closeEntry()
                }
            }
        } else {
            val stream = budget.limitEntry(buffer)
            readJson(stream)?.let { result.add(it, libraryFile = true, playlistFile = true) }
            val discard = ByteArray(DEFAULT_BUFFER_SIZE)
            while (stream.read(discard) != -1) { }
        }
        return result.build()
    }

    @OptIn(ExperimentalSerializationApi::class)
    private fun readJson(stream: InputStream): JsonElement? {
        val buffer = BufferedInputStream(stream)
        buffer.mark(3)
        val header = buffer.readNBytesCompat(3)
        if (!header.contentEquals(byteArrayOf(0xef.toByte(), 0xbb.toByte(), 0xbf.toByte()))) buffer.reset()
        return try {
            Json.decodeFromStream<JsonElement>(buffer)
        } catch (_: SerializationException) {
            null
        }
    }

    private class ExportBuilder {
        private val tracks = mutableListOf<SpotifyTrack>()
        private val playlists = mutableListOf<SpotifyPlaylist>()
        private val byUri = mutableMapOf<String, Int>()
        private val byMetadata = mutableMapOf<Pair<String, List<String>>, Int>()
        private var recognized = false

        fun add(value: JsonElement, libraryFile: Boolean, playlistFile: Boolean) {
            val root = value as? JsonObject
            if (libraryFile && root != null) {
                (root["tracks"] as? JsonArray)?.let { list ->
                    recognized = true
                    list.forEach { value -> parseTrack(value as? JsonObject, saved = true)?.let(::addTrack) }
                }
            }
            if (playlistFile) {
                val list = root?.get("playlists") as? JsonArray ?: value as? JsonArray
                if (list != null) {
                    if (root != null || list.any { it is JsonObject && it["items"] is JsonArray }) recognized = true
                    list.forEach { addPlaylist(it as? JsonObject) }
                } else if (root?.get("items") is JsonArray && root.text("name") != null) {
                    recognized = true
                    addPlaylist(root)
                }
            }
        }

        private fun addPlaylist(value: JsonObject?) {
            if (value == null) return
            val name = value.text("name", "playlistName")?.take(100)?.trimEnd() ?: return
            val items = (value["items"] as? JsonArray).orEmpty()
            val refs = items.mapNotNull { entry ->
                val item = entry as? JsonObject ?: return@mapNotNull null
                if (item.isLocal() || item["episode"] is JsonObject || item["episode"].string() != null) return@mapNotNull null
                val track = item["track"] as? JsonObject
                    ?: item.takeIf { it.text("trackName", "track", "title") != null }
                parseTrack(track, saved = false)?.let(::addTrack)
            }.distinct()
            playlists.add(SpotifyPlaylist(name, refs))
        }

        private fun addTrack(track: SpotifyTrack): Int {
            val key = trackKey(track)
            val sameMetadata = byMetadata[key]?.takeIf { track.uri == null || tracks[it].uri == null }
            val index = track.uri?.let(byUri::get) ?: sameMetadata ?: tracks.size
            val previous = tracks.getOrNull(index)
            val combined = if (previous == null) track else previous.copy(
                artists = previous.artists.ifEmpty { track.artists },
                album = previous.album ?: track.album,
                uri = previous.uri ?: track.uri,
                durationMs = previous.durationMs ?: track.durationMs,
                isrc = previous.isrc ?: track.isrc,
                saved = previous.saved || track.saved
            )
            if (previous == null) tracks.add(combined) else tracks[index] = combined
            combined.uri?.let { byUri[it] = index }
            byMetadata.putIfAbsent(key, index)
            byMetadata.putIfAbsent(trackKey(combined), index)
            return index
        }

        fun build(): SpotifyLibrary {
            if (!recognized) throw SpotifyExportException(SpotifyExportError.UNSUPPORTED)
            return SpotifyLibrary(tracks, playlists)
        }
    }

    private fun parseTrack(value: JsonObject?, saved: Boolean): SpotifyTrack? {
        if (value == null || value.isLocal()) return null
        val title = value.text("trackName", "track", "title", "name")?.take(300)?.trimEnd() ?: return null
        val uri = value.text("trackUri", "uri")?.take(100)
        if (uri != null && uri.startsWith("spotify:") && !TrackUri.matches(uri)) return null
        val artists = (value["artists"] as? JsonArray)?.mapNotNull {
            (it as? JsonObject)?.text("name") ?: it.string()
        }.orEmpty().ifEmpty {
            listOfNotNull(value.text("artistName", "artist") ?: (value["artist"] as? JsonObject)?.text("name"))
        }.take(12).map { it.take(200).trimEnd() }
        return SpotifyTrack(
            title = title,
            artists = artists,
            album = (value.text("albumName", "album") ?: (value["album"] as? JsonObject)?.text("name"))?.take(300),
            uri = uri?.takeIf(TrackUri::matches),
            durationMs = ((value["durationMs"] ?: value["duration_ms"]) as? JsonPrimitive)?.longOrNull?.takeIf { it > 0 },
            isrc = (value.text("isrc") ?: (value["external_ids"] as? JsonObject)?.text("isrc"))?.take(32),
            saved = saved
        )
    }

    private fun JsonObject.isLocal(): Boolean =
        this["localTrack"] is JsonObject || this["localTrack"].string() != null ||
            listOf("localTrack", "isLocal", "is_local").any { (this[it] as? JsonPrimitive)?.booleanOrNull == true }

    private fun JsonObject.text(vararg names: String): String? = names.firstNotNullOfOrNull { this[it].string() }

    private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }
        ?.content?.trim()?.takeIf(String::isNotEmpty)

    private val Marks = Regex("\\p{M}+")
    private val Separators = Regex("[^\\p{L}\\p{N}]+")
    private fun key(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKD)
        .lowercase().replace(Marks, "").replace(Separators, "")
    private fun trackKey(track: SpotifyTrack) = key(track.title) to track.artists.map(::key)

    private class ReadBudget(private val checkCancelled: () -> Unit) {
        private var expanded = 0

        fun limitEntry(stream: InputStream): InputStream = object : FilterInputStream(stream) {
            private var count = 0

            override fun read(): Int {
                checkCancelled()
                return `in`.read().also { if (it >= 0) account(1) }
            }

            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                checkCancelled()
                return `in`.read(bytes, offset, length).also { if (it > 0) account(it) }
            }

            private fun account(bytes: Int) {
                count += bytes
                expanded += bytes
                if (count > EntryLimit || expanded > ArchiveLimit) tooLarge()
            }
        }
    }

    private fun InputStream.readNBytesCompat(length: Int): ByteArray {
        val bytes = ByteArray(length)
        var count = 0
        while (count < length) {
            val next = read(bytes, count, length - count)
            if (next < 0) break
            count += next
        }
        return bytes.copyOf(count)
    }

    private fun tooLarge(): Nothing = throw SpotifyExportException(SpotifyExportError.TOO_LARGE)
}
