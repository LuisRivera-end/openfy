package app.openfy.android.ui

import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToInt

data class ArtistThemeColors(val base: String, val secondary: String, val deep: String, val surface: String, val neutral: Boolean)

private const val SAMPLE = 16
private const val PIXEL_COUNT = SAMPLE * SAMPLE
private const val BUCKET_COUNT = 12
private const val MAX_LUMINANCE = 0.14

private data class Rgb(val r: Double, val g: Double, val b: Double)
private data class Hsl(val h: Double, val s: Double, val l: Double)
private class Bucket(var weight: Double = 0.0, var r: Double = 0.0, var g: Double = 0.0, var b: Double = 0.0)

val NEUTRAL = theme(Hsl(215.0, 0.18, 0.30), Hsl(230.0, 0.14, 0.26), true)

/** Page colours from a 16×16 ARGB sample, as returned by Bitmap.getPixels. */
fun artistTheme(rgb: IntArray?): ArtistThemeColors {
    if (rgb == null || rgb.size < PIXEL_COUNT) return NEUTRAL
    val buckets = Array(BUCKET_COUNT) { Bucket() }
    var totalChroma = 0.0
    for (i in 0 until PIXEL_COUNT) {
        val pixel = rgb[i]
        val r = (pixel ushr 16 and 255) / 255.0
        val g = (pixel ushr 8 and 255) / 255.0
        val b = (pixel and 255) / 255.0
        val max = maxOf(r, g, b)
        val min = minOf(r, g, b)
        val chroma = max - min
        totalChroma += chroma
        if (max < 0.08 || min > 0.92) continue
        val hue = toHsl(r, g, b).h
        val bucket = buckets[(hue / 30).toInt()]
        bucket.weight += chroma
        bucket.r += chroma * r
        bucket.g += chroma * g
        bucket.b += chroma * b
    }

    var dominant = 0
    for (i in 1 until BUCKET_COUNT) {
        if (buckets[i].weight > buckets[dominant].weight) dominant = i
    }
    val primary = buckets[dominant]
    if (totalChroma / PIXEL_COUNT < 0.08 || primary.weight == 0.0) return NEUTRAL

    var alternate: Bucket? = null
    for (i in 0 until BUCKET_COUNT) {
        val distance = abs(i - dominant)
        val bucket = buckets[i]
        if (minOf(distance, BUCKET_COUNT - distance) < 2 || bucket.weight < 0.15 * primary.weight) continue
        if (alternate == null || bucket.weight > alternate.weight) alternate = bucket
    }
    val base = bucketColor(primary)
    val secondary = alternate?.let(::bucketColor) ?: base.copy(h = (base.h + 20) % 360)
    return theme(base, secondary, false)
}

private fun toHsl(r: Double, g: Double, b: Double): Hsl {
    val max = maxOf(r, g, b)
    val min = minOf(r, g, b)
    val chroma = max - min
    val lightness = (max + min) / 2
    if (chroma == 0.0) return Hsl(0.0, 0.0, lightness)
    val hue = 60 * when (max) {
        r -> (g - b) / chroma
        g -> (b - r) / chroma + 2
        else -> (r - g) / chroma + 4
    }
    return Hsl(if (hue < 0) hue + 360 else hue, chroma / (1 - abs(2 * lightness - 1)), lightness)
}

private fun toRgb(color: Hsl): Rgb {
    val (hue, saturation, lightness) = color
    val amplitude = saturation * minOf(lightness, 1 - lightness)
    fun channel(offset: Int): Double {
        val k = (offset + hue / 30) % 12
        return lightness - amplitude * maxOf(-1.0, minOf(k - 3, 9 - k, 1.0))
    }
    return Rgb(channel(0), channel(8), channel(4))
}

private fun luminance(color: Rgb): Double {
    fun linear(c: Double) = if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

private fun fitContrast(color: Hsl): Hsl {
    if (luminance(toRgb(color)) <= MAX_LUMINANCE) return color
    var low = 0.0
    var high = color.l
    repeat(24) {
        val mid = (low + high) / 2
        if (luminance(toRgb(color.copy(l = mid))) <= MAX_LUMINANCE) low = mid
        else high = mid
    }
    return color.copy(l = low)
}

private fun bucketColor(bucket: Bucket): Hsl {
    val (h, s, l) = toHsl(bucket.r / bucket.weight, bucket.g / bucket.weight, bucket.b / bucket.weight)
    return Hsl(h, s.coerceIn(0.45, 0.85), l.coerceIn(0.22, 0.60))
}

private fun hex(color: Rgb): String {
    fun channel(c: Double) = (c * 255).roundToInt().toString(16).padStart(2, '0')
    return "#${channel(color.r)}${channel(color.g)}${channel(color.b)}"
}

private fun theme(base: Hsl, secondary: Hsl, neutral: Boolean): ArtistThemeColors {
    val fitted = fitContrast(base)
    val (r, g, b) = toRgb(fitted)
    // Lighter for hover/selection while white text keeps AA; otherwise a darker step of base.
    val lighter = Rgb(r + (1 - r) * 0.10, g + (1 - g) * 0.10, b + (1 - b) * 0.10)
    val surface = if (luminance(lighter) <= MAX_LUMINANCE) lighter else Rgb(r * 0.82, g * 0.82, b * 0.82)
    return ArtistThemeColors(
        hex(Rgb(r, g, b)), hex(toRgb(fitContrast(secondary))), hex(toRgb(fitted.copy(l = fitted.l * 0.45))),
        hex(surface), neutral,
    )
}
