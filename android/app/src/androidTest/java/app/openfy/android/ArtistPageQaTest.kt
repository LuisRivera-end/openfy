package app.openfy.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.datastore.preferences.core.edit
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.openfy.android.data.Song
import app.openfy.android.ui.DetailState
import app.openfy.android.ui.Motion
import app.openfy.android.ui.OpenfyViewModel
import app.openfy.android.ui.SearchState
import app.openfy.android.ui.artistTheme
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File
import kotlin.math.abs

/** Captures Android's actual artist UI using local artwork and catalog data. Run with -e artistVisual true. */
class ArtistPageQaTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test fun capturesCustomArtistPagesAndSearch() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("artistVisual") == "true")
        val activity = compose.activity
        val model = ViewModelProvider(activity)[OpenfyViewModel::class.java]
        val prefs = (activity.application as OpenfyApplication).preferences
        val previousMotion = runBlocking { prefs.data.first()[Motion] }
        val captures = File(checkNotNull(activity.getExternalFilesDir(null)), "qa/artist")
        check(captures.isDirectory || captures.mkdirs())
        val fixtureDir = File(activity.cacheDir, "artist-visual-fixture")
        check(fixtureDir.isDirectory || fixtureDir.mkdirs())

        val banner = artwork(fixtureDir, "banner", 960, 540, 0xffffa500.toInt(), 0xffff4466.toInt())
        val portrait = artwork(fixtureDir, "portrait", 480, 480, 0xffb050ff.toInt(), 0xff2462ff.toInt())
        val title = "Los Viajeros de la Medianoche"
        val artistId = "visual-artist-banner"
        val portraitTitle = "Pulso Eléctrico"
        val tracks = (1..7).map { index ->
            Song(
                id = "youtube:visual-$index",
                title = listOf("Luz de neón", "Último tren", "A contraluz", "Mapa de la ciudad", "Alba", "En órbita", "La señal")[index - 1],
                artist = title,
                album = "Bajo el mismo cielo",
                duration = 180_000L + index * 12_000L,
                artwork = portrait.file.path,
                artistId = artistId,
            )
        }
        val profile = DetailState(
            kind = "artist",
            id = artistId,
            title = title,
            subtitle = "Los Viajeros de la Medianoche mezclan sintetizadores nocturnos y guitarras de casa. " +
                "Su sonido nació entre ensayos de madrugada y conciertos pequeños. " +
                "En Bajo el mismo cielo, sus canciones recorren estaciones, azoteas y calles iluminadas por neón.",
            artwork = portrait.file.path,
            banner = banner.file.path,
            songs = tracks,
            albums = listOf(card("visual-release", "Bajo el mismo cielo", banner.file, album = true)),
            artists = listOf(card("visual-related", portraitTitle, portrait.file)),
        )

        try {
            runBlocking { prefs.edit { it[Motion] = false } }
            compose.runOnIdle { model.detail.value = profile }
            compose.onAllNodesWithText(title).onFirst().assertIsDisplayed()
            captureTint(captures, "01-artist-banner", banner.base)

            scrollTo("Canciones populares")
            capture(captures, "02-artist-songs")
            scrollTo("Acerca de")
            capture(captures, "03-artist-about")

            compose.runOnIdle {
                model.selectTab(1)
                model.search.value = SearchState(query = title, kind = "artists", cards = listOf(card(artistId, title, portrait.file)))
            }
            compose.onNodeWithText("Resultado más relevante").assertIsDisplayed()
            compose.onNodeWithContentDescription("Reproducir $title").assertIsDisplayed()
            // The warm header palette wins over the purple search portrait after the page was opened.
            captureTint(captures, "04-artist-search", banner.base)

            compose.runOnIdle {
                model.detail.value = profile.copy(id = "visual-artist-portrait", title = portraitTitle, banner = null)
            }
            compose.onAllNodesWithText(portraitTitle).onFirst().assertIsDisplayed()
            captureTint(captures, "05-artist-portrait", portrait.base)
        } finally {
            compose.runOnIdle {
                model.selectTab(0)
                model.search.value = SearchState()
            }
            runBlocking {
                prefs.edit { values ->
                    if (previousMotion == null) values.remove(Motion) else values[Motion] = previousMotion
                }
            }
            banner.file.delete()
            portrait.file.delete()
        }
    }

    private fun scrollTo(text: String) {
        compose.onAllNodes(hasScrollToIndexAction()).onFirst().performScrollToNode(hasText(text))
        compose.onNodeWithText(text).assertIsDisplayed()
    }

    private fun capture(directory: File, name: String) {
        compose.waitForIdle()
        val shot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        try { write(shot, File(directory, "$name.png")) } finally { shot.recycle() }
    }

    private fun captureTint(directory: File, name: String, base: Int) {
        val path = File(directory, "$name.png")
        compose.waitUntil(timeoutMillis = 10_000) {
            val shot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
            try {
                hasTint(shot, base).also { matches -> if (matches) write(shot, path) }
            } finally {
                shot.recycle()
            }
        }
    }

    private fun hasTint(shot: Bitmap, base: Int): Boolean {
        // Sample the top portion on a sparse grid and allow for image resampling and gradient interpolation.
        val stride = (shot.width / 80).coerceAtLeast(1)
        var matches = 0
        for (y in stride until shot.height * 3 / 4 step stride) {
            for (x in stride until shot.width - stride step stride) {
                val pixel = shot.getPixel(x, y)
                if (abs(Color.red(pixel) - Color.red(base)) <= 12 &&
                    abs(Color.green(pixel) - Color.green(base)) <= 12 &&
                    abs(Color.blue(pixel) - Color.blue(base)) <= 12 && ++matches >= 64) return true
            }
        }
        return false
    }

    private data class Artwork(val file: File, val base: Int)

    private fun artwork(directory: File, name: String, width: Int, height: Int, primary: Int, accent: Int): Artwork {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawColor(primary)
        paint.color = accent
        canvas.drawRect(width * .78f, 0f, width.toFloat(), height.toFloat(), paint)
        // A bright area behind a long title exercises the header scrim at narrow widths.
        paint.color = Color.WHITE
        canvas.drawOval(width * .02f, height * .42f, width * .72f, height * 1.08f, paint)
        val thumbnail = Bitmap.createScaledBitmap(bitmap, 16, 16, true)
        val pixels = IntArray(16 * 16)
        thumbnail.getPixels(pixels, 0, 16, 0, 0, 16, 16)
        thumbnail.recycle()
        val file = File(directory, "$name.png")
        try { write(bitmap, file) } finally { bitmap.recycle() }
        val theme = artistTheme(pixels)
        assertTrue("Fixture $name needs a chromatic palette", !theme.neutral)
        return Artwork(file, Color.parseColor(theme.base))
    }

    private fun card(id: String, title: String, artwork: File, album: Boolean = false) = buildJsonObject {
        put("id", id)
        put(if (album) "title" else "name", title)
        put("artwork", artwork.path)
        if (album) put("year", 2026)
    }

    private fun write(bitmap: Bitmap, file: File) {
        file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}
