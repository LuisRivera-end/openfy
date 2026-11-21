package app.openfy.android

import android.content.ComponentName
import android.net.Uri
import android.util.AtomicFile
import androidx.media3.common.Player
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.platform.app.InstrumentationRegistry
import app.openfy.android.playback.PlaybackService
import app.openfy.android.ui.MotionRepository
import app.openfy.android.ui.motionArtist
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Live wallpaper QA, debug package only. `-e wallpaperSeed cover` imports a song with an embedded cover and
 * leaves it queued, paused and repeating; `-e wallpaperSeed motion` also puts a synthetic Motion video in the
 * offline cache under an Apple URL, so the wallpaper's video path runs without any network.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class WallpaperQaTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val app get() = instrumentation.targetContext.applicationContext as OpenfyApplication
    private val seed get() = InstrumentationRegistry.getArguments().getString("wallpaperSeed")

    private suspend fun controller(): MediaController = withContext(Dispatchers.Main) {
        val future = MediaController.Builder(app, SessionToken(app, ComponentName(app, PlaybackService::class.java))).buildAsync()
        withContext(Dispatchers.IO) { future.get(30, TimeUnit.SECONDS) }
    }

    @Test fun seedsTheWallpaperSong() = runBlocking {
        assumeTrue(seed == "cover" || seed == "motion")
        val file = File(app.cacheDir, "wallpaper.m4a")
        instrumentation.context.assets.open("wallpaper.m4a").use { input -> file.outputStream().use { input.copyTo(it) } }
        app.repository.importFile(Uri.fromFile(file), file.name)
        val song = app.database.library().songs().last { it.source == "local" && it.title == "Fondo animado" }
        assertTrue("Embedded cover", song.artwork?.let { File(it).exists() } == true)

        writeMotion(enabled = seed == "motion")
        // A fresh repository reads the results file this test just wrote.
        val video = MotionRepository(app).resolve(song.motionArtist(), song.album, allowNetwork = false).video
        if (seed == "motion") assertNotNull("Motion video fully cached", video) else assertNull(video)

        val player = controller()
        try {
            withContext(Dispatchers.Main) {
                player.setMediaItem(PlaybackService.mediaItem(song))
                player.repeatMode = Player.REPEAT_MODE_ONE
                player.prepare()
                player.play()
            }
            withTimeout(30000) { while (!withContext(Dispatchers.Main) { player.isPlaying }) delay(200) }
            withContext(Dispatchers.Main) { player.pause() }
            // PlaybackService persists the queue on every transport change.
            delay(1500)
        } finally {
            withContext(Dispatchers.Main) { player.release() }
        }
    }

    private fun writeMotion(enabled: Boolean) {
        val assets = instrumentation.context.assets
        if (enabled) {
            for (name in assets.list("motion").orEmpty()) {
                val url = MotionBase + name
                val bytes = assets.open("motion/$name").use { it.readBytes() }
                app.motionVideoCache.removeResource(url)
                CacheWriter(CacheDataSource(app.motionVideoCache, ByteArrayDataSource(bytes)),
                    DataSpec.Builder().setUri(Uri.parse(url)).setKey(url).build(), null, null).cache()
            }
        }
        val file = AtomicFile(File(app.filesDir, "motion/results.json").apply { parentFile?.mkdirs() })
        val stored = runCatching { Json.parseToJsonElement(file.readFully().decodeToString()).jsonObject }
            .getOrDefault(JsonObject(emptyMap()))
        val results = JsonObject(stored.toMutableMap().apply {
            if (enabled) put(MotionKey, buildJsonObject {
                put("status", "ready")
                put("checkedAt", System.currentTimeMillis())
                put("video", buildJsonObject {
                    put("url", MotionBase + "motion.m3u8")
                    put("width", 720)
                    put("height", 720)
                    put("renditions", buildJsonArray {})
                })
            }) else remove(MotionKey)
        })
        val stream = file.startWrite()
        stream.write(results.toString().encodeToByteArray())
        file.finishWrite(stream)
    }

    private companion object {
        const val MotionBase = "https://mvod.itunes.apple.com/openfy-qa/"
        /** MotionRepository's normalized key for artist «Openfy» and album «Portadas Android». */
        const val MotionKey = "openfy\nportadasandroid"
    }
}
