package app.openfy.android.ui

import android.content.Context
import android.graphics.Matrix
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.view.TextureView
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import app.openfy.android.OpenfyApplication
import app.openfy.android.preferences
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

private val LocalMotionPriority = compositionLocalOf { 0 }

/** Hands the decoder over synchronously before publishing a new owner. Main thread only. */
internal class MotionPlaybackCoordinator {
    private val requests = linkedMapOf<Any, Int>()
    private var release: (() -> Unit)? = null
    var owner by mutableStateOf<Any?>(null)
        private set

    fun request(key: Any, priority: Int) {
        requests[key] = priority
        select()
    }

    fun cancel(key: Any) {
        requests.remove(key)
        select()
    }

    fun prepareReplacement(key: Any): Boolean {
        if (owner !== key) return false
        releasePlayer()
        return true
    }

    fun attach(key: Any, onRelease: () -> Unit) {
        if (owner !== key) {
            onRelease()
            return
        }
        releasePlayer()
        release = onRelease
    }

    fun detach(key: Any, onRelease: () -> Unit) {
        if (owner === key && release === onRelease) releasePlayer()
    }

    private fun select() {
        val next = requests.maxByOrNull { it.value }?.key
        if (owner === next) return
        releasePlayer()
        owner = next
    }

    private fun releasePlayer() {
        val action = release
        release = null
        action?.invoke()
    }
}

/** The expanded dialog also covers the album behind it while showing lyrics or the queue. */
@Composable
internal fun ExpandedMotionArtworkScope(content: @Composable () -> Unit) {
    val app = LocalContext.current.applicationContext as OpenfyApplication
    val playback = app.motion.playback
    val key = remember { Any() }
    LifecycleStartEffect(key) {
        playback.request(key, 1)
        onStopOrDispose { playback.cancel(key) }
    }
    CompositionLocalProvider(LocalMotionPriority provides 2, content = content)
}

@Composable
internal fun MotionArtwork(
    artist: String?,
    album: String?,
    fallback: String?,
    playing: Boolean,
    modifier: Modifier,
    shape: Shape
) {
    val app = LocalContext.current.applicationContext as OpenfyApplication
    val repository = app.motion
    val playback = repository.playback
    val priority = LocalMotionPriority.current
    val reducedMotion = rememberReducedMotion()
    val preferenceFlow = remember(app) {
        app.preferences.data.map { (it[Effects] ?: true) && (it[Motion] ?: true) }.distinctUntilChanged()
    }
    val enabled by preferenceFlow.collectAsStateWithLifecycle(initialValue = false)
    var onScreen by remember { mutableStateOf(false) }
    val lease = remember { Any() }
    val eligible = enabled && !reducedMotion && onScreen && !artist.isNullOrBlank() && !album.isNullOrBlank()
    LifecycleStartEffect(lease, eligible, priority) {
        if (eligible) playback.request(lease, priority)
        onStopOrDispose { playback.cancel(lease) }
    }

    Box(modifier.clip(shape).onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInWindow()
        onScreen = bounds.width > 0f && bounds.height > 0f
    }) {
        Cover(fallback, Modifier.matchParentSize(), sizePx = 1024)
        if (eligible && playback.owner === lease) {
            key(artist, album) {
                MotionVideoLayer(app, repository, lease, artist, album, playing, Modifier.matchParentSize(), shape)
            }
        }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
private fun MotionVideoLayer(
    app: OpenfyApplication,
    repository: MotionRepository,
    lease: Any,
    artist: String,
    album: String,
    playing: Boolean,
    modifier: Modifier,
    shape: Shape
) {
    val network = remember(app) { app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    val changes = remember(network) {
        callbackFlow {
            fun refresh() { trySend(!network.isActiveNetworkMetered) }
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = refresh()
                override fun onLost(network: Network) = refresh()
            }
            network.registerDefaultNetworkCallback(callback)
            refresh()
            awaitClose { network.unregisterNetworkCallback(callback) }
        }.distinctUntilChanged()
    }
    val networkUnmetered by changes.collectAsStateWithLifecycle(initialValue = !network.isActiveNetworkMetered)
    // Debug QA only: emulators expose a metered cellular link, so design captures may treat it as unmetered.
    val qaUnmetered = app.isDebuggable && app.qaUnmetered
    val unmetered = networkUnmetered || qaUnmetered
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    key(unmetered) {
        val errors = remember { Channel<MotionVideoFailure>(Channel.CONFLATED) }
        val attempt by produceState<MotionAttempt?>(null, lifecycle) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                var replacement: MotionVideo? = null
                while (true) {
                    val result = replacement?.let { MotionLookup(it) } ?: repository.resolve(artist, album, unmetered)
                    replacement = null
                    val current = result.video?.let { MotionAttempt(it, repository.decoderSelector(it.maxEdge)) }
                    value = current
                    if (current != null) {
                        var error = errors.receive()
                        while (error.attempt !== current) error = errors.receive()
                        value = null
                        val allowNetwork = unmetered && (!network.isActiveNetworkMetered || qaUnmetered)
                        if (error.isDecodingError) {
                            replacement = if (repository.retryWithAnotherDecoder(current.video, current.selector, error.cause)) current.video
                                else repository.smallerVideo(artist, album, current.video, allowNetwork)
                            if (replacement != null) continue
                        }
                        if (!allowNetwork) return@repeatOnLifecycle
                        waitForMotionRetry(repository.videoFailed(artist, album, current.video))
                    } else {
                        val retry = result.retryAt ?: return@repeatOnLifecycle
                        waitForMotionRetry(retry)
                    }
                }
            }
        }
        attempt?.let { loaded ->
            key(loaded) {
                MotionTexture(repository, lease, loaded, unmetered, playing, modifier, shape,
                    onError = { errors.trySend(MotionVideoFailure(loaded, it)) })
            }
        }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
private class MotionAttempt(val video: MotionVideo, val selector: MediaCodecSelector)

private data class MotionVideoFailure(val attempt: MotionAttempt, val cause: PlaybackException) {
    val isDecodingError: Boolean
        get() = when (cause.errorCode) {
            PlaybackException.ERROR_CODE_DECODING_FAILED,
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> true
            else -> false
        }
}

private suspend fun waitForMotionRetry(at: Long) = delay((at - System.currentTimeMillis()).coerceAtLeast(1_000L))

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
private fun MotionTexture(
    repository: MotionRepository,
    lease: Any,
    attempt: MotionAttempt,
    allowNetwork: Boolean,
    playing: Boolean,
    modifier: Modifier,
    shape: Shape,
    onError: (PlaybackException) -> Unit
) {
    val video = attempt.video
    val context = LocalContext.current
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val latestPlaying by rememberUpdatedState(playing)
    val latestOnError by rememberUpdatedState(onError)
    var player by remember(video) { mutableStateOf<ExoPlayer?>(null) }
    var firstFrame by remember(video) { mutableStateOf(false) }
    var videoSize by remember(video) { mutableStateOf(VideoSize(video.width, video.height)) }
    DisposableEffect(repository, lease, video, allowNetwork) {
        if (!repository.playback.prepareReplacement(lease)) return@DisposableEffect onDispose {}
        val renderers = DefaultRenderersFactory(context)
            .setEnableDecoderFallback(true)
            .setMediaCodecSelector(attempt.selector)
        val engine = ExoPlayer.Builder(context, renderers).build()
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() { firstFrame = true }
            override fun onVideoSizeChanged(size: VideoSize) { videoSize = size }
            override fun onPlayerError(error: PlaybackException) {
                firstFrame = false
                latestOnError(error)
            }
        }
        engine.addListener(listener)
        player = engine
        val release = {
            engine.removeListener(listener)
            engine.release()
            firstFrame = false
            player = null
        }
        repository.playback.attach(lease, release)
        if (repository.playback.owner === lease) {
            engine.volume = 0f
            engine.repeatMode = Player.REPEAT_MODE_ONE
            engine.setAudioAttributes(AudioAttributes.DEFAULT, false)
            engine.trackSelectionParameters = engine.trackSelectionParameters.buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .setMaxVideoFrameRate(30)
                .build()
            engine.setMediaSource(HlsMediaSource.Factory(repository.videoFactory(allowNetwork))
                .createMediaSource(MediaItem.fromUri(video.url)))
            engine.playWhenReady = latestPlaying
            engine.prepare()
        }
        onDispose { repository.playback.detach(lease, release) }
    }
    LaunchedEffect(player, playing) { player?.playWhenReady = playing }

    val alpha by animateFloatAsState(if (firstFrame) 1f else 0f,
        if (playing && firstFrame) tween(280) else snap(), label = "motion first frame")
    player?.let { engine ->
        AndroidView(
            factory = { MotionVideoView(it).apply { engine.setVideoTextureView(texture) } },
            update = { it.update(shape, density, layoutDirection, videoSize) },
            modifier = modifier.graphicsLayer { this.alpha = alpha }
        )
    }
}

/** A texture participates in clipping on API 29 as well as newer versions. */
private class MotionVideoView(context: Context) : FrameLayout(context) {
    val texture = TextureView(context).also { addView(it, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }
    private var artworkShape: Shape? = null
    private var artworkDensity: Density? = null
    private var artworkDirection = LayoutDirection.Ltr
    private var videoSize = VideoSize.UNKNOWN

    init {
        clipToOutline = true
        texture.isOpaque = false
        isClickable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: android.graphics.Outline) {
                val density = artworkDensity ?: return
                when (val shape = artworkShape?.createOutline(Size(view.width.toFloat(), view.height.toFloat()), artworkDirection, density)) {
                    is Outline.Rectangle -> outline.setRect(0, 0, view.width, view.height)
                    is Outline.Rounded -> outline.setRoundRect(0, 0, view.width, view.height, shape.roundRect.topLeftCornerRadius.x)
                    else -> Unit
                }
            }
        }
    }

    fun update(shape: Shape, density: Density, direction: LayoutDirection, size: VideoSize) {
        if (artworkShape != shape || artworkDensity != density || artworkDirection != direction) {
            artworkShape = shape
            artworkDensity = density
            artworkDirection = direction
            invalidateOutline()
        }
        if (videoSize != size) {
            videoSize = size
            crop()
        }
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        invalidateOutline()
        crop()
    }

    private fun crop() {
        if (width == 0 || height == 0 || videoSize.width == 0 || videoSize.height == 0) return
        val viewAspect = width.toFloat() / height
        val videoAspect = videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height
        texture.setTransform(Matrix().apply {
            setScale((videoAspect / viewAspect).coerceAtLeast(1f), (viewAspect / videoAspect).coerceAtLeast(1f), width / 2f, height / 2f)
        })
    }
}
