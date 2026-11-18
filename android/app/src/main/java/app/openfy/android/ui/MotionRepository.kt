package app.openfy.android.ui

import app.openfy.android.OpenfyApplication
import app.openfy.android.data.Song
import app.openfy.android.provider.readBounded
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.text.Normalizer
import java.util.Base64

/** Optional artwork provider; failures never affect playback and no signed media URLs are persisted. */
class MotionRepository(private val app: OpenfyApplication) {
    private val cache=linkedMapOf<String,Pair<Long,String?>>()
    private var token: String?=null
    private var expires=0L
    private val http=app.http.newBuilder().followRedirects(false).build()
    private fun norm(text: String)=Normalizer.normalize(text,Normalizer.Form.NFKC).lowercase().replace(Regex("[\\p{P}\\p{S}]+")," ").replace(Regex("\\s+")," ").trim()
    private fun text(url: String,headers: Map<String,String> = emptyMap(),limit: Int = 4*1024*1024): String {
        val parsed=url.toHttpUrl(); require(parsed.isHttps && (parsed.host=="apple.com" || parsed.host.endsWith(".apple.com")) && parsed.username.isEmpty())
        val builder=Request.Builder().url(url).header("User-Agent","Mozilla/5.0 Openfy/Android")
        headers.forEach { (key,value) -> builder.header(key,value) }
        return http.newCall(builder.build()).execute().use { response ->
            check(response.isSuccessful)
            val bytes=response.body!!.byteStream().readBounded(limit)
            String(bytes,Charsets.UTF_8)
        }
    }
    private fun playerToken(): String {
        token?.takeIf { expires>System.currentTimeMillis()+3600000 }?.let { return it }
        val html=text("https://music.apple.com/us/browse")
        val bundles=Regex("src=\"(/assets/index[^\"]+?\\.js)\"").findAll(html).take(3).map { it.groupValues[1] }
        for(bundle in bundles) {
            val source=text("https://music.apple.com$bundle",limit=32*1024*1024)
            for(candidate in Regex("eyJ[\\w-]+\\.eyJ[\\w-]+\\.[\\w-]+").findAll(source).map { it.value }) {
                val expiry=runCatching { Json.parseToJsonElement(String(Base64.getUrlDecoder().decode(candidate.split('.')[1]))).jsonObject["exp"]?.jsonPrimitive?.long?.times(1000) }.getOrNull() ?: continue
                if(expiry>System.currentTimeMillis()+3600000) { token=candidate; expires=expiry; return candidate }
            }
        }
        error("Motion artwork unavailable")
    }
    private fun catalog(path: String,query: Map<String,String> = emptyMap()): JsonObject {
        val url="https://amp-api.music.apple.com/v1/catalog/us/$path".toHttpUrl().newBuilder()
        query.forEach { (key,value)-> url.addQueryParameter(key,value) }
        return Json.parseToJsonElement(text(url.build().toString(),mapOf("Authorization" to "Bearer ${playerToken()}","Origin" to "https://music.apple.com"))).jsonObject
    }
    suspend fun resolve(song: Song): String? = withContext(Dispatchers.IO) {
        if(song.album.isBlank() || song.artist.isBlank()) return@withContext null
        val key="${song.artist}\n${song.album}"; val now=System.currentTimeMillis()
        synchronized(cache) { cache[key]?.takeIf { it.first>now } }?.let { return@withContext it.second }
        val result=runCatching {
            val artists=runCatching { Json.parseToJsonElement(song.metadata).jsonObject["artists"]?.jsonArray?.map { it.jsonPrimitive.content } }.getOrNull() ?: listOf(song.artist)
            fun matches(title: String,artist: String)=norm(title)==norm(song.album) && artists.any { norm(it)==norm(artist) }
            val url="https://itunes.apple.com/search".toHttpUrl().newBuilder().addQueryParameter("term","${artists[0]} ${song.album}")
                .addQueryParameter("media","music").addQueryParameter("entity","album").addQueryParameter("limit","25").addQueryParameter("country","us").build()
            val ids=Json.parseToJsonElement(text(url.toString())).jsonObject["results"]?.jsonArray.orEmpty().map { it.jsonObject }
                .filter { matches(it["collectionName"]?.jsonPrimitive?.content.orEmpty(),it["artistName"]?.jsonPrimitive?.content.orEmpty()) }
                .mapNotNull { it["collectionId"]?.jsonPrimitive?.content }.toMutableList()
            if(ids.isEmpty()) {
                val albums=catalog("search",mapOf("term" to "${artists[0]} ${song.album}","types" to "albums","limit" to "25"))["results"]?.jsonObject?.get("albums")?.jsonObject?.get("data")?.jsonArray.orEmpty()
                ids+=albums.map { it.jsonObject }.filter { val a=it["attributes"]?.jsonObject; a!=null && matches(a["name"]?.jsonPrimitive?.content.orEmpty(),a["artistName"]?.jsonPrimitive?.content.orEmpty()) }.map { it.getValue("id").jsonPrimitive.content }
            }
            ids.distinct().take(3).firstNotNullOfOrNull { id ->
                val attributes=catalog("albums/$id",mapOf("extend" to "editorialVideo"))["data"]?.jsonArray?.firstOrNull()?.jsonObject?.get("attributes")?.jsonObject
                val videos=attributes?.get("editorialVideo")?.takeIf { it is JsonObject }?.jsonObject
                val video=(videos?.get("motionDetailSquare") ?: videos?.get("motionSquareVideo1x1"))?.jsonObject?.get("video")?.jsonPrimitive?.contentOrNull
                video?.takeIf { val u=it.toHttpUrl(); u.isHttps && u.username.isEmpty() && u.host.endsWith(".apple.com") }
            }
        }.getOrNull()
        synchronized(cache) { if(cache.size>=24) cache.remove(cache.keys.first()); cache[key]=(now+15*60000) to result }
        result
    }
}
