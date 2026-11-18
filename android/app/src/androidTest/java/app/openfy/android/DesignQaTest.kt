package app.openfy.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import app.openfy.android.data.CollectionRules
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.Song
import app.openfy.android.ui.OpenfyViewModel
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/**
 * Design QA with real content. Run only against the debug package and `scripts/android-design-host.ts`,
 * which serves a read-only copy of a real library. Nothing here is part of the release APK.
 *
 * - `designHost` + `designSeed=true`: pairs with the host, imports the real listening history and plays a
 *   few real contexts so Home has recents.
 * - `designRound=<name>`: navigates every screen and writes screenshots to
 *   `Android/data/<package>/files/qa/<name>/`.
 */
class DesignQaTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private val args get()=InstrumentationRegistry.getArguments()
    private val app get()=compose.activity.application as OpenfyApplication
    private val model get()=ViewModelProvider(compose.activity)[OpenfyViewModel::class.java]

    private fun post(address: String,path: String): JsonObject = app.http.newCall(Request.Builder().url("$address$path")
        .post("{}".toRequestBody("application/json".toMediaType())).build()).execute().use { check(it.isSuccessful) { "$path ${it.code}" }; Json.parseToJsonElement(it.body!!.string()).jsonObject }
    private fun main(block: () -> Unit) = runBlocking { withContext(Dispatchers.Main) { block() } }
    private fun play(song: Song,songs: List<Song>) = runBlocking { withContext(Dispatchers.Main) { model.play(song,songs) }.join() }
    private fun settle(ms: Long) { compose.waitForIdle(); Thread.sleep(ms); compose.waitForIdle() }
    private fun waitDetail(timeout: Long = 20000) { compose.waitUntil(timeout) { model.detail.value?.loading==false } ; settle(1500) }

    @Test fun seedFromRealLibrary() {
        val address=args.getString("designHost")
        assumeTrue(address!=null && args.getString("designSeed")=="true")
        runBlocking {
            app.sync.unlink()
            app.sync.pair(address!!,post(address,"/design/pairing").getValue("code").jsonPrimitive.content)
            val work=WorkManager.getInstance(app)
            withTimeout(120000) { while(work.getWorkInfosForUniqueWork("openfy-sync-now").get().any { !it.state.isFinished }) delay(250) }
            val dao=app.database.library()
            for(item in post(address,"/design/listening").getValue("items").jsonArray.map { it.jsonObject }) {
                val song=app.repository.saveRemote(item.getValue("song").jsonObject)
                val day=item.getValue("day").jsonPrimitive.content
                dao.putListening(ListeningRow("$day:${song.id}",song.id,day,item.getValue("listenedMs").jsonPrimitive.long,
                    item.getValue("plays").jsonPrimitive.int,item.getValue("lastPlayedAt").jsonPrimitive.long))
            }
        }
        // Real playback of real contexts creates the "recent" cards the way a person would.
        val songs=runBlocking { app.database.library().songs() }
        val favorites=songs.filter { it.favorite && it.source=="youtube" }
        runBlocking { app.database.library().playlists() }.firstOrNull()?.let { playlist ->
            val byId=songs.associateBy { it.id }
            val entries=CollectionRules.entries(playlist.entries).mapNotNull(byId::get)
            if(entries.isNotEmpty()) { main { model.openLocal("playlist",playlist.id,playlist.name,entries) }; play(entries.first(),entries); settle(20000) }
        }
        if(favorites.isNotEmpty()) { main { model.openLocal("favorites","favorites","Tus favoritas",favorites) }; play(favorites[1 % favorites.size],favorites); settle(20000) }
        favorites.firstOrNull { it.albumId!=null }?.let { song ->
            main { model.openRemote("album",song.albumId!!,song.album) }; waitDetail()
            model.detail.value?.songs?.takeIf { it.isNotEmpty() }?.let { play(it.first(),it); settle(20000) }
        }
        favorites.firstOrNull { it.artistId!=null }?.let { song ->
            main { model.openRemote("artist",song.artistId!!,song.artist) }; waitDetail()
            model.detail.value?.songs?.takeIf { it.isNotEmpty() }?.let { play(it.first(),it); settle(20000) }
        }
        main { model.toggle() }
    }

    /** Diagnostic: time from play() to audible playback through the same UI path the captures use. */
    @Test fun playbackLatency() {
        assumeTrue(args.getString("designLatency")=="true")
        app.qaUnmetered=args.getString("designMotion")!="off"
        val favorites=runBlocking { app.database.library().songs() }.filter { it.favorite && it.source=="youtube" }
        fun measure(label: String,song: Song,queue: List<Song>) {
            val start=android.os.SystemClock.elapsedRealtime()
            play(song,queue)
            val ok=runCatching { compose.waitUntil(60000) { model.player.value.playing && model.player.value.id==song.id } }.isSuccess
            android.util.Log.i("OpenfyQA","$label: ${if(ok) "${android.os.SystemClock.elapsedRealtime()-start} ms" else "no audio after 60 s"} (queue ${queue.size})")
            main { model.toggle() }; settle(1000)
        }
        main { model.selectTab(2) }; settle(args.getString("designWarmWait")?.toLongOrNull() ?: 3000)
        measure("single, library",favorites[3],listOf(favorites[3]))
        val album=favorites.filter { it.album.equals("Un Verano Sin Ti",ignoreCase=true) }
        measure("album queue, library",album.first(),album)
        compose.waitUntil(20000) { compose.onAllNodesWithContentDescription("Abrir reproductor").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Abrir reproductor").performClick(); settle(1500)
        measure("album queue, expanded player",album[1],album)
        app.qaUnmetered=false
        measure("album queue, expanded player, motion off",album[2],album)
    }

    /** Diagnostic: does the on-device Apple Music resolver find motion video for real albums? */
    @Test fun motionResolves() {
        assumeTrue(args.getString("designMotionCheck")=="true")
        for((artist,album) in listOf("Bad Bunny" to "Un Verano Sin Ti","Bad Bunny" to "DeBÍ TiRAR MáS FOToS","Daft Punk" to "Random Access Memories")) {
            val result=runCatching { runBlocking { app.motion.resolve(artist,album,true) } }
            android.util.Log.i("OpenfyQA","motion $artist / $album: ${result.fold({ "video=${it.video?.let { v -> "${v.width}x${v.height}" }} retryAt=${it.retryAt}" },{ "error=${it::class.simpleName}: ${it.message?.take(120)}" })}")
        }
    }

    /** Diagnostic: the album header must show moving motion video, not the still cover. */
    @Test fun motionPlays() {
        assumeTrue(args.getString("designMotionPlays")=="true")
        app.qaUnmetered=true
        val song=runBlocking { app.database.library().songs() }.firstOrNull { it.album.equals("Un Verano Sin Ti",ignoreCase=true) && it.albumId!=null }
        assumeTrue(song!=null)
        main { model.openRemote("album",song!!.albumId!!,song.album) }; waitDetail(); settle(35000)
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        fun header(): IntArray = automation.takeScreenshot().let { shot ->
            val w=shot.width; val top=(shot.height*0.08).toInt(); val h=(shot.height*0.22).toInt()
            IntArray(w*h).also { shot.getPixels(it,0,w,0,top,w,h); shot.recycle() }
        }
        fun changedPixels(): Int { val first=header(); Thread.sleep(700); val second=header(); return first.indices.count { first[it]!=second[it] } }
        var changed=changedPixels()
        // A decoder fallback to a smaller rendition may still be starting; measure once more.
        if(changed==0) { settle(25000); changed=changedPixels() }
        val directory=File(compose.activity.getExternalFilesDir(null),"qa/motion").apply { mkdirs() }
        automation.takeScreenshot().let { shot -> File(directory,"album-motion.png").outputStream().use { shot.compress(Bitmap.CompressFormat.PNG,100,it) }; shot.recycle() }
        android.util.Log.i("OpenfyQA","motion header pixels changed: $changed")
    }

    @Test fun captureScreens() {
        val round=args.getString("designRound")
        assumeTrue(round!=null)
        val directory=File(compose.activity.getExternalFilesDir(null),"qa/$round").apply { deleteRecursively(); mkdirs() }
        // The emulator's cellular link is metered; let motion covers load as they would on Wi-Fi.
        app.qaUnmetered=args.getString("designMotion")!="off"
        fun capture(name: String) {
            compose.waitForIdle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
                File(directory,"$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }; bitmap.recycle()
            }
        }
        // API 29 rejects injected gestures that start over the navigation area; stay mid-screen.
        fun scroll() { runCatching { compose.onRoot().performTouchInput { swipeUp(startY=bottom*0.62f,endY=bottom*0.18f,durationMillis=400) } } }
        val songs=runBlocking { app.database.library().songs() }
        val favorites=songs.filter { it.favorite && it.source=="youtube" }

        val playerOnly=args.getString("designOnly")=="player"
        if(!playerOnly) {
        main { model.selectTab(0) }; settle(9000); capture("01-home")
        scroll(); settle(1500); capture("02-home-scrolled")
        scroll(); settle(1500); capture("03-home-bottom")

        main { model.selectTab(1); model.query("Bad Bunny") }
        compose.waitUntil(30000) { model.search.value.songs.isNotEmpty() || model.search.value.error!=null }; settle(2500); capture("04-search")

        main { model.selectTab(2) }; settle(2000); capture("05-library")
        main { model.openLocal("favorites","favorites","Tus favoritas",favorites) }; settle(2500); capture("06-favorites")
        runBlocking { app.database.library().playlists() }.firstOrNull()?.let { playlist ->
            main { model.openLocal("playlist",playlist.id,playlist.name,emptyList()) }; settle(2500); capture("07-playlist")
        }
        val motionSong=favorites.firstOrNull { it.album.equals("Un Verano Sin Ti",ignoreCase=true) } ?: favorites.firstOrNull()
        favorites.firstOrNull { it.albumId!=null && it.album==motionSong?.album }?.let { song ->
            main { model.openRemote("album",song.albumId!!,song.album) }; waitDetail(); capture("08-album")
        }
        favorites.firstOrNull { it.artistId!=null }?.let { song ->
            main { model.openRemote("artist",song.artistId!!,song.artist) }; waitDetail(); capture("09-artist")
        }
        main { model.openLocal("top","top","Más reproducidas",emptyList()) }; settle(2500); capture("10-top")
        main { model.selectTab(3) }; settle(2000); capture("11-downloads")
        }
        val motionSong=favorites.firstOrNull { it.album.equals("Un Verano Sin Ti",ignoreCase=true) } ?: favorites.firstOrNull()
        motionSong?.let { song ->
            main { model.selectTab(0) }
            play(song,favorites.filter { it.album==song.album }.ifEmpty { listOf(song) })
            compose.waitUntil(20000) { compose.onAllNodesWithContentDescription("Abrir reproductor").fetchSemanticsNodes().isNotEmpty() }
            // The first YouTube resolution after a cold start can take ~20 s on the emulator; capture it playing.
            runCatching { compose.waitUntil(60000) { model.player.value.playing } }
            settle(3000); capture("12-home-miniplayer")
            compose.onNodeWithContentDescription("Abrir reproductor").performClick()
            settle(8000); capture("13-player-cover")
            compose.onNodeWithText("Letras").performClick(); settle(9000); capture("14-player-lyrics")
            compose.onNodeWithText("Cola").performClick(); settle(2000); capture("15-player-queue")
            compose.onNodeWithText("Portada").performClick()
            compose.onNodeWithContentDescription("Cerrar reproductor").performClick(); settle(1000)
            main { model.toggle() }
        }
    }
}
