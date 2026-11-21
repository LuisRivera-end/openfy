package app.openfy.android

import android.app.KeyguardManager
import android.app.WallpaperColors
import android.app.wallpaper.WallpaperDescription
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.provider.Settings
import android.service.wallpaper.WallpaperService
import android.view.Choreographer
import android.view.SurfaceHolder
import androidx.annotation.RequiresApi
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import app.openfy.android.data.Song
import app.openfy.android.playback.PlaybackService
import app.openfy.android.ui.AMBIENT
import app.openfy.android.ui.AmbientPhoneMotion
import app.openfy.android.ui.ArtworkUrls
import app.openfy.android.ui.Effects
import app.openfy.android.ui.Ink
import app.openfy.android.ui.LightTexture
import app.openfy.android.ui.Motion
import app.openfy.android.ui.MotionVideo
import app.openfy.android.ui.Surface
import app.openfy.android.ui.ambientFade
import app.openfy.android.ui.ambientTexture
import app.openfy.android.ui.isMotionDecodingError
import app.openfy.android.ui.motionArtist
import app.openfy.android.ui.neutralLightTexture
import app.openfy.android.ui.readArtwork
import java.io.FileDescriptor
import java.io.IOException
import java.io.PrintWriter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * «Fondo animado de Openfy». Paints the current song with the expanded player's ambient light and, on the
 * lock screen, its Motion cover when one is already cached. It reads playback from the process
 * ([OpenfyApplication.nowPlaying]), never starts playback and makes no network requests of its own.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class OpenfyWallpaperService : WallpaperService() {
    private val app get() = application as OpenfyApplication
    private val engines = linkedSetOf<OpenfyEngine>()
    /** Destinations the system asked this process to describe (Android 16+), newest last, for dumpsys. */
    private val applied = ArrayDeque<String>()

    override fun onCreateEngine(): Engine = OpenfyEngine(described = null)

    @RequiresApi(Build.VERSION_CODES.BAKLAVA)
    override fun onCreateEngine(description: WallpaperDescription): Engine =
        OpenfyEngine(WallpaperTarget.of(description.content.getString(TargetKey)))

    override fun dump(fd: FileDescriptor?, out: PrintWriter, args: Array<out String>?) {
        super.dump(fd, out, args)
        out.println()
        out.println("  Openfy applied descriptions: ${applied.joinToString().ifEmpty { "none" }}")
        engines.forEach { it.dump(out) }
    }

    private data class WallpaperSettings(val effects: Boolean = true, val motion: Boolean = true)

    internal inner class OpenfyEngine(private val described: WallpaperTarget?) : Engine() {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        private val density = resources.displayMetrics.density
        private val scene = WallpaperScene(density)
        private val neutral = neutralLightTexture()
        private val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        private val main = Handler(Looper.getMainLooper())
        private val choreographer = Choreographer.getInstance()
        private val coordinator get() = app.motion.playback
        private val lease = Any()

        private var holder: SurfaceHolder? = null
        private var width = 0
        private var height = 0
        private var visible = false
        private var keyguardLocked = true
        private var playing = false
        private var settings = WallpaperSettings()
        private var reducedMotion = false
        private var destroyed = false

        private var song: Song? = null
        private var video: MotionVideo? = null
        private var failedVideo: String? = null
        private var videoLookup: Job? = null
        private var player: ExoPlayer? = null
        private var videoShowing = false
        private var videoFrames = 0L
        private var decoderRetries = 0

        private var previous: LightTexture = neutral
        private var current: LightTexture = neutral
        private var previousCover: Bitmap? = null
        private var cover: Bitmap? = null
        private var mix = 1f
        private var elapsed = AMBIENT.fadeSeconds
        private var phase = 0f

        private var mode = WallpaperMode.IDLE
        private var drawMode = WallpaperMode.IDLE
        private var framePosted = false
        private var lastFrameNanos = 0L
        private var hasDrawn = false
        private var drawnPrevious: LightTexture? = null
        private var drawnCurrent: LightTexture? = null
        private var drawnPreviousCover: Bitmap? = null
        private var drawnCover: Bitmap? = null
        private var drawnScreen: WallpaperScreen? = null
        private var drawnWidth = 0
        private var drawnHeight = 0
        private var updating = false
        private var updateAgain = false

        private val frameCallback = Choreographer.FrameCallback(::onFrame)
        private val ownerListener: (Any?) -> Unit = { update() }
        private val releaseVideo: () -> Unit = {
            stopVideo()
            update()
        }
        private val screenReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                keyguardLocked = when (intent.action) {
                    Intent.ACTION_SCREEN_OFF -> true
                    Intent.ACTION_USER_PRESENT -> false
                    else -> keyguard.isKeyguardLocked
                }
                update()
            }
        }
        private val motionObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                reducedMotion = readReducedMotion()
                update()
            }
        }

        private val target: WallpaperTarget
            get() = WallpaperTarget.resolve(
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) wallpaperFlags else null, described)
        private val screen: WallpaperScreen get() = target.screen(keyguardLocked)

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setOffsetNotificationsEnabled(false)
            engines += this
            reducedMotion = readReducedMotion()
            keyguardLocked = keyguard.isKeyguardLocked
            contentResolver.registerContentObserver(
                Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, motionObserver)
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_USER_PRESENT)
            }
            ContextCompat.registerReceiver(this@OpenfyWallpaperService, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            coordinator.addOwnerListener(ownerListener)
            scope.launch {
                app.nowPlaying.map { it.songId }.distinctUntilChanged().collectLatest { id -> showSong(id ?: lastQueuedSong()) }
            }
            scope.launch {
                app.nowPlaying.map { it.playing }.distinctUntilChanged().collect {
                    playing = it
                    update()
                }
            }
            scope.launch {
                app.preferences.data.map { WallpaperSettings(it[Effects] ?: true, it[Motion] ?: true) }
                    .catch { if (it !is IOException) throw it }
                    .distinctUntilChanged().collect {
                        settings = it
                        update()
                    }
            }
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            this.holder = holder
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            this.holder = holder
            this.width = width
            this.height = height
            scene.resize(width, height)
            update()
        }

        override fun onSurfaceRedrawNeeded(holder: SurfaceHolder) {
            super.onSurfaceRedrawNeeded(holder)
            if (player == null) drawFrame(waitForPresent = true)
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            this.holder = null
            resetDrawnFrame()
            stopLoop()
            coordinator.detach(lease, releaseVideo)
            coordinator.cancel(lease)
            scene.release()
            super.onSurfaceDestroyed(holder)
        }

        override fun onVisibilityChanged(visible: Boolean) {
            this.visible = visible
            if (visible) {
                keyguardLocked = keyguard.isKeyguardLocked
                // The app may have cached a Motion cover since the last look.
                if (video == null && song != null && videoLookup?.isActive != true) {
                    videoLookup = scope.launch { resolveVideo() }
                }
            }
            update()
        }

        @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
        override fun onWallpaperFlagsChanged(which: Int) {
            super.onWallpaperFlagsChanged(which)
            update()
        }

        @RequiresApi(Build.VERSION_CODES.BAKLAVA)
        override fun onApplyWallpaper(which: Int): WallpaperDescription? {
            val chosen = WallpaperTarget.fromFlags(which) ?: return null
            applied.addLast(chosen.id)
            if (applied.size > 4) applied.removeFirst()
            return WallpaperDescription.Builder()
                .setId("openfy-${chosen.id}")
                .setTitle(getString(R.string.wallpaper_label))
                .setDescription(listOf(getString(
                    if (chosen == WallpaperTarget.HOME) R.string.wallpaper_home_summary else R.string.wallpaper_lock_summary)))
                .setContent(PersistableBundle().apply { putString(TargetKey, chosen.id) })
                .build()
        }

        /** Fixed neutral colors: changing them per song would re-theme the whole system on every track. */
        override fun onComputeColors(): WallpaperColors {
            val primary = android.graphics.Color.valueOf(Surface.toArgb())
            val secondary = android.graphics.Color.valueOf(Ink.toArgb())
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                WallpaperColors(primary, secondary, secondary, WallpaperColors.HINT_SUPPORTS_DARK_THEME)
            } else WallpaperColors(primary, secondary, secondary)
        }

        override fun onDestroy() {
            destroyed = true
            engines -= this
            main.removeCallbacksAndMessages(null)
            stopLoop()
            scope.cancel()
            coordinator.removeOwnerListener(ownerListener)
            coordinator.cancel(lease)
            stopVideo()
            unregisterReceiver(screenReceiver)
            contentResolver.unregisterContentObserver(motionObserver)
            scene.destroy()
            super.onDestroy()
        }

        private suspend fun showSong(id: String?) {
            val next = id?.let { withContext(Dispatchers.IO) { app.database.library().song(it) } }
            if (next != null && next == song) return
            videoLookup?.cancel()
            song = next
            video = null
            failedVideo = null
            decoderRetries = 0
            val bitmap = next?.artwork?.let { loadCover(it) }
            if (song !== next) return
            setArtwork(bitmap?.let { ambientTexture(it) } ?: neutral, bitmap)
            videoLookup = scope.launch { resolveVideo() }
        }

        private suspend fun loadCover(source: String): Bitmap? {
            val large = ArtworkUrls.sized(source, CoverPx)
            val candidates = sequenceOf(large, ArtworkUrls.sized(source, 512), ArtworkUrls.sized(source, 256),
                ArtworkUrls.sized(source, 128), source, large?.let(ArtworkUrls::fallback)).filterNotNull().distinct()
            return try {
                readArtwork(this@OpenfyWallpaperService, candidates, CoverPx, offline = true)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                null
            }
        }

        private suspend fun resolveVideo() {
            val song = song ?: return
            if (song.album.isBlank() || song.artist.isBlank()) return
            val found = try {
                app.motion.resolve(song.motionArtist(), song.album, allowNetwork = false).video
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                null
            }
            if (this.song === song && found != video) {
                video = found
                update()
            }
        }

        private suspend fun lastQueuedSong(): String? = try {
            val saved = app.preferences.data.first()[PlaybackService.SNAPSHOT]
            saved?.let { Json.parseToJsonElement(it).jsonObject }?.let { data ->
                val queue = data.getValue("queue").jsonArray
                val index = data["index"]?.jsonPrimitive?.intOrNull ?: 0
                queue.getOrNull(index.coerceIn(0, (queue.size - 1).coerceAtLeast(0)))?.jsonPrimitive?.contentOrNull
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }

        private fun setArtwork(texture: LightTexture, bitmap: Bitmap?) {
            if (texture === current && bitmap === cover) return
            // Fade only while the light is moving, as the expanded player does.
            val instant = drawMode != WallpaperMode.AMBIENT || current === neutral || texture === neutral
            previous = if (instant) texture else current
            previousCover = if (instant) bitmap else cover
            current = texture
            cover = bitmap
            elapsed = if (instant) AMBIENT.fadeSeconds else 0.0
            mix = if (instant) 1f else 0f
            update()
        }

        private fun readReducedMotion() =
            Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

        private fun update() {
            if (destroyed) return
            if (updating) {
                updateAgain = true
                return
            }
            updating = true
            try {
                do {
                    updateAgain = false
                    reconcile()
                } while (updateAgain)
            } finally {
                updating = false
            }
        }

        private fun reconcile() {
            val ambientAllowed = settings.effects && !reducedMotion
            val input = WallpaperInputs(
                visible = visible && holder != null && width > 0,
                playing = playing,
                screen = screen,
                ambientAllowed = ambientAllowed,
                motionAllowed = ambientAllowed && settings.motion,
                hasCover = cover != null,
                hasVideo = video?.let { it.url != failedVideo } == true,
                videoAttached = player != null
            )
            mode = wallpaperMode(input)
            if (mode == WallpaperMode.VIDEO) {
                coordinator.request(lease, MotionPriority)
                if (coordinator.owner === lease) {
                    if (player == null) startVideo() else player?.playWhenReady = playing
                }
            } else {
                // Releases our decoder through releaseVideo when we own it.
                coordinator.cancel(lease)
                stopVideo()
            }
            drawMode = when {
                player != null -> WallpaperMode.VIDEO
                mode == WallpaperMode.VIDEO -> wallpaperMode(input.copy(hasVideo = false, videoAttached = false))
                else -> mode
            }
            when (drawMode) {
                WallpaperMode.AMBIENT -> startLoop()
                WallpaperMode.STILL -> {
                    stopLoop()
                    // Paused keeps the last frame: redraw only when what it shows has changed.
                    if (!isFrameDrawn()) drawFrame()
                }
                else -> stopLoop()
            }
        }

        private fun isFrameDrawn(): Boolean =
            hasDrawn && drawnPrevious === previous && drawnCurrent === current &&
            drawnPreviousCover === previousCover && drawnCover === cover &&
            drawnScreen == screen && drawnWidth == width && drawnHeight == height

        private fun recordDrawnFrame() {
            hasDrawn = true
            drawnPrevious = previous
            drawnCurrent = current
            drawnPreviousCover = previousCover
            drawnCover = cover
            drawnScreen = screen
            drawnWidth = width
            drawnHeight = height
        }

        private fun resetDrawnFrame() {
            hasDrawn = false
            drawnPrevious = null
            drawnCurrent = null
            drawnPreviousCover = null
            drawnCover = null
            drawnScreen = null
            drawnWidth = 0
            drawnHeight = 0
        }

        private fun drawFrame(waitForPresent: Boolean = false) {
            val surface = holder?.surface?.takeIf { it.isValid } ?: return
            if (player != null || width <= 0 || height <= 0) return
            scene.attach(surface, width, height)
            scene.draw(WallpaperFrame(previous, current, previousCover, cover, mix, phase, screen), waitForPresent)
            recordDrawnFrame()
        }

        private fun startLoop() {
            if (framePosted) return
            framePosted = true
            lastFrameNanos = 0L
            choreographer.postFrameCallback(frameCallback)
        }

        private fun stopLoop() {
            if (!framePosted) return
            framePosted = false
            choreographer.removeFrameCallback(frameCallback)
        }

        private fun onFrame(frameTimeNanos: Long) {
            framePosted = false
            if (drawMode != WallpaperMode.AMBIENT) return
            val seconds = if (lastFrameNanos == 0L) 0.0 else (frameTimeNanos - lastFrameNanos) / 1e9
            lastFrameNanos = frameTimeNanos
            phase += (seconds.coerceAtMost(0.1) * AMBIENT.motionSpeed * AmbientPhoneMotion).toFloat()
            if (mix < 1f) {
                elapsed += seconds
                mix = ambientFade(elapsed).toFloat()
                if (mix >= 1f) {
                    previous = current
                    previousCover = cover
                }
            }
            drawFrame()
            framePosted = true
            // About 30 FPS, aligned to vsync, like the expanded player's loop.
            choreographer.postFrameCallbackDelayed(frameCallback, FrameDelayMs)
        }

        private fun startVideo() {
            val video = video ?: return
            val surface = holder?.surface?.takeIf { it.isValid } ?: return
            if (!coordinator.prepareReplacement(lease)) return
            stopLoop()
            // The decoder can only connect once the renderer has let go of the surface.
            scene.release()
            resetDrawnFrame()
            val selector = app.motion.decoderSelector(video.maxEdge)
            val renderers = DefaultRenderersFactory(app)
                .setEnableDecoderFallback(true)
                .setMediaCodecSelector(selector)
            val engine = ExoPlayer.Builder(app, renderers).build()
            player = engine
            engine.addListener(object : Player.Listener {
                override fun onRenderedFirstFrame() { videoShowing = true }
                override fun onPlayerError(error: PlaybackException) {
                    // Stay still until another decoder is known to exist; release outside the player's callback.
                    failedVideo = video.url
                    main.post { coordinator.detach(lease, releaseVideo) }
                    if (error.isMotionDecodingError && decoderRetries < MaxDecoderRetries) scope.launch {
                        decoderRetries++
                        // Shares the app's learned decoder policy, so both skip a decoder that failed here.
                        if (app.motion.retryWithAnotherDecoder(video, selector, error) && this@OpenfyEngine.video == video) {
                            failedVideo = null
                            update()
                        }
                    }
                }
            })
            coordinator.attach(lease, releaseVideo)
            if (player !== engine) return
            engine.volume = 0f
            engine.repeatMode = Player.REPEAT_MODE_ONE
            engine.setAudioAttributes(AudioAttributes.DEFAULT, false)
            engine.trackSelectionParameters = engine.trackSelectionParameters.buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .setMaxVideoFrameRate(30)
                .build()
            engine.setVideoSurface(surface)
            // Full screen, like Apple Music's lock screen: the square video is cropped to the surface.
            engine.videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
            engine.setMediaSource(HlsMediaSource.Factory(app.motion.videoFactory(allowNetwork = false))
                .createMediaSource(MediaItem.fromUri(video.url)))
            engine.playWhenReady = playing
            engine.prepare()
        }

        private fun stopVideo() {
            val engine = player ?: return
            player = null
            videoShowing = false
            videoFrames += engine.videoDecoderCounters?.renderedOutputBufferCount?.toLong() ?: 0L
            engine.clearVideoSurface()
            engine.release()
        }

        fun dump(out: PrintWriter) {
            val decoded = videoFrames + (player?.videoDecoderCounters?.renderedOutputBufferCount ?: 0)
            out.println("  Openfy engine ${Integer.toHexString(System.identityHashCode(this))}: preview=$isPreview " +
                "described=${described?.id} target=$target screen=$screen visible=$visible playing=$playing mode=$mode drawing=$drawMode " +
                "song=${song != null} cover=${cover != null} video=${video != null} decoder=${player != null} " +
                "videoShowing=$videoShowing shader=${scene.usesShader} reducedMotion=$reducedMotion " +
                "frames=${scene.framesDrawn} videoFrames=$decoded")
        }
    }

    companion object {
        internal const val TargetKey = "openfy.target"
        /** Below every in-app Motion surface: the app's own artwork always wins the decoder. */
        private const val MotionPriority = -1
        private const val CoverPx = 1024
        private const val FrameDelayMs = 25L
        private const val MaxDecoderRetries = 3
    }
}
