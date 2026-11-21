package app.openfy.android

import android.graphics.Bitmap
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.datastore.preferences.core.edit
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.openfy.android.ui.Motion
import app.openfy.android.ui.OpenfyViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File
import kotlin.math.abs

/** Drives the debug app through Compose while the native provider fetches the real catalog. */
class ArtistExitQaTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val app get() = compose.activity.application as OpenfyApplication
    private val model by lazy { ViewModelProvider(compose.activity)[OpenfyViewModel::class.java] }
    private val title = InstrumentationRegistry.getArguments().getString("artistExitArtist") ?: "Rauw Alejandro"
    private val query = if (title == "Rauw Alejandro") "Rauw" else title
    private val usePaletteFixture = InstrumentationRegistry.getArguments().getString("artistExitPaletteFixture") == "true"
    private val paletteFile by lazy { File(app.cacheDir, "artist-exit-palette.jpg") }
    private val process = Process.myPid()
    private var motionObserved = false
    private val searchField = hasSetTextAction() and hasContentDescription("¿Qué quieres escuchar?")
    private val clearSearch = hasContentDescription("Borrar búsqueda")
    private val back = hasContentDescription("Volver")
    private val progress = SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)
    private val pageList = hasScrollToIndexAction() and
        SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)

    @Test fun artistExitsKeepTheAppResponsive() = withMotionEnabled {
        openArtist(checkMotion = true)
        selectTab("Inicio")
        settled("Inicio", 75_000) {
            model.tab.value == 0 && model.detail.value == null && model.library.value.ready &&
                !model.recommendationsLoading.value && (
                    visible(hasText("Empieza con tu música")) ||
                        visible(hasText("Sugerencias para ti")) ||
                        visible(hasText("Escuchado recientemente")) ||
                        visible(hasText("Tus favoritas y playlists")) ||
                        model.library.value.homePlaylists.any { visible(hasText(it.title)) }
                    )
        }

        selectTab("Buscar")
        waitFor("Buscar conserva «$query»") { visible(searchField and editableText(query)) }
        click(searchField, "campo de búsqueda")
        click(clearSearch, "X de Buscar")
        settled("Borrar búsqueda", 10_000) {
            val search = model.search.value
            search.query.isEmpty() && !search.pending && !search.loading &&
                search.songs.isEmpty() && search.cards.isEmpty() &&
                visible(searchField and editableText("")) && !visible(clearSearch) &&
                visible(hasText("Escribe el nombre de una canción, artista o álbum."))
        }
        capture("test-busqueda-vacia")

        openArtist(checkMotion = true)
        selectTab("Biblioteca")
        checkLibrary()

        openArtist(checkMotion = true)
        selectTab("Descargas")
        settled("Descargas", 10_000) {
            model.tab.value == 3 && model.detail.value == null &&
                (visible(hasText("Aún no tienes descargas")) ||
                    visible(hasText(" MB", substring = true)))
        }

        openArtist(checkMotion = true)
        selectTab("Biblioteca")
        checkLibrary()
        click(hasText("Más reproducidas") and hasClickAction(), "fila Más reproducidas")
        settled("Más reproducidas", 10_000) {
            model.detail.value?.let { it.kind == "top" && !it.loading } == true &&
                visible(hasText("Más reproducidas")) && visible(hasText("minutos escuchados"))
        }

        openArtist(checkMotion = true)
        val release = latestRelease()
        clickRelease(release)
        checkAlbum(release)
        capture("test-album")
        click(back, "Volver del álbum")
        settled("Volver del álbum", 10_000) {
            model.detail.value?.let { it.kind == "artist" && !it.loading } == true &&
                visible(back) && (visible(hasText("Último lanzamiento")) || visible(hasText("Canciones populares")))
        }
        capture("test-artista-restaurado")
    }

    @Test fun artistPaginationRecoversAfterOpeningAnAlbum() {
        val fixture = InstrumentationRegistry.getArguments().getString("artistExitPaginationFixture") == "true"
        if (fixture) assertEquals("artist-exit-pagination", fixtureProbe())
        openArtist()
        val release = latestRelease()
        val more = hasText("Ver más canciones") and hasClickAction()
        scrollTo(more)
        compose.onNode(more).assertIsEnabled().performClick()
        waitFor("paginación en curso", 3_000) { model.detail.value?.loading == true }
        clickRelease(release) {
            val pending = model.detail.value?.loading == true
            Log.i(TAG, "Antes de abrir el álbum: paginación en curso=$pending, fixture=$fixture")
            if (fixture) assertTrue("La paginación debe seguir en curso al abrir el álbum", pending)
        }
        checkAlbum(release)
        click(back, "Volver durante paginación")
        waitFor("artista restaurado con sus canciones") {
            model.detail.value?.let { it.kind == "artist" && it.songs.isNotEmpty() } == true && visible(back)
        }
        // Scroll by text because a disabled button may omit its click action.
        scrollTo(hasText("Ver más canciones"))
        capture("test-paginacion-al-volver")
        try {
            settled("Paginación restaurada", 8_000) {
                model.detail.value?.loading == false && visible(more and isEnabled())
            }
        } catch (error: AssertionError) {
            val page = model.detail.value
            Log.e(TAG, "Paginación restaurada: loading=${page?.loading}, canciones=${page?.songs?.size}")
            compose.onNodeWithText("Ver más canciones").assertIsDisplayed().assertIsNotEnabled()
            checkProcess()
            throw error
        }
    }

    /** Run this case with the timeout fixture bundled into an isolated debug APK. */
    @Test fun albumLeavesLoadingAfterProviderTimeout() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("artistExitTimeoutFixture") == "true")
        assertEquals("artist-exit-timeout", fixtureProbe())
        openArtist()
        val release = latestRelease()
        val start = SystemClock.elapsedRealtime()
        clickRelease(release)
        waitFor("álbum esperando al proveedor", 5_000) {
            model.detail.value?.let { it.kind == "album" && it.loading } == true && visible(back)
        }
        val providerStart = SystemClock.elapsedRealtime()
        Thread.sleep(2_000)
        // Queue the probe behind the endless album on the real QuickJS mutex.
        assertEquals("artist-exit-timeout", fixtureProbe(72_000))
        val elapsed = SystemClock.elapsedRealtime() - providerStart
        assertTrue("El proveedor liberó el álbum a los $elapsed ms", elapsed in 55_000..74_000)
        Log.i(TAG, "Proveedor libre a los $elapsed ms, álbum «$release»: loading=${model.detail.value?.loading}, " +
            "canciones=${model.detail.value?.songs?.size}, error=${model.detail.value?.error}")
        capture("test-album-timeout")
        checkProcess()
        try {
            waitFor("el álbum sale de la carga tras el timeout", 7_000) {
                model.detail.value?.loading == false
            }
        } finally {
            click(back, "Volver después del timeout")
            waitFor("artista después del timeout") {
                model.detail.value?.let { it.kind == "artist" && !it.loading } == true && visible(back)
            }
            checkProcess()
            Log.i(TAG, "Volver después del timeout respondió, pid=$process, transcurridos=${SystemClock.elapsedRealtime() - start} ms")
        }
    }

    private fun fixtureProbe(timeout: Long = 12_000): String? = runBlocking {
        withTimeout(timeout) {
            app.provider.call("probe", buildJsonObject {})["fixture"]?.jsonPrimitive?.contentOrNull
        }
    }

    private fun openArtist(checkMotion: Boolean = false) {
        selectTab("Buscar")
        waitFor("campo y filtro Artistas") { visible(searchField) && visible(hasText("Artistas") and hasClickAction()) }
        val filter = hasText("Artistas") and hasClickAction()
        if (!visible(filter and isSelected())) click(filter, "filtro Artistas")
        if (!visible(searchField and editableText(query))) {
            compose.onNode(searchField).performTextReplacement(query)
            compose.onNode(searchField).performImeAction()
        }
        click(hasContentDescription("Artista: $title") and hasClickAction(), "resultado $title", 75_000)
        waitFor("ficha de $title", 75_000) {
            model.detail.value?.let { it.kind == "artist" && !it.loading && it.songs.isNotEmpty() } == true &&
                visible(back)
        }
        // Each route remembers its scroll position. Return to the hero before checking motion.
        compose.onNode(pageList).performScrollToIndex(0)
        waitFor("cabecera de $title") { visible(hasText(title)) }
        if (checkMotion) observeMotion()
    }

    private fun observeMotion() {
        // Resolve the palette and allow the first Compose transitions to settle before sampling video.
        val id = requireNotNull(model.detail.value).id
        runCatching {
            waitFor("paleta del artista", 8_000) {
                compose.runOnIdle { model.artistThemes["youtube:$id"] != null }
            }
        }
        if (usePaletteFixture) {
            // Rauw's real banner is monochrome. Sample the existing QA artwork without replacing his video.
            runBlocking {
                withTimeout(10_000) {
                    withContext(Dispatchers.Main) { model.loadArtistTheme(app, "youtube:$id", paletteFile.path) }
                }
            }
        }
        val palette = compose.runOnIdle { model.artistThemes["youtube:$id"]?.neutral == false }
        compose.waitForIdle()
        Thread.sleep(650)
        val deadline = SystemClock.elapsedRealtime() + if (motionObserved) 8_000 else 22_000
        var previous = headerPixels()
        var consecutive = 0
        var changed: Int
        do {
            Thread.sleep(350)
            val pixels = headerPixels()
            changed = previous.indices.count { index ->
                val a = previous[index]
                val b = pixels[index]
                abs((a shr 16 and 255) - (b shr 16 and 255)) +
                    abs((a shr 8 and 255) - (b shr 8 and 255)) +
                    abs((a and 255) - (b and 255)) > 12
            }
            consecutive = if (changed > pixels.size / 25) consecutive + 1 else 0
            previous = pixels
        } while (consecutive < 3 && SystemClock.elapsedRealtime() < deadline)
        if (consecutive >= 3 && !motionObserved) capture("test-artista-movimiento")
        motionObserved = motionObserved || consecutive >= 3
        Log.i(TAG, "Cabecera $title: paleta cromática=$palette, movimiento=${consecutive >= 3}, muestras distintas=$changed")
    }

    private fun headerPixels(): IntArray {
        val image = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            return IntArray(48 * 24) { index ->
                val x = image.width * (index % 48 + 1) / 49
                val y = (image.height * (0.12 + 0.09 * (index / 48) / 24)).toInt()
                image.getPixel(x, y)
            }
        } finally {
            image.recycle()
        }
    }

    private fun latestRelease(): String {
        val artist = requireNotNull(model.detail.value)
        val newest = (artist.albums + artist.singles).maxByOrNull { it["year"]?.jsonPrimitive?.intOrNull ?: 0 }
        val latest = requireNotNull(newest?.takeIf { it in artist.albums } ?: artist.albums.firstOrNull())
        return (latest["title"] ?: latest.getValue("name")).jsonPrimitive.content
    }

    private fun clickRelease(title: String, beforeClick: () -> Unit = {}) {
        val card = hasText(title) and hasClickAction()
        scrollTo(card)
        // The newest album can also appear in a shelf below this full-width card.
        val node = compose.onAllNodes(card).onFirst().assertIsDisplayed()
        beforeClick()
        node.performClick()
    }

    private fun checkAlbum(title: String) {
        settled("Álbum «$title»", 75_000) {
            model.detail.value?.let {
                it.kind == "album" && !it.loading && it.error == null &&
                    it.songs.firstOrNull()?.let { song -> visible(hasText(song.title)) } == true
            } == true && visible(hasText(title))
        }
    }

    private fun checkLibrary() = settled("Biblioteca", 10_000) {
        model.tab.value == 2 && model.detail.value == null && visible(hasText("Tu biblioteca")) &&
            visible(hasText("Más reproducidas") and hasClickAction())
    }

    private fun settled(label: String, timeout: Long, ready: () -> Boolean) {
        val start = SystemClock.elapsedRealtime()
        // The bare skeletons have no semantics. Route loading in ready() covers those.
        waitFor(label, timeout) { ready() && !visible(progress) }
        checkProcess()
        val mini = hasContentDescription("Abrir reproductor")
        val hasMini = visible(mini)
        if (hasMini) {
            click(mini, "abrir minirreproductor tras $label")
            click(hasContentDescription("Cerrar reproductor"), "cerrar reproductor tras $label")
            waitFor("destino tras cerrar reproductor: $label") { visible(mini) && ready() && !visible(progress) }
            checkProcess()
        }
        Log.i(TAG, "OK $label en ${SystemClock.elapsedRealtime() - start} ms, minirreproductor=$hasMini, pid=$process")
    }

    private fun checkProcess() {
        val pid = instrumentation.uiAutomation.executeShellCommand("pidof ${app.packageName}").use { descriptor ->
            android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText().trim() }
        }
        assertEquals("El proceso original debe seguir vivo", process.toString(), pid)
    }

    private fun selectTab(label: String) {
        val matcher = hasText(label) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)
        if (!visible(matcher) && visible(pageList)) {
            // Scrolling down compacts the floating tab bar to the current tab; scrolling back up restores the labelled tabs.
            compose.onNode(pageList).performTouchInput { swipeDown() }
            compose.waitForIdle()
        }
        click(matcher, label)
    }

    private fun editableText(value: String) = SemanticsMatcher("texto editable «$value»") { node ->
        node.config.getOrNull(SemanticsProperties.EditableText)?.text == value
    }

    private fun click(matcher: SemanticsMatcher, label: String, timeout: Long = 10_000) {
        waitFor(label, timeout) { visible(matcher) }
        compose.onNode(matcher).performClick()
    }

    private fun scrollTo(matcher: SemanticsMatcher) {
        compose.onNode(pageList).performScrollToNode(matcher)
        waitFor(matcher.description) { visible(matcher) }
        clearOfDock(matcher)
    }

    /** The floating dock covers the bottom of the list; keep the target above it so a tap reaches it. */
    private fun clearOfDock(matcher: SemanticsMatcher) {
        val dock = compose.onAllNodes(hasContentDescription("Abrir reproductor")).fetchSemanticsNodes() +
            compose.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)).fetchSemanticsNodes()
        val dockTop = dock.minOfOrNull { it.boundsInRoot.top } ?: return
        val bottom = compose.onAllNodes(matcher).fetchSemanticsNodes().firstOrNull()?.boundsInRoot?.bottom ?: return
        val overlap = bottom - dockTop + 48f
        if (overlap <= 0f) return
        compose.onNode(pageList).performTouchInput {
            swipe(Offset(centerX, centerY), Offset(centerX, centerY - overlap), 400)
        }
        compose.waitForIdle()
        waitFor(matcher.description) { visible(matcher) }
    }

    private fun visible(matcher: SemanticsMatcher): Boolean =
        compose.onAllNodes(matcher).fetchSemanticsNodes().indices.any { compose.onAllNodes(matcher)[it].isDisplayed() }

    private fun waitFor(label: String, timeout: Long = 10_000, condition: () -> Boolean) {
        try {
            compose.waitUntil(timeoutMillis = timeout, condition = condition)
        } catch (error: ComposeTimeoutException) {
            val search = model.search.value
            val detail = model.detail.value
            throw AssertionError("$label excedió ${timeout} ms. " +
                "Buscar: pending=${search.pending}, loading=${search.loading}, error=${search.error}. " +
                "Detalle: kind=${detail?.kind}, loading=${detail?.loading}, error=${detail?.error}.", error)
        }
    }

    private fun withMotionEnabled(block: () -> Unit) {
        val previous = runBlocking { app.preferences.data.first()[Motion] }
        val unmetered = app.qaUnmetered
        try {
            app.qaUnmetered = true
            if (usePaletteFixture) {
                instrumentation.context.assets.open("wallpaper-cover.jpg").use { source ->
                    paletteFile.outputStream().use { source.copyTo(it) }
                }
            }
            runBlocking { app.preferences.edit { it[Motion] = true } }
            block()
        } finally {
            if (usePaletteFixture) paletteFile.delete()
            app.qaUnmetered = unmetered
            runBlocking { app.preferences.edit { if (previous == null) it.remove(Motion) else it[Motion] = previous } }
        }
    }

    private fun capture(name: String) {
        val folder = File(checkNotNull(app.getExternalFilesDir(null)), "qa/artist-exit").apply { mkdirs() }
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            File(folder, "$name.png").outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        } finally {
            bitmap.recycle()
        }
    }

    private companion object {
        const val TAG = "OpenfyArtistExitQA"
    }
}
