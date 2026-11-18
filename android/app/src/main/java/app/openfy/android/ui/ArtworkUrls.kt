package app.openfy.android.ui

import java.net.URI
import kotlin.math.roundToInt

object ArtworkUrls {
    private val box = Regex("=w(\\d+)-h(\\d+)(?=-|$)")
    private val square = Regex("=s\\d+(?=-|$)")
    private val video = Regex("/vi(?:_webp)?/([A-Za-z0-9_-]{11})/([A-Za-z0-9_]+)\\.(?:jpg|webp)")

    /** Provider URL for a square rendition of about [px] pixels; local paths and unknown hosts are returned unchanged. */
    fun sized(source: String?, px: Int): String? {
        if (source == null) return null
        val url = httpsUri(source) ?: return source
        val size = when {
            px <= 128 -> 128
            px <= 256 -> 256
            px <= 512 -> 512
            else -> 1024
        }
        if (isGoogle(url)) return googleSquare(source, size)
        val thumbnail = videoThumbnail(url) ?: return source
        val name = when {
            size <= 256 -> "mqdefault"
            size <= 512 -> "hqdefault"
            else -> "maxresdefault"
        }
        return thumbnailUrl(thumbnail.groupValues[1], name)
    }

    /** Largest useful rendition (port of shared/utils/artwork.ts#largeArtworkUrl). */
    fun large(source: String): String {
        val url = httpsUri(source) ?: return source
        if (isGoogle(url)) {
            val dimensions = box.find(source)
            if (dimensions != null) {
                val width = dimensions.groupValues[1].toDouble()
                val height = dimensions.groupValues[2].toDouble()
                if (width > 0 && width >= 1.5 * height) {
                    return source.replaceRange(dimensions.range, "=w2048-h${(2048 * height / width).roundToInt()}")
                }
            }
            return googleSquare(source, 1024)
        }
        val thumbnail = videoThumbnail(url) ?: return source
        return thumbnailUrl(thumbnail.groupValues[1], "maxresdefault")
    }

    /** Next URL to try when [failed] could not be loaded (maxresdefault → hqdefault for ytimg), or null. */
    fun fallback(failed: String): String? {
        val thumbnail = httpsUri(failed)?.let(::videoThumbnail) ?: return null
        return if (thumbnail.groupValues[2] == "maxresdefault") thumbnailUrl(thumbnail.groupValues[1], "hqdefault") else null
    }

    /** Port of artworkIdentity: same identity regardless of size suffix. */
    fun identity(source: String): String = if (source.startsWith("https://")) {
        square.replaceFirst(box.replaceFirst(source, "=wSIZE-hSIZE"), "=sSIZE")
    } else source

    private fun httpsUri(source: String): URI? = if (source.startsWith("https://")) {
        runCatching { URI(source) }.getOrNull()
    } else null

    private fun googleSquare(source: String, size: Int): String =
        square.replaceFirst(box.replaceFirst(source, "=w$size-h$size"), "=s$size")

    private fun URI.isHost(domain: String): Boolean = host?.lowercase()?.let { it == domain || it.endsWith(".$domain") } == true
    private fun isGoogle(url: URI): Boolean = url.isHost("googleusercontent.com") || url.isHost("ggpht.com")
    private fun videoThumbnail(url: URI): MatchResult? = if (url.isHost("ytimg.com")) video.matchEntire(url.rawPath) else null
    private fun thumbnailUrl(id: String, name: String) = "https://i.ytimg.com/vi/$id/$name.jpg"
}
