package app.openfy.android.ui

import androidx.compose.ui.graphics.Color
import kotlin.math.cbrt
import kotlin.math.floor
import kotlin.math.hypot

data class AlbumTintColors(
    val background: String,
    val surface: String,
    val muted: String,
    val edge: String
) {
    val backgroundArgb: Int get() = parseHexRgb(background)
    val surfaceArgb: Int get() = parseHexRgb(surface)
    val mutedArgb: Int get() = parseHexRgb(muted)
    val edgeArgb: Int get() = parseHexRgb(edge)

    val backgroundColor: Color get() = Color(backgroundArgb)
    val surfaceColor: Color get() = Color(surfaceArgb)
    val mutedColor: Color get() = Color(mutedArgb)
    val edgeColor: Color get() = Color(edgeArgb)
}

private const val BASE = 0x09090B
private val WHITE = intArrayOf(255, 255, 255)
private val BLACK = intArrayOf(0, 0, 0)
private const val SAMPLE = 64
private const val MAX_LIGHTNESS = 0.3
private const val MAX_CHROMA = 0.125
private val MUTED_LIFT = intArrayOf(161, 161, 166)
private const val MIN_MUTED_CONTRAST = 4.5

private fun q(value: Double): Int = floor(value + 0.5).toInt()
private fun clampByte(value: Int): Int = minOf(255, maxOf(0, value))

private fun hex(rgb: IntArray): String =
    String.format("#%02X%02X%02X", rgb[0], rgb[1], rgb[2])

private fun mix(a: IntArray, b: IntArray, weight: Int): IntArray =
    IntArray(3) { i -> q(((100 - weight) * a[i] + weight * b[i]) / 100.0) }

private fun linear(byte: Int): Double {
    val s = byte / 255.0
    return if (s <= 0.04045) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4)
}

private fun encode(value: Double): Int {
    val v = Math.min(1.0, Math.max(0.0, value))
    return q(255.0 * (if (v <= 0.0031308) 12.92 * v else 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055))
}

private fun luminance(rgb: IntArray): Double =
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])

private fun contrast(a: IntArray, b: IntArray): Double {
    val lumA = luminance(a)
    val lumB = luminance(b)
    val hi = maxOf(lumA, lumB)
    val lo = minOf(lumA, lumB)
    return (hi + 0.05) / (lo + 0.05)
}

private fun pageColor(rgb: IntArray): IntArray {
    val r = linear(rgb[0])
    val g = linear(rgb[1])
    val b = linear(rgb[2])
    val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    val L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    var A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    val chroma = hypot(A, B)
    if (chroma > MAX_CHROMA) {
        A *= MAX_CHROMA / chroma
        B *= MAX_CHROMA / chroma
    }
    val L2 = minOf(L, MAX_LIGHTNESS)
    val l2 = Math.pow(L2 + 0.3963377774 * A + 0.2158037573 * B, 3.0)
    val m2 = Math.pow(L2 - 0.1055613458 * A - 0.0638541728 * B, 3.0)
    val s2 = Math.pow(L2 - 0.0894841775 * A - 1.291485548 * B, 3.0)
    return intArrayOf(
        encode(4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2),
        encode(-1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2),
        encode(-0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2)
    )
}

private fun trimHex(input: String?): String {
    if (input == null) return ""
    var s = input.trim()
    while (s.startsWith('\uFEFF')) {
        s = s.substring(1).trim()
    }
    return s
}

fun parseHexRgb(hex: String): Int {
    val digits = trimHex(hex).removePrefix("#")
    val rgb = digits.toInt(16)
    return (0xFF shl 24) or rgb
}

fun albumTint(input: String?): AlbumTintColors {
    val trimmed = trimHex(input)
    val match = Regex("^#?([0-9a-fA-F]{6})$").matchEntire(trimmed)
    val digits = match?.groupValues?.get(1)
    val value = if (digits != null) digits.toInt(16) else BASE

    val background = pageColor(intArrayOf((value shr 16) and 255, (value shr 8) and 255, value and 255))
    val surface = mix(background, WHITE, 8)
    val lifted = IntArray(3) { i -> clampByte(background[i] + MUTED_LIFT[i]) }
    var muted = lifted
    var weight = 10
    while (contrast(muted, surface) < MIN_MUTED_CONTRAST && weight <= 100) {
        muted = mix(lifted, WHITE, weight)
        weight += 10
    }

    return AlbumTintColors(
        background = hex(background),
        surface = hex(surface),
        muted = hex(muted),
        edge = hex(mix(background, BLACK, 28))
    )
}

private class DominantBucket {
    var count: Int = 0
    var r: Long = 0L
    var g: Long = 0L
    var b: Long = 0L
}

fun albumDominant(pixels: IntArray, width: Int, height: Int, channels: Int): String? {
    if (width < 1 || height < 1 || (channels != 3 && channels != 4) || pixels.size < width * height * channels) return null
    val side = minOf(width, height)
    val left = (width - side) / 2.0
    val top = (height - side) / 2.0
    val buckets = arrayOfNulls<DominantBucket>(4096)

    for (y in 0 until SAMPLE) {
        val row = floor(top + (y + 0.5) * side / SAMPLE.toDouble()).toInt() * width
        for (x in 0 until SAMPLE) {
            val col = floor(left + (x + 0.5) * side / SAMPLE.toDouble()).toInt()
            val index = (row + col) * channels
            if (channels == 4 && pixels[index + 3] < 128) continue
            val r = pixels[index]
            val g = pixels[index + 1]
            val b = pixels[index + 2]
            val bucketIndex = (r shr 4) * 256 + (g shr 4) * 16 + (b shr 4)
            val bucket = buckets[bucketIndex] ?: DominantBucket().also { buckets[bucketIndex] = it }
            bucket.count++
            bucket.r += r
            bucket.g += g
            bucket.b += b
        }
    }

    var winner: DominantBucket? = null
    for (bucket in buckets) {
        if (bucket != null && (winner == null || bucket.count > winner.count)) {
            winner = bucket
        }
    }
    if (winner == null) return null
    val count = winner.count.toDouble()
    return hex(intArrayOf(q(winner.r / count), q(winner.g / count), q(winner.b / count)))
}

fun albumDominant(pixels: ByteArray, width: Int, height: Int, channels: Int): String? {
    if (width < 1 || height < 1 || (channels != 3 && channels != 4) || pixels.size < width * height * channels) return null
    val ints = IntArray(pixels.size) { pixels[it].toInt() and 0xFF }
    return albumDominant(ints, width, height, channels)
}
