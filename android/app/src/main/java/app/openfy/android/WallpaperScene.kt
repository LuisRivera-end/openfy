package app.openfy.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.HardwareRenderer
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderNode
import android.os.Build
import android.view.Surface
import androidx.annotation.RequiresApi
import androidx.compose.ui.graphics.toArgb
import app.openfy.android.ui.AmbientLightLayers
import app.openfy.android.ui.AmbientShader
import app.openfy.android.ui.Ink
import app.openfy.android.ui.LightTexture
import app.openfy.android.ui.ambientRenderScale
import app.openfy.android.ui.ambientVeil
import kotlin.math.roundToInt

/** One frame of the wallpaper: the ambient light between two covers, and the cover card on top. */
internal class WallpaperFrame(
    val previous: LightTexture,
    val current: LightTexture,
    val previousCover: Bitmap?,
    val cover: Bitmap?,
    val mix: Float,
    val phase: Float,
    val screen: WallpaperScreen
)

/**
 * Draws [WallpaperFrame]s into the engine surface with the platform renderer, so API 33+ runs the same
 * AGSL as the expanded player and API 29–32 the same two light layers. [release] frees the surface
 * synchronously, which lets a video decoder connect to it.
 */
internal class WallpaperScene(private val density: Float) {
    private val renderer = HardwareRenderer().apply { setName("OpenfyWallpaper"); isOpaque = true }
    private val root = RenderNode("wallpaper")
    private val ambient = RenderNode("ambient")
    private val card = RenderNode("cover")
    private val shader = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        runCatching { AmbientShader() }.getOrNull()
    } else null
    private var shaderArtwork: Pair<LightTexture, LightTexture>? = null
    private val layerPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val coverPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val coverOutline = Outline()
    private val coverBoundsRect = Rect()
    private val targetRectF = RectF()
    private val coverSrcRect = Rect()
    private val prevCoverSrcRect = Rect()
    private var surface: Surface? = null
    private var width = 0
    private var height = 0
    var framesDrawn = 0L
        private set

    val usesShader: Boolean get() = shader != null

    fun attach(target: Surface, width: Int, height: Int) {
        this.width = width
        this.height = height
        if (surface === target) return
        surface = target
        renderer.setContentRoot(root)
        renderer.setSurface(target)
        renderer.setLightSourceGeometry(width / 2f, 0f, 600f * density, 800f * density)
        renderer.setLightSourceAlpha(0.2f, 0.45f)
    }

    fun resize(width: Int, height: Int) {
        this.width = width
        this.height = height
        surface?.let { renderer.setLightSourceGeometry(width / 2f, 0f, 600f * density, 800f * density) }
    }

    val attached: Boolean get() = surface != null

    /** Disconnects from the surface before this returns. */
    fun release() {
        if (surface == null) return
        surface = null
        renderer.destroy()
    }

    fun draw(frame: WallpaperFrame, waitForPresent: Boolean = false) {
        if (surface == null || width <= 0 || height <= 0) return
        val canvas = root.beginRecording(width, height)
        try {
            root.setPosition(0, 0, width, height)
            drawAmbient(canvas, frame)
            canvas.drawColor(Ink.copy(alpha = ambientVeil(frame.previous, frame.current, frame.mix)).toArgb())
            drawCover(canvas, frame)
            if (frame.screen == WallpaperScreen.HOME) canvas.drawColor(Color.argb((255 * HomeDim).roundToInt(), 0, 0, 0))
        } finally {
            root.endRecording()
        }
        renderer.createRenderRequest().setVsyncTime(System.nanoTime()).setWaitForPresent(waitForPresent).syncAndDraw()
        framesDrawn++
    }

    private fun drawAmbient(canvas: Canvas, frame: WallpaperFrame) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && shader != null) {
            drawShader(canvas, frame, shader)
            return
        }
        // Two light layers at full size, as the composable fallback draws them.
        val fading = frame.previous !== frame.current
        if (fading) AmbientLightLayers.draw(canvas, frame.previous, width.toFloat(), height.toFloat(), frame.phase, 1f, layerPaint)
        AmbientLightLayers.draw(canvas, frame.current, width.toFloat(), height.toFloat(), frame.phase,
            if (fading) frame.mix else 1f, layerPaint)
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun drawShader(canvas: Canvas, frame: WallpaperFrame, shader: AmbientShader) {
        val artwork = frame.previous to frame.current
        if (shaderArtwork != artwork) {
            shader.setArtwork(frame.previous, frame.current)
            shaderArtwork = artwork
        }
        // Low-resolution offscreen layer scaled to the surface, like Modifier.ambientResolution().
        val scale = ambientRenderScale(width, height, density)
        val renderWidth = (width * scale).roundToInt().coerceAtLeast(1)
        val renderHeight = (height * scale).roundToInt().coerceAtLeast(1)
        ambient.setPosition(0, 0, renderWidth, renderHeight)
        ambient.setUseCompositingLayer(true, null)
        ambient.pivotX = 0f
        ambient.pivotY = 0f
        ambient.scaleX = width.toFloat() / renderWidth
        ambient.scaleY = height.toFloat() / renderHeight
        val layer = ambient.beginRecording(renderWidth, renderHeight)
        try {
            shader.draw(layer, renderWidth.toFloat(), renderHeight.toFloat(), frame.phase, frame.mix)
        } finally {
            ambient.endRecording()
        }
        canvas.drawRenderNode(ambient)
    }

    private fun drawCover(canvas: Canvas, frame: WallpaperFrame) {
        val cover = frame.cover ?: return
        coverBounds(width, height, density, coverBoundsRect)
        val radius = CoverRadiusDp * density
        card.setPosition(coverBoundsRect)
        card.elevation = CoverElevationDp * density
        card.ambientShadowColor = Color.BLACK
        card.spotShadowColor = Color.BLACK
        coverOutline.setRoundRect(0, 0, coverBoundsRect.width(), coverBoundsRect.height(), radius)
        card.setOutline(coverOutline)
        card.clipToOutline = true
        val inner = card.beginRecording(coverBoundsRect.width(), coverBoundsRect.height())
        try {
            targetRectF.set(0f, 0f, coverBoundsRect.width().toFloat(), coverBoundsRect.height().toFloat())
            val previous = frame.previousCover
            if (previous != null && previous !== cover && frame.mix < 1f) {
                coverPaint.alpha = 255
                centerCrop(previous, prevCoverSrcRect)
                inner.drawBitmap(previous, prevCoverSrcRect, targetRectF, coverPaint)
                coverPaint.alpha = (255 * frame.mix).roundToInt()
            } else {
                coverPaint.alpha = 255
            }
            centerCrop(cover, coverSrcRect)
            inner.drawBitmap(cover, coverSrcRect, targetRectF, coverPaint)
        } finally {
            card.endRecording()
        }
        canvas.drawRenderNode(card)
    }

    fun destroy() {
        surface = null
        renderer.destroy()
        root.discardDisplayList()
        ambient.discardDisplayList()
        card.discardDisplayList()
    }

    companion object {
        /** Dims the home screen version so icons and widgets keep their contrast. */
        const val HomeDim = 0.45f
        private const val CoverRadiusDp = 16f
        private const val CoverElevationDp = 24f
        private const val GutterDp = 24f

        /** The whole cover, as large as the width allows, slightly above center to clear the shortcuts. */
        fun coverBounds(width: Int, height: Int, density: Float): Rect =
            coverBounds(width, height, density, Rect())

        fun coverBounds(width: Int, height: Int, density: Float, out: Rect): Rect {
            val side = minOf(width - 2 * GutterDp * density, height * 0.5f).roundToInt().coerceAtLeast(1)
            val left = (width - side) / 2
            val top = (height * 0.47f - side / 2f).roundToInt()
            out.set(left, top, left + side, top + side)
            return out
        }

        private fun centerCrop(bitmap: Bitmap, out: Rect): Rect {
            val side = minOf(bitmap.width, bitmap.height)
            val left = (bitmap.width - side) / 2
            val top = (bitmap.height - side) / 2
            out.set(left, top, left + side, top + side)
            return out
        }
    }
}
