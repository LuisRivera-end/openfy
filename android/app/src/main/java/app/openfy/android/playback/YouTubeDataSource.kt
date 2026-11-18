package app.openfy.android.playback

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.*
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.ContentMetadataMutations
import app.openfy.android.provider.YouTubeRuntime
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import java.io.IOException

/** Bounded GoogleVideo ranges, including seek and a single URL renewal at the same byte. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class YouTubeDataSource(private val provider: YouTubeRuntime, private val http: DataSource.Factory,private val cache: Cache) : DataSource {
    private var upstream: DataSource? = null
    private var uri: Uri? = null
    private var position = 0L
    private var end = 0L
    private var partRemaining = 0L
    private var audio: JsonObject? = null
    private var id = ""
    private var renewed = false
    private val listeners = mutableListOf<TransferListener>()

    override fun addTransferListener(listener: TransferListener) { listeners += listener }
    override fun open(spec: DataSpec): Long {
        uri = spec.uri; id = spec.uri.lastPathSegment ?: throw IOException("Missing video ID")
        position = spec.position; renewed = false
        audio = resolve(false)
        val key=spec.key ?: "youtube:$id"
        val resource=audio!!["resource"]?.jsonPrimitive?.contentOrNull
        val prior=cache.getContentMetadata(key).get("openfy.resource",null as String?)
        AudioResource.requireSame(prior,resource,cache.getCachedSpans(key).isNotEmpty())
        if(resource!=null && resource!=prior) cache.applyContentMetadataMutations(key,ContentMetadataMutations().set("openfy.resource",resource))
        val total = audio!!.getValue("bytes").jsonPrimitive.long
        if(position >= total) throw IOException("Position outside audio")
        end = if(spec.length == C.LENGTH_UNSET.toLong()) total else minOf(total,position+spec.length)
        try { openPart() } catch(error: IOException) { renew(); openPart() }
        return end-position
    }
    private fun resolve(renew: Boolean): JsonObject = try { runBlocking {
        provider.call("resolve",buildJsonObject { put("id",id); put("renew",renew) })
    } } catch(error: Exception) { throw IOException("No se pudo resolver el audio de YouTube",error) }
    private fun renew() {
        if(renewed) throw IOException("No se pudo renovar el audio")
        renewed=true
        val prior=audio!!; val replacement=resolve(true)
        if(replacement["bytes"]!=prior["bytes"] || replacement["mime"]!=prior["mime"]) throw IOException("Audio format changed; restart playback")
        AudioResource.requireSame(prior["resource"]?.jsonPrimitive?.contentOrNull,replacement["resource"]?.jsonPrimitive?.contentOrNull,true)
        audio=replacement
    }
    private fun openPart() {
        upstream?.close()
        val length = minOf(1024L*1024,end-position)
        if(length<=0) return
        val url = audio!!.getValue("url").jsonPrimitive.content
        val source = http.createDataSource()
        listeners.forEach(source::addTransferListener)
        upstream = source
        source.open(DataSpec.Builder().setUri(url).setPosition(position).setLength(length)
            .setHttpRequestHeaders(mapOf("Origin" to "https://www.youtube.com","Referer" to "https://www.youtube.com/","Accept-Encoding" to "identity")).build())
        partRemaining = length
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if(length==0) return 0
        if(position>=end) return C.RESULT_END_OF_INPUT
        return try {
            if(partRemaining==0L) openPart()
            val count = upstream!!.read(buffer,offset,minOf(length.toLong(),partRemaining).toInt())
            if(count == C.RESULT_END_OF_INPUT) throw IOException("Truncated audio range")
            position += count; partRemaining -= count
            count
        } catch(error: IOException) {
            if(renewed) throw error
            renew(); openPart(); read(buffer,offset,length)
        }
    }
    override fun getUri(): Uri? = uri
    override fun getResponseHeaders(): Map<String,List<String>> = upstream?.responseHeaders ?: emptyMap()
    override fun close() { upstream?.close(); upstream=null }

    class Factory(private val provider: YouTubeRuntime, client: OkHttpClient,private val cache: Cache) : DataSource.Factory {
        private val http = OkHttpDataSource.Factory(client).setUserAgent("Openfy/Android")
        override fun createDataSource(): DataSource = YouTubeDataSource(provider,http,cache)
    }
}
