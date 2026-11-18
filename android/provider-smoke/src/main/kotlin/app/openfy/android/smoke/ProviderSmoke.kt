package app.openfy.android.smoke

import app.openfy.android.provider.YouTubeRuntime
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import java.io.File
import okhttp3.OkHttpClient
import okhttp3.Request

fun main() = runBlocking {
    val root = File(System.getProperty("user.dir")).let { if(File(it,"app").exists()) it else it.parentFile }
    val assets = File(root,"app/build/generated/provider-assets/provider")
    val runtime = YouTubeRuntime(File(assets,"polyfills.js").readText(),File(assets,"openfy-provider.js").readText())
    try {
        println(runtime.call("probe",buildJsonObject {}))
        val search = runtime.call("search",buildJsonObject { put("query","Daft Punk Get Lucky"); put("kind","songs") })
        val songs = search.getValue("songs").jsonArray
        check(songs.isNotEmpty()) { "Empty search" }
        val id = songs[0].jsonObject.getValue("videoId").jsonPrimitive.content
        println(runtime.call("probeAudio",buildJsonObject { put("id",id) }))
        val audio = runtime.call("resolve",buildJsonObject { put("id",id) })
        check(audio["resource"]?.jsonPrimitive?.contentOrNull!=null) { "Audio resource cannot be identified for resuming" }
        val client = OkHttpClient()
        for(start in listOf(0L, audio.getValue("bytes").jsonPrimitive.long / 2)) {
            client.newCall(Request.Builder().url(audio.getValue("url").jsonPrimitive.content)
                .header("Range","bytes=$start-${start+1023}").header("Origin","https://www.youtube.com").build()).execute().use {
                check(it.code == 206) { "Range rejected: ${it.code}" }
                check(it.body!!.bytes().size == 1024)
            }
        }
        println("PROVIDER_SMOKE_OK search=${songs.size} videoId=$id mime=${audio["mime"]} bytes=${audio["bytes"]}")
        search["nextCursor"]?.jsonPrimitive?.contentOrNull?.let { cursor ->
            val page=runtime.call("search",buildJsonObject { put("query","Daft Punk Get Lucky"); put("kind","songs"); put("cursor",cursor) })
            check(page.getValue("songs").jsonArray.isNotEmpty()) { "Song continuation is empty" }
        }
        val artists=runtime.call("search",buildJsonObject { put("query","Daft Punk"); put("kind","artists") }).getValue("artists").jsonArray
        check(artists.isNotEmpty())
        val artist=runtime.call("artist",buildJsonObject { put("id",artists.first().jsonObject.getValue("id").jsonPrimitive.content) })
        check(artist.getValue("topSongs").jsonArray.isNotEmpty())
        val albums=runtime.call("search",buildJsonObject { put("query","Random Access Memories"); put("kind","albums") }).getValue("albums").jsonArray
        check(albums.isNotEmpty())
        val album=runtime.call("album",buildJsonObject { put("id",albums.first().jsonObject.getValue("id").jsonPrimitive.content) })
        check(album.getValue("songs").jsonArray.isNotEmpty())
        println("CATALOG_SMOKE_OK continuation=true artists=${artists.size} albums=${albums.size} albumSongs=${album.getValue("songs").jsonArray.size}")
    } finally { runtime.close() }
}
