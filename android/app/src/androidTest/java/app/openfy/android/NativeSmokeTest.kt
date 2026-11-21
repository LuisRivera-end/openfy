package app.openfy.android

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.openfy.android.data.*
import app.openfy.android.lyrics.EmbeddedLyrics
import app.openfy.android.playback.PlaybackService
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class NativeSmokeTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val app get()=instrumentation.targetContext.applicationContext as OpenfyApplication
    private suspend fun controller(): MediaController = withContext(Dispatchers.Main) {
        val future=MediaController.Builder(app,SessionToken(app,ComponentName(app,PlaybackService::class.java))).buildAsync()
        withContext(Dispatchers.IO) { future.get(30,TimeUnit.SECONDS) }
    }
    private suspend fun waitUntil(timeout: Long = 30000,predicate: suspend ()->Boolean) {
        withTimeout(timeout) { while(!predicate()) delay(200) }
    }
    @Test fun importsDeduplicatesAndPlaysActualLocalFormats() = runBlocking {
        for(extension in listOf("m4a","mp3","flac")) {
            val file=File(app.cacheDir,"fixture.$extension")
            instrumentation.context.assets.open("fixture.$extension").use { input -> file.outputStream().use { input.copyTo(it) } }
            app.repository.importFile(Uri.fromFile(file),file.name)
            // Only this fixture: QA runs may leave other local songs (such as the wallpaper's) in the debug data.
            val fixture={ song: Song -> song.source=="local" && song.title=="Horizonte" && song.path?.endsWith(".$extension")==true }
            val first=app.database.library().songs().filter(fixture)
            assertTrue(first.isNotEmpty())
            app.repository.importFile(Uri.fromFile(file),file.name)
            assertEquals(first.size,app.database.library().songs().count(fixture))
            val song=first.last(); assertEquals("Horizonte",song.title); assertTrue(song.duration>=7900)
            val player=controller()
            try {
                withContext(Dispatchers.Main) { player.setMediaItem(PlaybackService.mediaItem(song)); player.prepare(); player.play() }
                waitUntil { withContext(Dispatchers.Main) { player.isPlaying && player.currentPosition>1500 } }
                withContext(Dispatchers.Main) { player.pause(); player.seekTo(5000) }
                waitUntil { withContext(Dispatchers.Main) { player.currentPosition>=4900 && !player.isPlaying } }
            } finally { withContext(Dispatchers.Main) { player.pause(); player.release() } }
            if(extension=="m4a" || extension=="flac") assertTrue("Embedded lyrics $extension",EmbeddedLyrics.read(file)?.contains("Horizonte")==true)
        }
        val bad=File(app.cacheDir,"broken.m4a").apply { writeBytes(byteArrayOf(1,2,3,4)) }
        assertTrue(runCatching { app.repository.importFile(Uri.fromFile(bad),bad.name) }.isFailure)
        assertTrue(File(app.filesDir,"originals").listFiles().orEmpty().none { it.name.endsWith(".partial") })
    }
    @Test fun autonomousYouTubeStreamsSeeksDownloadsAndPlaysOffline() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        app.startActivity(Intent(app,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        assertTrue(app.provider.call("probe",buildJsonObject {}).getValue("ok").jsonPrimitive.boolean)
        val results=app.provider.call("search",buildJsonObject { put("query","Daft Punk Get Lucky"); put("kind","songs") })
        assertTrue(results.getValue("songs").jsonArray.isNotEmpty())
        val song=app.repository.saveRemote(results.getValue("songs").jsonArray[0].jsonObject)
        if(app.database.library().download(song.id)!=null) {
            withContext(Dispatchers.Main) { app.downloads.remove(song.id) }
            waitUntil { app.database.library().download(song.id)?.state=="removed" }
        }
        val player=controller()
        try {
            withContext(Dispatchers.Main) { player.setMediaItem(PlaybackService.mediaItem(song)); player.prepare(); player.play() }
            waitUntil(90000) { withContext(Dispatchers.Main) { player.isPlaying && player.currentPosition>20000 } }
            val length=withContext(Dispatchers.Main) { player.duration }
            assertTrue(length>30000)
            withContext(Dispatchers.Main) { player.seekTo(length/2) }
            waitUntil(45000) { withContext(Dispatchers.Main) { player.isPlaying && player.currentPosition>length/2+2000 } }
            withContext(Dispatchers.Main) { player.pause(); app.downloads.add(song) }
            try { waitUntil(180000) { app.database.library().song(song.id)?.offlineReady==true } }
            catch(error: Exception) { throw AssertionError("Download stalled: ${app.database.library().download(song.id)}; paused=${withContext(Dispatchers.Main) { app.downloads.manager.downloadsPaused }}",error) }
            val download=app.database.library().download(song.id)!!
            assertTrue(download.total>100000); assertEquals(64,download.hash?.length)
            assertFalse(app.cache.getContentMetadata(song.id).get("openfy.resource","").isNullOrEmpty())
            // Only verified cache spans can satisfy this source: it has no upstream network factory.
            val cached=androidx.media3.datasource.cache.CacheDataSource.Factory().setCache(app.cache).createDataSource()
            try {
                assertEquals(download.total,cached.open(androidx.media3.datasource.DataSpec.Builder().setUri("openfy://youtube/${song.id.removePrefix("youtube:")}").setKey(song.id).build()))
                assertTrue(cached.read(ByteArray(1024),0,1024)>0)
            } finally { cached.close() }
            app.database.library().putMeta(SyncMeta("offline-smoke-song",song.id))
            withContext(Dispatchers.Main) { player.setMediaItem(PlaybackService.mediaItem(song)); player.prepare(); player.play() }
            waitUntil { withContext(Dispatchers.Main) { player.isPlaying && player.currentPosition>2000 } }
        } finally { withContext(Dispatchers.Main) { player.pause(); player.release() } }
    }
    @Test fun coldStartOfflineCacheIsPlayable() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("offlineOnly")=="true")
        val id=app.database.library().meta("offline-smoke-song") ?: error("Run realProvider smoke first")
        val song=app.database.library().song(id)!!
        val player=controller()
        try {
            withContext(Dispatchers.Main) { player.setMediaItem(PlaybackService.mediaItem(song)); player.prepare(); player.play() }
            waitUntil { withContext(Dispatchers.Main) { player.isPlaying && player.currentPosition>3000 } }
            instrumentation.uiAutomation.executeShellCommand("input keyevent 223").close()
            try { waitUntil { withContext(Dispatchers.Main) { player.isPlaying && player.currentPosition>6500 } } }
            finally { instrumentation.uiAutomation.executeShellCommand("input keyevent 224").close() }
        } finally { withContext(Dispatchers.Main) { player.pause(); player.release() } }
    }
    @Test fun databaseSurvivesApkReplacement() = runBlocking {
        val phase=InstrumentationRegistry.getArguments().getString("upgradePhase")
        assumeTrue(phase in setOf("write","read"))
        val dao=app.database.library()
        if(phase=="write") dao.putMeta(SyncMeta("upgrade-probe",JsonArray(dao.songs().map { JsonPrimitive(it.id) }.sortedBy { it.content }).toString()))
        else assertEquals(dao.meta("upgrade-probe"),JsonArray(dao.songs().map { JsonPrimitive(it.id) }.sortedBy { it.content }).toString())
    }
}
