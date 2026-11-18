package app.openfy.android.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import android.util.AtomicFile
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UriUtil
import androidx.media3.datasource.DataSourceInputStream
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import app.openfy.android.OpenfyApplication
import app.openfy.android.provider.readBounded
import java.io.File
import java.io.IOException
import java.text.Normalizer
import java.util.Base64
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.Response

@Serializable
internal data class MotionVideo(val url: String, val width: Int, val height: Int)

@Serializable
private enum class MotionStatus {
    @SerialName("ready") READY,
    @SerialName("none") NONE,
    @SerialName("unmatched") UNMATCHED
}

@Serializable
private data class MotionResult(
    val status: MotionStatus,
    val checkedAt: Long,
    val video: MotionVideo? = null
) {
    val expiresAt: Long
        get() = when (status) {
            MotionStatus.READY -> Long.MAX_VALUE
            MotionStatus.NONE -> checkedAt + 30 * DayMs
            MotionStatus.UNMATCHED -> checkedAt + DayMs
        }
}

internal data class MotionLookup(val video: MotionVideo? = null, val retryAt: Long? = null)

private const val DayMs = 86_400_000L
private const val RetryMs = 15 * 60_000L
private const val MaxCandidates = 3
private const val MaxPlaylistBytes = 512 * 1024
private const val ApplePlayer = "https://music.apple.com"
private const val UserAgent = "Mozilla/5.0 Openfy/Android"

/** Application-scoped catalog results, shared authentication and HLS cache access. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class MotionRepository(private val app: OpenfyApplication) {
    private val connectivity = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val http = app.http.newBuilder().followRedirects(false).followSslRedirects(false)
        .addInterceptor { chain ->
            if (connectivity.isActiveNetworkMetered || !isAppleUrl(chain.request().url)) {
                throw IOException("Motion needs an unmetered Apple connection")
            }
            chain.proceed(chain.request())
        }.build()
    private val mutex = Mutex()
    private val file = AtomicFile(File(app.filesDir, "motion/results.json"))
    private val results by lazy {
        runCatching { Json.decodeFromString<Map<String, MotionResult>>(file.readFully().decodeToString()) }
            .getOrDefault(emptyMap()).toMutableMap()
    }
    private val failures = mutableMapOf<String, Pair<Int, Long>>()
    private var token: String? = null
    private var tokenExpires = 0L
    val playback = MotionPlaybackCoordinator()

    private val networkFactory by lazy {
        CacheDataSource.Factory().setCache(app.motionVideoCache)
            .setUpstreamDataSourceFactory(OkHttpDataSource.Factory(http).setUserAgent(UserAgent))
    }
    private val offlineFactory by lazy {
        CacheDataSource.Factory().setCache(app.motionVideoCache).setCacheWriteDataSinkFactory(null)
    }

    fun videoFactory(allowNetwork: Boolean): CacheDataSource.Factory =
        if (allowNetwork) networkFactory else offlineFactory

    suspend fun resolve(artist: String, album: String, allowNetwork: Boolean): MotionLookup =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val key = key(artist, album)
                val now = System.currentTimeMillis()
                val cached = results[key]?.takeIf { it.expiresAt > now }
                if (!allowNetwork) {
                    return@withLock MotionLookup(cached?.video?.takeIf(::fullyCached))
                }
                failures[key]?.second?.takeIf { it > now }?.let { return@withLock MotionLookup(retryAt = it) }
                if (cached != null) {
                    return@withLock MotionLookup(cached.video, cached.expiresAt.takeIf { cached.video == null })
                }
                try {
                    val result = lookup(artist, album)
                    results[key] = result
                    failures.remove(key)
                    saveResults()
                    MotionLookup(result.video, result.expiresAt.takeIf { result.video == null })
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    MotionLookup(retryAt = scheduleRetry(key))
                }
            }
        }

    suspend fun videoFailed(artist: String, album: String, video: MotionVideo): Long = withContext(Dispatchers.IO) {
        mutex.withLock {
            val key = key(artist, album)
            if (results[key]?.video == video) {
                results.remove(key)
                saveResults()
            }
            scheduleRetry(key)
        }
    }

    private fun scheduleRetry(key: String): Long {
        val count = ((failures[key]?.first ?: 0) + 1).coerceAtMost(6)
        val retryAt = System.currentTimeMillis() + (RetryMs shl (count - 1)).coerceAtMost(6 * 3_600_000L)
        failures[key] = count to retryAt
        return retryAt
    }

    private fun saveResults() {
        results.entries.removeAll { it.value.expiresAt <= System.currentTimeMillis() }
        val stream = try { file.startWrite() } catch (_: IOException) { return }
        try {
            stream.write(Json.encodeToString(results).encodeToByteArray())
            file.finishWrite(stream)
        } catch (_: IOException) {
            file.failWrite(stream)
        }
    }

    private fun fullyCached(video: MotionVideo): Boolean = runCatching {
        val uri = Uri.parse(video.url)
        val bytes = DataSourceInputStream(offlineFactory.createDataSource(), DataSpec(uri)).use {
            it.readBounded(MaxPlaylistBytes)
        }
        val playlist = HlsPlaylistParser().parse(uri, bytes.inputStream()) as HlsMediaPlaylist
        if (!playlist.hasEndTag || playlist.segments.isEmpty()) return false
        val cache = app.motionVideoCache
        fun hasPart(part: HlsMediaPlaylist.SegmentBase): Boolean {
            val url = UriUtil.resolve(playlist.baseUri, part.url)
            appleUrl(url)
            val offset = part.byteRangeOffset
            val length = if (part.byteRangeLength != C.LENGTH_UNSET.toLong()) part.byteRangeLength
                else ContentMetadata.getContentLength(cache.getContentMetadata(url)) - offset
            return part.drmInitData == null && part.fullSegmentEncryptionKeyUri == null &&
                length > 0 && cache.isCached(url, offset, length)
        }
        playlist.segments.all { part -> hasPart(part) && part.initializationSegment?.let(::hasPart) != false }
    }.getOrDefault(false)

    private suspend fun lookup(artist: String, album: String): MotionResult {
        val checked = mutableSetOf<String>()
        val unresolved = mutableSetOf<String>()
        var verified = false
        var failure: Exception? = null
        for (search in listOf(::itunesAlbums, ::appleAlbums)) {
            try {
                val candidates = search(artist, album).distinct().filterNot(checked::contains)
                unresolved.addAll(candidates.drop(MaxCandidates))
                for (id in candidates.take(MaxCandidates)) {
                    checked.add(id)
                    try {
                        val attributes = catalog("albums/$id", mapOf("extend" to "editorialVideo"))
                            ?.getValue("data")?.jsonArray?.firstOrNull()?.jsonObject?.getValue("attributes")?.jsonObject
                        if (attributes == null) {
                            unresolved.add(id)
                            continue
                        }
                        val editorial = attributes["editorialVideo"]?.takeUnless { it is JsonNull }?.jsonObject
                        val video = editorial?.let { squareVideo(it) }
                        if (video != null) return MotionResult(MotionStatus.READY, System.currentTimeMillis(), video)
                        unresolved.remove(id)
                        verified = true
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Exception) {
                        failure = error
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                failure = error
            }
        }
        failure?.let { throw it }
        val status = if (verified && unresolved.isEmpty()) MotionStatus.NONE else MotionStatus.UNMATCHED
        return MotionResult(status, System.currentTimeMillis())
    }

    private suspend fun squareVideo(editorial: JsonObject): MotionVideo? {
        for (field in listOf("motionDetailSquare", "motionSquareVideo1x1")) {
            val attributes = editorial[field]?.takeUnless { it is JsonNull }?.jsonObject ?: continue
            val address = attributes["video"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank) ?: continue
            val url = appleUrl(address)
            val uri = Uri.parse(url.toString())
            val bytes = request(url, limit = MaxPlaylistBytes)
            return when (val playlist = HlsPlaylistParser().parse(uri, bytes.inputStream())) {
                is HlsMultivariantPlaylist -> {
                    val variants = playlist.variants.filter {
                        val format = it.format
                        format.width in 1..1080 && format.height in 1..1080 &&
                            format.frameRate <= 30f && MimeTypes.getVideoMediaMimeType(format.codecs) == MimeTypes.VIDEO_H264
                    }
                    val maxHeight = variants.maxOfOrNull { it.format.height }
                    val largest = variants.filter { it.format.height == maxHeight }
                    val variant = largest.filter { it.format.peakBitrate <= 6_000_000 }
                        .maxByOrNull { it.format.peakBitrate } ?: largest.minByOrNull { it.format.peakBitrate }
                        ?: error("Motion HLS rendition unavailable")
                    MotionVideo(appleUrl(variant.url.toString()).toString(), variant.format.width, variant.format.height)
                }
                is HlsMediaPlaylist -> {
                    val width = attributes.getValue("width").jsonPrimitive.int
                    val height = attributes.getValue("height").jsonPrimitive.int
                    check(width > 0 && height > 0 && playlist.hasEndTag)
                    MotionVideo(url.toString(), width, height)
                }
                else -> error("Motion playlist unavailable")
            }
        }
        return null
    }

    private suspend fun itunesAlbums(artist: String, album: String): List<String> {
        val url = "https://itunes.apple.com/search".toHttpUrl().newBuilder()
            .addQueryParameter("term", "$artist $album").addQueryParameter("media", "music")
            .addQueryParameter("entity", "album").addQueryParameter("limit", "25")
            .addQueryParameter("country", "us").build()
        return json(request(url)).getValue("results").jsonArray.map { it.jsonObject }
            .filter { matches(artist, album, it.string("artistName"), it.string("collectionName")) }
            .map { albumId(it.string("collectionId")) }
    }

    private suspend fun appleAlbums(artist: String, album: String): List<String> {
        val query = mapOf("term" to "$artist $album", "types" to "albums", "limit" to "25")
        val rows = checkNotNull(catalog("search", query)).getValue("results").jsonObject["albums"]
            ?.jsonObject?.getValue("data")?.jsonArray.orEmpty()
        return rows.map { it.jsonObject }.filter {
            val attributes = it.getValue("attributes").jsonObject
            matches(artist, album, attributes.string("artistName"), attributes.string("name"))
        }.map { albumId(it.string("id")) }
    }

    private suspend fun catalog(path: String, query: Map<String, String>): JsonObject? {
        val url = "https://amp-api.music.apple.com/v1/catalog/us/$path".toHttpUrl().newBuilder()
        query.forEach { (name, value) -> url.addQueryParameter(name, value) }
        repeat(2) { attempt ->
            try {
                return json(request(url.build(), mapOf("Authorization" to "Bearer ${playerToken()}", "Origin" to ApplePlayer)))
            } catch (error: HttpFailure) {
                if (error.code == 404 && path.startsWith("albums/")) return null
                if (attempt > 0 || error.code !in setOf(401, 403)) throw error
                token = null
            }
        }
        error("Motion authentication unavailable")
    }

    private suspend fun playerToken(): String {
        val minimum = System.currentTimeMillis() + 3_600_000L
        token?.takeIf { tokenExpires > minimum }?.let { return it }
        val html = request("$ApplePlayer/us/browse".toHttpUrl()).decodeToString()
        val bundles = BundlePattern.findAll(html).take(3).map { it.groupValues[1] }
        for (bundle in bundles) {
            val source = request("$ApplePlayer$bundle".toHttpUrl(), limit = 32 * 1024 * 1024).decodeToString()
            for (candidate in TokenPattern.findAll(source).map { it.value }) {
                val expiry = runCatching {
                    json(Base64.getUrlDecoder().decode(candidate.split('.')[1])).getValue("exp").jsonPrimitive.long * 1000
                }.getOrNull() ?: continue
                if (expiry > minimum) {
                    token = candidate
                    tokenExpires = expiry
                    return candidate
                }
            }
        }
        error("Motion token unavailable")
    }

    private suspend fun request(url: HttpUrl, headers: Map<String, String> = emptyMap(), limit: Int = 4 * 1024 * 1024): ByteArray =
        suspendCancellableCoroutine { continuation ->
            val builder = Request.Builder().url(url).header("User-Agent", UserAgent)
            headers.forEach { (key, value) -> builder.header(key, value) }
            val call = http.newCall(builder.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) = continuation.resumeWithException(e)

                override fun onResponse(call: Call, response: Response) {
                    val result = runCatching {
                        response.use {
                            if (!it.isSuccessful) throw HttpFailure(it.code)
                            checkNotNull(it.body).byteStream().readBounded(limit)
                        }
                    }
                    result.fold(continuation::resume, continuation::resumeWithException)
                }
            })
        }

    private class HttpFailure(val code: Int) : IOException("Motion HTTP $code")

    private companion object {
        val BundlePattern = Regex("src=\"(/assets/index[^\"]+?\\.js)\"")
        val TokenPattern = Regex("eyJ[\\w-]+\\.eyJ[\\w-]+\\.[\\w-]+")
        val ArtistSeparator = Regex("\\s*(?:,|&|/|\\bx\\b|\\by\\b|\\band\\b|\\bfeat\\.?|\\bft\\.?)\\s*", RegexOption.IGNORE_CASE)

        fun key(artist: String, album: String) = normalize(artist) + "\n" + normalize(album)
        fun json(bytes: ByteArray) = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
        fun JsonObject.string(key: String) = get(key)?.jsonPrimitive?.contentOrNull.orEmpty()
        fun albumId(id: String) = id.also { check(it.toLongOrNull()?.let { value -> value > 0 } == true) }

        fun matches(artist: String, album: String, candidateArtist: String, candidateAlbum: String): Boolean {
            if (normalize(album) != normalize(candidateAlbum)) return false
            val key = normalize(artist)
            return key == normalize(candidateArtist) || candidateArtist.split(ArtistSeparator).any { normalize(it) == key }
        }

        fun normalize(value: String): String {
            val key = Normalizer.normalize(value, Normalizer.Form.NFKD).lowercase()
                .replace(Regex("\\p{M}"), "")
                .replace(Regex("[\\[(](?:feat|ft|featuring|with|con)\\b[^)\\]]*[)\\]]"), " ")
                .replace(Regex("\\s+(?:feat|ft|featuring)\\.?\\s.*$"), "")
                .replace(Regex("\\s+-\\s+(?:single|ep)$"), "")
                .replace(Regex("[^\\p{L}\\p{N}]+"), "")
            return key.ifEmpty {
                val symbols = Normalizer.normalize(value, Normalizer.Form.NFKC).trim().lowercase().replace(Regex("\\s+"), " ")
                if (symbols.isEmpty()) "" else "symbols:$symbols"
            }
        }

        fun appleUrl(value: String) = value.toHttpUrl().also { check(isAppleUrl(it)) }
        fun isAppleUrl(url: HttpUrl) = url.isHttps && url.port == 443 &&
            url.username.isEmpty() && url.password.isEmpty() &&
            (url.host == "apple.com" || url.host.endsWith(".apple.com"))
    }
}
