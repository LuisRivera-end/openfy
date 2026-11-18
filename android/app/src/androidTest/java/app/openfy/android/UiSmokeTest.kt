package app.openfy.android

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
        compose.onNodeWithText("Playlists").performClick()
        compose.onNodeWithText("Crear playlist").performClick()
        compose.onNode(hasSetTextAction() and hasText("Nombre")).performTextInput("Prueba Android")
        compose.onNodeWithText("Guardar").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Prueba Android").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("Prueba Android").onFirst().performClick()
        capture("playlist")
        compose.onNodeWithContentDescription("Volver").performClick()
        compose.onNodeWithContentDescription("Buscar").performClick()
        compose.onNodeWithText("¿Qué quieres escuchar?").assertExists()
        capture("search")
        compose.onNodeWithContentDescription("Descargas").performClick()
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
        compose.onNodeWithContentDescription("Abrir reproductor").performClick()
        compose.onNodeWithContentDescription("Cerrar reproductor").assertIsDisplayed()
        compose.onNodeWithText("Letras").performClick()
        capture("player-lyrics")
        compose.onNodeWithText("Portada").performClick()
        capture("player-portrait")
        compose.runOnUiThread { compose.activity.requestedOrientation=android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        compose.waitUntil(10000) { compose.activity.resources.configuration.orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE }
        android.os.SystemClock.sleep(700) // System rotation animation continues after configuration changes.
        compose.onAllNodesWithContentDescription("Siguiente").onLast().assertIsDisplayed()
        compose.onNodeWithContentDescription("Cerrar reproductor").assertIsDisplayed()
        capture("player-landscape")
        compose.runOnUiThread { compose.activity.requestedOrientation=android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
    }
}
