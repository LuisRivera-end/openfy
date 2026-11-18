package app.openfy.android

import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import app.openfy.android.data.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

class SyncSmokeTest {
    @Test fun realServerPairingMixedPlaylistsOfflineChangesAndLostAcknowledgement(): Unit = runBlocking {
        val address=InstrumentationRegistry.getArguments().getString("syncHost")
        assumeTrue(address!=null)
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as OpenfyApplication
        fun request(path: String): JsonObject = app.http.newCall(Request.Builder().url("$address/test/$path").post("{}".toRequestBody("application/json".toMediaType())).build())
            .execute().use { check(it.isSuccessful); Json.parseToJsonElement(it.body!!.string()).jsonObject }
        val bootstrap=request("bootstrap")
        app.sync.unlink()
        val changed=app.repository.onChanged
        try {
            app.sync.pair(address!!,bootstrap.getValue("code").jsonPrimitive.content)
            val work=WorkManager.getInstance(app)
            withTimeout(30000) { while(work.getWorkInfosForUniqueWork("openfy-sync-now").get().any { !it.state.isFinished }) delay(100) }
            work.cancelUniqueWork("openfy-sync-periodic").result.get()
            app.repository.onChanged={}
            val dao=app.database.library()
            val playlist=dao.playlist(bootstrap.getValue("playlistId").jsonPrimitive.content)!!
            assertEquals(listOf("youtube:abcdefghijk"),CollectionRules.entries(playlist.entries))
            val a=dao.song("youtube:abcdefghijk")!!; assertTrue(a.favorite)
            val b=app.repository.saveRemote(bootstrap.getValue("b").jsonObject)
            app.repository.savePlaylist(playlist.copy(entries=CollectionRules.encode(listOf(b.id,a.id))))
            app.repository.favorite(a)
            val local=dao.songs().firstOrNull { it.source=="local" }
            local?.let { song -> app.repository.favorite(song) }
            request("drop-next")
            runCatching { app.sync.exchange() }
            // A retry must acknowledge the same persisted operation instead of creating another edit.
            app.sync.exchange()
            assertTrue(dao.pending().isEmpty())
            val first=request("state")
            assertEquals(0,first.getValue("favorite").jsonObject.getValue("favorite").jsonPrimitive.int)
            val ids=CollectionRules.entries(first.getValue("playlist").jsonObject.getValue("track_ids").jsonPrimitive.content)
            assertEquals(listOf(bootstrap.getValue("localA").jsonPrimitive.content,b.id,a.id,bootstrap.getValue("localB").jsonPrimitive.content),ids)
            val count=first.getValue("operations")
            app.sync.exchange()
            assertEquals(count,request("state").getValue("operations"))
            local?.let { assertEquals(!it.favorite,dao.song(it.id)!!.favorite) }
        } finally { app.sync.unlink(); app.repository.onChanged=changed }
    }
}
