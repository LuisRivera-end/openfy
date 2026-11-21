package app.openfy.android

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.openfy.android.ui.OpenfyViewModel
import org.junit.Rule
import org.junit.Test
import java.io.File

class UiSmokeTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun capture(name: String) {
        compose.waitForIdle()
        val directory=File(compose.activity.filesDir,"qa").apply { mkdirs() }
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            File(directory,"$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }; bitmap.recycle()
        }
    }
    @Test fun nativeNavigationSettingsAndPlaylistCreation() {
        compose.onAllNodesWithText("Inicio",useUnmergedTree=true).onFirst().assertExists()
        capture("home")
        compose.onNodeWithText("Biblioteca",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Tu biblioteca").assertExists()
        capture("library")
        compose.onNodeWithText("Playlists").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Añadir").performClick()
        compose.onNodeWithText("Crear playlist").performClick()
        compose.onNode(hasSetTextAction() and hasText("Nombre")).performTextInput("Prueba Android")
        compose.onNodeWithText("Guardar").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Prueba Android").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("Prueba Android").onFirst().performClick()
        capture("playlist")
        compose.onNodeWithContentDescription("Volver").performClick()
        compose.onNodeWithText("Buscar",useUnmergedTree=true).performClick()
        compose.onNodeWithText("¿Qué quieres escuchar?").assertIsDisplayed()
        capture("search")
        compose.onNodeWithText("Descargas",useUnmergedTree=true).performClick()
        capture("downloads")
        compose.onNodeWithContentDescription("Ajustes").performClick()
        compose.onNodeWithText("Vincular con Windows").assertExists()
        capture("settings")
        compose.onNodeWithContentDescription("Volver").performClick()
    }
    @Test fun fullPlayerKeepsTransportAndLyricsAccessibleAfterRotation() {
        val app=compose.activity.application as OpenfyApplication
        val model=androidx.lifecycle.ViewModelProvider(compose.activity)[OpenfyViewModel::class.java]
        kotlinx.coroutines.runBlocking {
            val file=File(app.cacheDir,"ui-fixture.m4a")
            InstrumentationRegistry.getInstrumentation().context.assets.open("fixture.m4a").use { input -> file.outputStream().use { input.copyTo(it) } }
            app.repository.importFile(android.net.Uri.fromFile(file),file.name)
            val song=app.database.library().songs().first { it.source=="local" && it.path?.endsWith(".m4a")==true }
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { model.play(song) }.join()
        }
        compose.waitUntil(10000) { compose.onAllNodesWithContentDescription("Abrir reproductor").fetchSemanticsNodes().isNotEmpty() }
        capture("mini-player")
        compose.onNodeWithContentDescription("Abrir reproductor").performClick()
        compose.onNodeWithContentDescription("Cerrar reproductor").assertIsDisplayed()
        compose.onNodeWithText("Letras").performClick()
        capture("player-lyrics")
        compose.onNodeWithText("Portada").performClick()
        capture("player-portrait")
        compose.runOnUiThread { compose.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        compose.onNodeWithContentDescription("Abrir Big Picture").performClick()
        waitForOrientation(Configuration.ORIENTATION_LANDSCAPE)
        compose.onNodeWithTag("mobile-big-picture").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Siguiente").onLast().assertIsDisplayed()
        compose.onNodeWithContentDescription("Salir de Big Picture").assertIsDisplayed()
        capture("player-landscape")
        // The Big Picture queue keeps the cover's ambient tint instead of a flat panel.
        compose.onNodeWithContentDescription("Cola de reproducción").performClick()
        compose.onNodeWithText("Cola de reproducción").assertIsDisplayed()
        capture("player-landscape-queue")
        compose.onNodeWithContentDescription("Cerrar reproductor").performClick()
        compose.onNodeWithTag("mobile-big-picture").assertIsDisplayed()
        compose.onNodeWithContentDescription("Salir de Big Picture").performClick()
        waitForOrientation(Configuration.ORIENTATION_PORTRAIT)
        compose.onNodeWithContentDescription("Cerrar reproductor").assertIsDisplayed()
        compose.runOnUiThread { compose.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        waitForOrientation(Configuration.ORIENTATION_LANDSCAPE)
        compose.onNodeWithContentDescription("Salir de Big Picture").assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription("Cerrar reproductor").assertIsDisplayed()
        compose.runOnUiThread { compose.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        waitForOrientation(Configuration.ORIENTATION_PORTRAIT)
    }
    private fun waitForOrientation(orientation: Int) {
        compose.waitUntil(10000) { compose.activity.resources.configuration.orientation == orientation }
        // Wait for the system rotation animation after the new configuration is active.
        android.os.SystemClock.sleep(700)
    }
}
