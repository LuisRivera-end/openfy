package app.openfy.android.ui

import android.database.ContentObserver
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
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

internal const val AmbientFrameIntervalMs = 34L
internal const val AmbientPhoneMotion = 0.7
internal val PlayerSecondaryText = Color(0xffd4d4d8)
internal val PlayerProgressTrack = Color(0xffb4b4be)
internal val InactiveLyricsColor = Color.White.copy(alpha = 0.5f)

@Composable
internal fun AmbientBackground(
    source: String?,
    playing: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    /** The top and bottom bands that keep the player's controls legible. */
    playerBands: Boolean = true
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val reducedMotion = rememberReducedMotion()
    // Neutral dark until the cover decodes, so the first frame never flashes the green palette default.
    val fallback = remember { neutralLightTexture() }
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
                delay(AmbientFrameIntervalMs)
                val now = SystemClock.uptimeMillis()
                val seconds = (now - last) / 1000.0
                last = now
                animation.phase += (seconds.coerceAtMost(0.1) * AMBIENT.motionSpeed * AmbientPhoneMotion).toFloat()
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
        Box(Modifier.fillMaxSize().ambientScrims(animation, playerBands))
    }
}

private fun Modifier.ambientScrims(animation: AmbientAnimation, bands: Boolean): Modifier = drawWithCache {
    val clear = Ink.copy(alpha = 0f)
    val topBand = Brush.verticalGradient(0f to Ink.copy(alpha = 0.50f), 0.65f to Ink.copy(alpha = 0.45f),
        1f to clear, endY = 190.dp.toPx())
    val bottomBand = Brush.verticalGradient(listOf(clear, Ink.copy(alpha = 0.60f)),
        startY = size.height - 320.dp.toPx(), endY = size.height)
    onDrawBehind {
        val previous = animation.previous
        val current = animation.current
        val mix = animation.mix
        drawRect(Ink.copy(alpha = ambientVeil(previous, current, mix)))
        if (bands) {
            drawRect(topBand)
            drawRect(bottomBand)
        }
    }
}

private fun Modifier.ambientResolution(): Modifier = layout { measurable, constraints ->
    val width = constraints.maxWidth
    val height = constraints.maxHeight
    if (width == 0 || height == 0) {
        layout(width, height) {}
    } else {
        val scale = ambientRenderScale(width, height, density)
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

@Composable
private fun AmbientLayers(texture: LightTexture, animation: AmbientAnimation, fadeIn: Boolean) {
    BoxWithConstraints(Modifier.fillMaxSize().graphicsLayer {
        alpha = if (fadeIn) animation.mix else 1f
        if (fadeIn) compositingStrategy = CompositingStrategy.Offscreen
    }, contentAlignment = Alignment.Center) {
        val diagonal = hypot(maxWidth.value, maxHeight.value)
        for (layer in 0..1) {
            val bitmap = if (layer == 0) texture.first else texture.second
            Image(remember(bitmap) { bitmap.asImageBitmap() }, null,
                Modifier.requiredSize(AmbientLightLayers.side(diagonal, layer).dp).graphicsLayer {
                    val motion = AmbientLightLayers.motion(layer, animation.phase, size.width)
                    rotationZ = motion.rotationDegrees
                    scaleX = motion.scale
                    scaleY = motion.scale
                    translationX = motion.x
                    translationY = motion.y
                    alpha = motion.alpha
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
