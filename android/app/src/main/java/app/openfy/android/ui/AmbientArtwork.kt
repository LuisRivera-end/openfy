package app.openfy.android.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.core.graphics.withTranslation
import coil3.SingletonImageLoader
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import java.io.File
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Ambient pieces without Compose UI, shared by the expanded player and the live wallpaper.

internal const val MaxPlayerScrim = 0.55f

/** Two graded mip levels of a cover and the veil limits derived from them. */
internal class LightTexture(val first: Bitmap, val second: Bitmap, val meanLuma: Float, val contrastScrim: Float)

internal val NeutralAmbientPalette = listOf("#18181b", "#141416", "#18181b")

internal fun neutralLightTexture(): LightTexture = lightTexture(ambientPaletteTexture(NeutralAmbientPalette))

/**
 * Loads [source] through the shared image loader and grades it. With [offline], only local files and
 * covers already in Coil's disk cache are read, and no request leaves the device.
 */
internal suspend fun readAmbientArtwork(context: Context, source: String?, offline: Boolean = false): LightTexture? {
    val url = ArtworkUrls.sized(source, 128) ?: return null
    val candidates = sequenceOf(url, source, ArtworkUrls.fallback(url)).filterNotNull().distinct()
    val image = readArtwork(context, candidates, AMBIENT.textureSize, offline) ?: return null
    return ambientTexture(image)
}

/** First candidate that decodes. Remote addresses are skipped offline unless Coil's disk cache has them. */
internal suspend fun readArtwork(context: Context, candidates: Sequence<String>, size: Int, offline: Boolean): Bitmap? {
    val loader = SingletonImageLoader.get(context)
    for (address in candidates) {
        val file = File(address).takeIf { it.isAbsolute }
        if (file == null && offline) {
            val cached = withContext(Dispatchers.IO) { loader.diskCache?.openSnapshot(address)?.use { true } == true }
            if (!cached) continue
        }
        val request = ImageRequest.Builder(context).data(file ?: address).size(size).allowHardware(false)
            .apply { if (offline) networkCachePolicy(CachePolicy.DISABLED) }.build()
        val image = (loader.execute(request) as? SuccessResult)?.image ?: continue
        return image.toBitmap()
    }
    return null
}

internal suspend fun ambientTexture(image: Bitmap): LightTexture = withContext(Dispatchers.Default) {
    val size = AMBIENT.textureSize
    val bitmap = Bitmap.createScaledBitmap(image, size, size, true)
    val pixels = IntArray(size * size)
    bitmap.getPixels(pixels, 0, size, 0, 0, size, size)
    val rgba = ByteArray(pixels.size * 4)
    pixels.forEachIndexed { index, pixel ->
        val offset = index * 4
        rgba[offset] = (pixel ushr 16).toByte()
        rgba[offset + 1] = (pixel ushr 8).toByte()
        rgba[offset + 2] = pixel.toByte()
        rgba[offset + 3] = (pixel ushr 24).toByte()
    }
    lightTexture(rgba)
}

internal fun lightTexture(rgba: ByteArray): LightTexture {
    val pixels = IntArray(AMBIENT.textureSize * AMBIENT.textureSize) { index ->
        val offset = index * 4
        val (r, g, b) = gradeAmbient(
            (rgba[offset].toInt() and 255) / 255.0,
            (rgba[offset + 1].toInt() and 255) / 255.0,
            (rgba[offset + 2].toInt() and 255) / 255.0
        )
        android.graphics.Color.rgb((r * 255).roundToInt(), (g * 255).roundToInt(), (b * 255).roundToInt())
    }
    val first = mipPixels(pixels, 4)
    val second = mipPixels(pixels, 8)
    val size = AMBIENT.textureSize
    return LightTexture(
        Bitmap.createBitmap(first, size / 4, size / 4, Bitmap.Config.ARGB_8888),
        Bitmap.createBitmap(second, size / 8, size / 8, Bitmap.Config.ARGB_8888),
        ambientMeanLuma(rgba).toFloat(),
        contrastScrim(first, second)
    )
}

/** Render at 0.75 pixels per dp, within the same cap as the web background, then scale up. */
internal fun ambientRenderScale(width: Int, height: Int, density: Float): Float =
    minOf(0.75f / density, 1280f / width, 720f / height, 1f)

/** Veil opacity over the ambient light while [previous] fades into [current]. */
internal fun ambientVeil(previous: LightTexture, current: LightTexture, mix: Float): Float {
    val mean = previous.meanLuma + (current.meanLuma - previous.meanLuma) * mix
    val highlightExtra = 0.15f * ((mean - 0.30f) / 0.50f).coerceIn(0f, 1f)
    val fromMean = ambientScrim(mean.toDouble()).toFloat() + highlightExtra
    // Blend transmission so the intermediate cover stays within the endpoint contrast bounds.
    val fromHighlights = 1f - 1f / ((1f - mix) / (1f - previous.contrastScrim) + mix / (1f - current.contrastScrim))
    return maxOf(fromMean, fromHighlights).coerceAtMost(MaxPlayerScrim)
}

// A small margin covers channel rounding in translucent sRGB layers.
private val PlayerSurfaceLumaLimit = minOf(
    (PlayerSecondaryText.luminance() + 0.05f) / 4.5f,
    (PlayerProgressTrack.luminance() + 0.05f) / 3f,
    (Green.luminance() + 0.05f) / 3f
) - 0.052f

private fun supportsPlayerContrast(sample: Color, veil: Color): Boolean {
    val background = veil.compositeOver(sample)
    val luminance = background.luminance()
    return luminance <= PlayerSurfaceLumaLimit &&
        InactiveLyricsColor.compositeOver(background).luminance() + 0.05f >= 3f * (luminance + 0.05f) + 0.006f
}

// Compress only ambient highlights that would exceed the veil's opacity budget.
private fun limitAmbientHighlight(sample: Color): Int {
    val maxVeil = Ink.copy(alpha = MaxPlayerScrim)
    if (supportsPlayerContrast(sample, maxVeil)) return sample.toArgb()
    var low = 0f
    var high = 1f
    repeat(9) {
        val middle = (low + high) / 2f
        val dimmed = Ink.copy(alpha = 1f - middle).compositeOver(sample)
        if (supportsPlayerContrast(dimmed, maxVeil)) low = middle else high = middle
    }
    return Ink.copy(alpha = 1f - low).compositeOver(sample).toArgb()
}

private fun contrastScrim(vararg mipLevels: IntArray): Float {
    fun meetsContrast(alpha: Float): Boolean {
        val veil = Ink.copy(alpha = alpha)
        return mipLevels.all { level -> level.all { supportsPlayerContrast(Color(it), veil) } }
    }
    if (meetsContrast(0f)) return 0f
    var low = 0f
    var high = MaxPlayerScrim
    repeat(9) {
        val middle = (low + high) / 2f
        if (meetsContrast(middle)) high = middle else low = middle
    }
    return high
}

/** The GLSL samples mip levels 2 and 3. Box-filter those levels once per cover. */
private fun mipPixels(pixels: IntArray, stride: Int): IntArray {
    val width = AMBIENT.textureSize / stride
    return IntArray(width * width) { index ->
        val start = index / width * stride * AMBIENT.textureSize + index % width * stride
        var red = 0
        var green = 0
        var blue = 0
        for (y in 0 until stride) {
            for (x in 0 until stride) {
                val pixel = pixels[start + y * AMBIENT.textureSize + x]
                red += android.graphics.Color.red(pixel)
                green += android.graphics.Color.green(pixel)
                blue += android.graphics.Color.blue(pixel)
            }
        }
        val count = stride * stride
        limitAmbientHighlight(Color((red + count / 2) / count, (green + count / 2) / count, (blue + count / 2) / count))
    }
}

/** Transform of one of the two light layers used below API 33. [layerSize] is the layer's own side. */
internal class AmbientLayerMotion(val rotationDegrees: Float, val scale: Float, val x: Float, val y: Float, val alpha: Float)

internal object AmbientLightLayers {
    /** A diagonal-sized texture covers all corners, including while it rotates. */
    fun side(diagonal: Float, layer: Int): Float = diagonal * if (layer == 0) 1.15f else 1.5f

    fun motion(layer: Int, phase: Float, layerSize: Float): AmbientLayerMotion = if (layer == 0) {
        AmbientLayerMotion(phase * (0.07f * 180f / Math.PI.toFloat()), 1f + 0.03f * sin(phase * 0.08f),
            layerSize * 0.04f * sin(phase * 0.11f), layerSize * 0.03f * sin(phase * 0.09f), 1f)
    } else {
        AmbientLayerMotion((1.7f - phase * 0.05f) * (180f / Math.PI.toFloat()), 1f + 0.04f * sin(phase * 0.07f),
            -layerSize * 0.04f * sin(phase * 0.09f), layerSize * 0.03f * sin(phase * 0.08f), 0.5f)
    }

    /** Canvas twin of the composable layers, for surfaces outside Compose. [paint] should filter bitmaps. */
    fun draw(canvas: Canvas, texture: LightTexture, width: Float, height: Float, phase: Float, alpha: Float, paint: Paint) {
        val group = if (alpha < 1f) canvas.saveLayerAlpha(0f, 0f, width, height, (255 * alpha).roundToInt()) else null
        val diagonal = hypot(width, height)
        for (layer in 0..1) {
            val side = side(diagonal, layer)
            val motion = motion(layer, phase, side)
            val bitmap = if (layer == 0) texture.first else texture.second
            canvas.withTranslation(width / 2f + motion.x, height / 2f + motion.y) {
                rotate(motion.rotationDegrees)
                scale(motion.scale, motion.scale)
                paint.alpha = (255 * motion.alpha).roundToInt()
                drawBitmap(bitmap, null, RectF(-side / 2f, -side / 2f, side / 2f, side / 2f), paint)
            }
        }
        group?.let(canvas::restoreToCount)
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class AmbientShader {
    private val shader = RuntimeShader(AmbientAgsl)
    private val paint = Paint().apply { shader = this@AmbientShader.shader }

    fun setArtwork(previous: LightTexture, current: LightTexture) {
        shader.setInputShader("previousA", bitmapShader(previous.first))
        shader.setInputShader("previousB", bitmapShader(previous.second))
        shader.setInputShader("currentA", bitmapShader(current.first))
        shader.setInputShader("currentB", bitmapShader(current.second))
    }

    private fun bitmapShader(bitmap: Bitmap) = BitmapShader(bitmap, Shader.TileMode.MIRROR, Shader.TileMode.MIRROR)
        .apply { setFilterMode(BitmapShader.FILTER_MODE_LINEAR) }

    fun draw(canvas: Canvas, width: Float, height: Float, phase: Float, mix: Float) {
        shader.setFloatUniform("viewport", width, height)
        shader.setFloatUniform("phase", phase)
        shader.setFloatUniform("artMix", mix)
        canvas.drawRect(0f, 0f, width, height, paint)
    }
}

// The WebGL warp with audio bands at zero. Input shaders already contain graded mip levels.
private const val AmbientAgsl = """
uniform shader previousA;
uniform shader previousB;
uniform shader currentA;
uniform shader currentB;
uniform float2 viewport;
uniform float phase;
uniform float artMix;
float hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}
float noise(float2 p) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + float2(1, 0)), u.x),
        mix(hash(i + float2(0, 1)), hash(i + 1.0), u.x), u.y);
}
float fbm(float2 p) {
    return noise(p) * 0.65 + noise(p * 2.03 + 17.1) * 0.35;
}
float2 spin(float2 p, float angle) {
    float s = sin(angle), c = cos(angle);
    return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}
float2 tap(float2 at, float res) {
    float2 x = at * res + 0.5, i = floor(x), f = x - i;
    return i + f * f * (3.0 - 2.0 * f) - 0.5;
}
half4 main(float2 pixel) {
    float aspect = viewport.x / max(viewport.y, 1.0);
    float2 p = (pixel / max(viewport, float2(1)) * 2.0 - 1.0)
        * float2(aspect, 1) / max(1.0, aspect * 0.8);
    float t = phase;
    float2 q = p + 0.62 * (float2(fbm(p * 1.3 + t * 0.11),
        fbm(p * 1.3 + float2(5.2, 1.3) - t * 0.09)) - 0.5);
    q += 0.62 * 0.6 * (float2(fbm(q * 2.1 - t * 0.07 + 3.7),
        fbm(q * 2.1 + t * 0.08 + 9.1)) - 0.5);
    float2 a = tap(spin(q, t * 0.07) / 1.6 * 0.5 + 0.5, 16.0);
    float2 b = tap(spin(q, -t * 0.05 + 1.7) / 2.2 * 0.5 + 0.5, 8.0);
    float3 c = (currentA.eval(a).rgb + currentB.eval(b).rgb) * 0.5;
    if (artMix < 1.0) {
        float3 old = (previousA.eval(a).rgb + previousB.eval(b).rgb) * 0.5;
        c = mix(old, c, artMix);
    }
    c = c * 0.96 + (hash(pixel) + hash(pixel + 19.19) - 1.0) / 255.0;
    return half4(clamp(c, 0.0, 1.0), 1.0);
}
"""
