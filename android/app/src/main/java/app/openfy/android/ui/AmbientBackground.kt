package app.openfy.android.ui

import android.content.Context
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Paint
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.annotation.RequiresApi
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import java.io.File
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

private const val FrameIntervalMs = 34L
private const val PhoneMotion = 0.7
private const val MaxPlayerScrim = 0.55f
internal val PlayerSecondaryText = Color(0xffd4d4d8)
internal val PlayerProgressTrack = Color(0xffb4b4be)
internal val InactiveLyricsColor = Color.White.copy(alpha = 0.5f)

@Composable
internal fun AmbientBackground(
    source: String?,
    playing: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val reducedMotion = rememberReducedMotion()
    // Neutral dark until the cover decodes, so the first frame never flashes the green palette default.
    val fallback = remember { lightTexture(ambientPaletteTexture(listOf("#18181b", "#141416", "#18181b"))) }
    // Keep the last texture on screen while Coil decodes the incoming cover.
    var artwork by remember { mutableStateOf<Pair<String?, LightTexture>>(null to fallback) }
    LaunchedEffect(source, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (artwork.first != source) {
                artwork = source to (readAmbientArtwork(context, source) ?: fallback)
            }
        }
    }
    val texture = artwork.second
    val animation = remember { AmbientAnimation(fallback) }
    val allowed = enabled && !reducedMotion
    LaunchedEffect(texture, playing, allowed, lifecycle) {
        if (animation.current !== texture) {
            val running = allowed && playing && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
            val instant = !running || animation.current === fallback
            animation.previous = if (instant) texture else animation.current
            animation.current = texture
            animation.elapsed = if (instant) AMBIENT.fadeSeconds else 0.0
            animation.mix = if (instant) 1f else 0f
        } else if (!allowed) {
            animation.previous = animation.current
            animation.mix = 1f
            animation.elapsed = AMBIENT.fadeSeconds
        }
        if (!allowed || !playing) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            var last = SystemClock.uptimeMillis()
            while (isActive && (animation.current !== fallback || animation.mix < 1f)) {
                delay(FrameIntervalMs)
                val now = SystemClock.uptimeMillis()
                val seconds = (now - last) / 1000.0
                last = now
                animation.phase += (seconds.coerceAtMost(0.1) * AMBIENT.motionSpeed * PhoneMotion).toFloat()
                if (animation.mix < 1f) {
                    animation.elapsed += seconds
                    animation.mix = ambientFade(animation.elapsed).toFloat()
                    if (animation.mix >= 1f) animation.previous = animation.current
                }
            }
        }
    }

    val previous = animation.previous
    val current = animation.current
    val shader = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        rememberAmbientShader(previous, current)
    } else null
    Box(modifier.clipToBounds()) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && shader != null) {
            Canvas(Modifier.fillMaxSize().ambientResolution()) {
                drawIntoCanvas {
                    shader.draw(it.nativeCanvas, size.width, size.height, animation.phase, animation.mix)
                }
            }
        } else {
            if (previous !== current) AmbientLayers(previous, animation, fadeIn = false)
            AmbientLayers(current, animation, fadeIn = previous !== current)
        }
        Box(Modifier.fillMaxSize().ambientScrims(animation))
    }
}

private fun Modifier.ambientScrims(animation: AmbientAnimation): Modifier = drawWithCache {
    val clear = Ink.copy(alpha = 0f)
    val topBand = Brush.verticalGradient(0f to Ink.copy(alpha = 0.50f), 0.65f to Ink.copy(alpha = 0.45f),
        1f to clear, endY = 190.dp.toPx())
    val bottomBand = Brush.verticalGradient(listOf(clear, Ink.copy(alpha = 0.60f)),
        startY = size.height - 320.dp.toPx(), endY = size.height)
    onDrawBehind {
        val previous = animation.previous
        val current = animation.current
        val mix = animation.mix
        val mean = previous.meanLuma + (current.meanLuma - previous.meanLuma) * mix
        val highlightExtra = 0.15f * ((mean - 0.30f) / 0.50f).coerceIn(0f, 1f)
        val fromMean = ambientScrim(mean.toDouble()).toFloat() + highlightExtra
        // Blend transmission so the intermediate cover stays within the endpoint contrast bounds.
        val fromHighlights = 1f - 1f / ((1f - mix) / (1f - previous.contrastScrim) + mix / (1f - current.contrastScrim))
        drawRect(Ink.copy(alpha = maxOf(fromMean, fromHighlights).coerceAtMost(MaxPlayerScrim)))
        drawRect(topBand)
        drawRect(bottomBand)
    }
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

private fun Modifier.ambientResolution(): Modifier = layout { measurable, constraints ->
    val width = constraints.maxWidth
    val height = constraints.maxHeight
    if (width == 0 || height == 0) {
        layout(width, height) {}
    } else {
        // Render at 0.75 pixels per dp, within the same cap as the web background.
        val scale = minOf(0.75f / density, 1280f / width, 720f / height, 1f)
        val renderWidth = (width * scale).roundToInt().coerceAtLeast(1)
        val renderHeight = (height * scale).roundToInt().coerceAtLeast(1)
        val art = measurable.measure(Constraints.fixed(renderWidth, renderHeight))
        layout(width, height) {
            art.placeWithLayer(0, 0) {
                compositingStrategy = CompositingStrategy.Offscreen
                transformOrigin = TransformOrigin(0f, 0f)
                scaleX = width.toFloat() / renderWidth
                scaleY = height.toFloat() / renderHeight
            }
        }
    }
}

@Composable
internal fun rememberReducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    val setting = Settings.Global.ANIMATOR_DURATION_SCALE
    fun reduced() = Settings.Global.getFloat(resolver, setting, 1f) == 0f
    var value by remember(resolver) { mutableStateOf(reduced()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { value = reduced() }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(setting), false, observer)
        value = reduced()
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return value
}

private class AmbientAnimation(initial: LightTexture) {
    var current by mutableStateOf(initial)
    var previous by mutableStateOf(initial)
    var phase by mutableFloatStateOf(0f)
    var mix by mutableFloatStateOf(1f)
    var elapsed = AMBIENT.fadeSeconds
}

private class LightTexture(val first: Bitmap, val second: Bitmap, val meanLuma: Float, val contrastScrim: Float)

private suspend fun readAmbientArtwork(context: Context, source: String?): LightTexture? {
    val url = ArtworkUrls.sized(source, 128) ?: return null
    val size = AMBIENT.textureSize
    val image = sequenceOf(url, source, ArtworkUrls.fallback(url)).filterNotNull().distinct().firstNotNullOfOrNull { address ->
        val data = File(address).takeIf { it.isAbsolute } ?: address
        val request = ImageRequest.Builder(context).data(data).size(size).allowHardware(false).build()
        (SingletonImageLoader.get(context).execute(request) as? SuccessResult)?.image
    } ?: return null
    return withContext(Dispatchers.Default) {
        val bitmap = Bitmap.createScaledBitmap(image.toBitmap(), size, size, true)
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
}

private fun lightTexture(rgba: ByteArray): LightTexture {
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

@Composable
private fun AmbientLayers(texture: LightTexture, animation: AmbientAnimation, fadeIn: Boolean) {
    BoxWithConstraints(Modifier.fillMaxSize().graphicsLayer {
        alpha = if (fadeIn) animation.mix else 1f
        if (fadeIn) compositingStrategy = CompositingStrategy.Offscreen
    }, contentAlignment = Alignment.Center) {
        // A diagonal-sized texture covers all corners, including while it rotates.
        val side = hypot(maxWidth.value, maxHeight.value)
        texture.let {
            Image(remember(it) { it.first.asImageBitmap() }, null, Modifier.requiredSize((side * 1.15f).dp)
                .graphicsLayer {
                    val t = animation.phase
                    rotationZ = t * (0.07f * 180f / Math.PI.toFloat())
                    scaleX = 1f + 0.03f * sin(t * 0.08f)
                    scaleY = scaleX
                    translationX = size.width * 0.04f * sin(t * 0.11f)
                    translationY = size.height * 0.03f * sin(t * 0.09f)
                }, contentScale = ContentScale.FillBounds)
            Image(remember(it) { it.second.asImageBitmap() }, null, Modifier.requiredSize((side * 1.5f).dp)
                .graphicsLayer {
                    val t = animation.phase
                    rotationZ = (1.7f - t * 0.05f) * (180f / Math.PI.toFloat())
                    scaleX = 1f + 0.04f * sin(t * 0.07f)
                    scaleY = scaleX
                    translationX = -size.width * 0.04f * sin(t * 0.09f)
                    translationY = size.height * 0.03f * sin(t * 0.08f)
                    alpha = 0.5f
                }, contentScale = ContentScale.FillBounds)
        }
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
@Composable
private fun rememberAmbientShader(previous: LightTexture, current: LightTexture): AmbientShader? {
    val shader = remember { runCatching { AmbientShader() }.getOrNull() } ?: return null
    return remember(shader, previous, current) { shader.apply { setArtwork(previous, current) } }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class AmbientShader {
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

    fun draw(canvas: android.graphics.Canvas, width: Float, height: Float, phase: Float, mix: Float) {
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
