package app.openfy.android.ui

import android.content.Context
import androidx.palette.graphics.Palette
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.pow
import kotlin.math.roundToInt

object CoverPalette {
    private val colors = object : LinkedHashMap<String, Int>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Int>?): Boolean = size > 256
    }

    /** Dominant colour of the cover as ARGB, or null; cached by ArtworkUrls.identity. */
    suspend fun dominant(context: Context, source: String?): Int? {
        if (source.isNullOrBlank()) return null
        val key = ArtworkUrls.identity(source)
        synchronized(colors) { colors[key] }?.let { return it }
        val sized = ArtworkUrls.sized(source, 128) ?: return null
        val data = File(sized).takeIf { it.isAbsolute } ?: sized
        val request = ImageRequest.Builder(context).data(data).size(64).allowHardware(false).build()
        val image = (SingletonImageLoader.get(context).execute(request) as? SuccessResult)?.image ?: return null
        val color = withContext(Dispatchers.Default) {
            val palette = Palette.from(image.toBitmap()).generate()
            val dominant = palette.dominantSwatch
            (dominant?.takeIf(::hasColor)
                ?: palette.vibrantSwatch?.takeIf(::hasColor)
                ?: palette.mutedSwatch?.takeIf(::hasColor)
                ?: dominant)?.rgb
        }
        if (color != null) synchronized(colors) { colors[key] = color }
        return color
    }

    /** Card/miniplayer surface: [dominant] mixed 32 % over #09090B, then darkened to WCAG AA contrast with white. */
    fun surface(dominant: Int?): Int {
        val tint = dominant ?: 0xff28483e.toInt()
        var red = mixChannel((tint ushr 16) and 0xff, 9)
        var green = mixChannel((tint ushr 8) and 0xff, 9)
        var blue = mixChannel(tint and 0xff, 11)
        while (1.05 / (luminance(red, green, blue) + 0.05) < 4.5) {
            red = (red * 0.9).toInt()
            green = (green * 0.9).toInt()
            blue = (blue * 0.9).toInt()
        }
        return 0xff000000.toInt() or (red shl 16) or (green shl 8) or blue
    }

    private fun hasColor(swatch: Palette.Swatch): Boolean = swatch.hsl.let { it[1] >= 0.15f && it[2] >= 0.12f }
    private fun mixChannel(tint: Int, base: Int): Int = (base + (tint - base) * 0.32).roundToInt()
    private fun luminance(red: Int, green: Int, blue: Int): Double =
        0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)

    private fun linear(channel: Int): Double {
        val srgb = channel / 255.0
        return if (srgb <= 0.04045) srgb / 12.92 else ((srgb + 0.055) / 1.055).pow(2.4)
    }
}
