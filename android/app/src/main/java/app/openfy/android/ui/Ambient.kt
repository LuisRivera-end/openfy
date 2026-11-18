package app.openfy.android.ui

import kotlin.math.roundToInt

/** Shared by the web, Windows and Android ambient renderers. */
internal object AMBIENT {
    const val textureSize = 64
    const val lumaFloor = 0.04
    const val lumaCeiling = 0.74
    const val saturation = 1.4
    const val scrimMin = 0.08
    const val scrimMax = 0.4
    const val scrimPivot = 0.38
    const val scrimSlope = 0.8
    const val lyricsScrim = 0.18
    const val motionSpeed = 2.4
    const val fadeSeconds = 1.2
}

internal fun ambientLuma(r: Double, g: Double, b: Double): Double =
    0.2126 * r + 0.7152 * g + 0.0722 * b

internal fun gradeAmbient(r: Double, g: Double, b: Double): DoubleArray {
    val luma = ambientLuma(r, g, b)
    val lifted = AMBIENT.lumaFloor + (AMBIENT.lumaCeiling - AMBIENT.lumaFloor) * luma
    return doubleArrayOf(r, g, b).apply {
        for (channel in indices) {
            this[channel] = (lifted + (this[channel] - luma) * AMBIENT.saturation).coerceIn(0.0, 1.0)
        }
    }
}

internal fun ambientScrim(meanLuma: Double): Double =
    (AMBIENT.scrimMin + (meanLuma - AMBIENT.scrimPivot) * AMBIENT.scrimSlope)
        .coerceIn(AMBIENT.scrimMin, AMBIENT.scrimMax)

internal fun ambientFade(elapsed: Double): Double {
    val t = (elapsed / AMBIENT.fadeSeconds).coerceIn(0.0, 1.0)
    return t * t * (3 - 2 * t)
}

internal fun ambientMeanLuma(rgba: ByteArray): Double {
    val count = rgba.size / 4
    var total = 0.0
    for (offset in 0 until count * 4 step 4) {
        total += ambientLuma(
            (rgba[offset].toInt() and 255) / 255.0,
            (rgba[offset + 1].toInt() and 255) / 255.0,
            (rgba[offset + 2].toInt() and 255) / 255.0
        )
    }
    return if (count > 0) total / count else 0.0
}

private val ambientHex = Regex("^#?([0-9a-f]{6})$", RegexOption.IGNORE_CASE)

internal fun ambientPaletteTexture(palette: List<String>, size: Int = AMBIENT.textureSize): ByteArray {
    val (a, b, c) = List(3) { index ->
        val rgb = ambientHex.matchEntire(palette.getOrNull(index).orEmpty().trim())
            ?.groupValues?.get(1)?.toInt(16) ?: 0x28483e
        intArrayOf(rgb shr 16 and 255, rgb shr 8 and 255, rgb and 255)
    }
    val pixels = ByteArray(size * size * 4)
    for (y in 0 until size) {
        for (x in 0 until size) {
            val u = x.toDouble() / (size - 1)
            val v = y.toDouble() / (size - 1)
            val offset = (y * size + x) * 4
            for (channel in 0..2) {
                val across = a[channel] + (b[channel] - a[channel]) * u
                val value = across + (c[channel] - across) * v
                pixels[offset + channel] = if (value.isNaN()) 0 else value.roundToInt().toByte()
            }
            pixels[offset + 3] = 255.toByte()
        }
    }
    return pixels
}
