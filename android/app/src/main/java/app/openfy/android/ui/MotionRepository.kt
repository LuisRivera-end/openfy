package app.openfy.android.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import android.util.AtomicFile
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UriUtil
import androidx.media3.datasource.DataSourceInputStream
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException
import androidx.media3.exoplayer.mediacodec.MediaCodecRenderer.DecoderInitializationException
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import app.openfy.android.BuildConfig
import app.openfy.android.OpenfyApplication
import app.openfy.android.preferences
import app.openfy.android.provider.readBounded
import java.io.File
import java.io.IOException
import java.text.Normalizer
import java.util.Base64
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.Response

@Serializable
internal data class MotionVideo(
    val url: String,
    val width: Int,
    val height: Int,
    val master: String? = null,
    // Null denotes a legacy result. An empty list denotes a verified single-variant playlist.
    val renditions: List<MotionRendition>? = null
) {
    val maxEdge: Int get() = maxOf(width, height)

    fun withRendition(rendition: MotionRendition): MotionVideo =
        copy(url = rendition.url, width = rendition.width, height = rendition.height)
}

@Serializable
internal data class MotionRendition(
    val url: String,
    val width: Int,
    val height: Int,
    val frameRate: Float,
    val codecs: String,
    val peakBitrate: Int
) {
    val maxEdge: Int get() = maxOf(width, height)
    val area: Int get() = width * height
}

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
private const val MaxVideoEdge = 1080
private const val MaxVideoRate = 30f
private val DecoderPolicyKey = stringPreferencesKey("motionDecoderPolicy")
private val DecoderPolicyVersion = "${BuildConfig.VERSION_CODE}:${BuildConfig.VERSION_NAME}"
private const val ApplePlayer = "https://music.apple.com"
private const val UserAgent = "Mozilla/5.0 Openfy/Android"

@Serializable
private data class MotionDecoderPolicy(
    val version: String,
    val maxEdge: Int = MaxVideoEdge,
    val failedAtEdge: Map<String, Int> = emptyMap()
)

private fun availableMotionDecoders(names: List<String>, failedAtEdge: Map<String, Int>, edge: Int): List<String> {
    val unfailed = names.filterNot(failedAtEdge::containsKey)
    // Once the unfailed decoders are exhausted, a lower rendition may retry failures from larger sizes.
    return unfailed.ifEmpty { names.filter { edge < failedAtEdge.getValue(it) } }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
private fun reportedFailedDecoders(error: PlaybackException): Set<String> = buildSet {
    for (cause in generateSequence<Throwable>(error) { it.cause }.take(12)) {
        when (cause) {
            is MediaCodecDecoderException -> cause.codecInfo?.name?.let { add(it) }
            is DecoderInitializationException -> {
                for (failure in generateSequence(cause) { it.fallbackDecoderInitializationException }) {
                    failure.codecInfo?.name?.let { add(it) }
                }
            }
        }
    }
}

private fun largestRendition(renditions: List<MotionRendition>): MotionRendition? {
    val area = renditions.maxOfOrNull { it.area }
    val sameSize = renditions.filter { it.area == area }
    return sameSize.filter { it.peakBitrate in 1..6_000_000 }.maxByOrNull { it.peakBitrate }
        ?: sameSize.minByOrNull { it.peakBitrate }
}

private fun preferredRendition(
    renditions: List<MotionRendition>,
    maxEdge: Int,
    supports: (MotionRendition) -> Boolean
): MotionRendition? {
    val withinLimit = renditions.filter { it.maxEdge <= maxEdge }
    return largestRendition(withinLimit.filter(supports)) ?: withinLimit
        .minWithOrNull(compareBy<MotionRendition> { it.area }.thenBy { it.peakBitrate })
}

/** Application-scoped catalog results, shared authentication and HLS cache access. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class MotionRepository(private val app: OpenfyApplication) {
    private val connectivity = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val http = app.http.newBuilder().followRedirects(false).followSslRedirects(false)
        .addInterceptor { chain ->
            val metered = connectivity.isActiveNetworkMetered && !(app.isDebuggable && app.qaUnmetered)
            if (metered || !isAppleUrl(chain.request().url)) {
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
    @Volatile private var learnedDecoderPolicy: MotionDecoderPolicy? = null
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

    fun decoderSelector(edge: Int): MediaCodecSelector {
        val failedAtEdge = learnedDecoderPolicy?.failedAtEdge.orEmpty()
        return MediaCodecSelector { mimeType, secure, tunneling ->
            val candidates = MediaCodecSelector.DEFAULT.getDecoderInfos(mimeType, secure, tunneling)
            if (!MimeTypes.isVideo(mimeType) || failedAtEdge.isEmpty()) candidates
            else {
                val allowed = availableMotionDecoders(candidates.map { it.name }, failedAtEdge, edge).toSet()
                candidates.filter { it.name in allowed }
            }
        }
    }

    suspend fun resolve(artist: String, album: String, allowNetwork: Boolean): MotionLookup =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val key = key(artist, album)
                val now = System.currentTimeMillis()
                val cached = results[key]?.takeIf { it.expiresAt > now }
                val maxEdge = decoderPolicy().maxEdge
                if (!allowNetwork) {
                    return@withLock MotionLookup(cached?.video?.let { offlineVideo(it, maxEdge) })
                }
                failures[key]?.second?.takeIf { it > now }?.let { return@withLock MotionLookup(retryAt = it) }
                try {
                    if (cached != null) {
                        val video = cached.video ?: return@withLock MotionLookup(retryAt = cached.expiresAt)
                        val legacyNeedsCheck = video.renditions == null && avcDecoders(decoderSelector(video.maxEdge)).let { decoders ->
                            decoders.isNotEmpty() && decoders.none { codec ->
                                runCatching { codec.isVideoSizeAndRateSupportedV21(video.width, video.height, MaxVideoRate.toDouble()) }
                                    .getOrDefault(true)
                            }
                        }
                        if (video.renditions.isNullOrEmpty() && video.maxEdge <= maxEdge && !legacyNeedsCheck) {
                            return@withLock MotionLookup(video)
                        }
                        val current = refreshLegacyVideo(artist, album, video, maxEdge)
                        val preferred = preferredRendition(current.renditions.orEmpty(), maxEdge, ::decoderSupports)
                            ?.let(current::withRendition) ?: current.takeIf { it.maxEdge <= maxEdge }
                            ?: return@withLock MotionLookup()
                        if (preferred != video) saveVideo(key, preferred)
                        return@withLock MotionLookup(preferred)
                    }
                    val result = lookup(artist, album, maxEdge)
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

    suspend fun retryWithAnotherDecoder(video: MotionVideo, selector: MediaCodecSelector, error: PlaybackException): Boolean =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val current = decoderPolicy()
                val active = avcDecoders(selector).map { it.name }
                if (active.isEmpty()) return@withLock false
                val failed = reportedFailedDecoders(error).intersect(active).ifEmpty { setOf(active.first()) }
                val newFailures = current.failedAtEdge + failed.associateWith { name ->
                    minOf(current.failedAtEdge[name] ?: video.maxEdge, video.maxEdge)
                }
                if (newFailures != current.failedAtEdge) saveDecoderPolicy(current.copy(failedAtEdge = newFailures))
                avcDecoders(decoderSelector(video.maxEdge)).isNotEmpty()
            }
        }

    suspend fun smallerVideo(artist: String, album: String, rejected: MotionVideo, allowNetwork: Boolean): MotionVideo? =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val policy = decoderPolicy()
                val maxEdge = minOf(policy.maxEdge, rejected.maxEdge - 1)
                if (maxEdge <= 0) return@withLock null
                try {
                    val current = if (allowNetwork) refreshLegacyVideo(artist, album, rejected, maxEdge) else rejected
                    val candidates = current.renditions.orEmpty().filter { it.url != rejected.url && it.maxEdge <= maxEdge }
                    val next = if (candidates.isEmpty()) {
                        current.takeIf { it.url != rejected.url && it.maxEdge <= maxEdge && (allowNetwork || fullyCached(it)) }
                    } else if (allowNetwork) {
                        largestRendition(candidates)?.let(current::withRendition)
                    } else {
                        cachedRendition(current, candidates)
                    }
                    if (next != null) {
                        if (next.maxEdge < policy.maxEdge) saveDecoderPolicy(policy.copy(maxEdge = next.maxEdge))
                        saveVideo(key(artist, album), next)
                    }
                    next
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    null
                }
            }
        }

    private suspend fun refreshLegacyVideo(artist: String, album: String, video: MotionVideo, maxEdge: Int): MotionVideo {
        if (video.renditions != null) return video
        val master = video.master ?: return lookup(artist, album, maxEdge).video ?: video
        return video.copy(renditions = renditions(readPlaylist(appleUrl(master)) as HlsMultivariantPlaylist))
    }

    private suspend fun decoderPolicy(): MotionDecoderPolicy {
        learnedDecoderPolicy?.let { return it }
        val stored = try {
            app.preferences.data.first()[DecoderPolicyKey]?.let { Json.decodeFromString<MotionDecoderPolicy>(it) }
        } catch (_: IOException) {
            null
        } catch (_: SerializationException) {
            null
        }
        val current = stored?.takeIf { it.version == DecoderPolicyVersion && it.maxEdge in 1..MaxVideoEdge }
            ?: MotionDecoderPolicy(DecoderPolicyVersion)
        learnedDecoderPolicy = current
        return current
    }

    private suspend fun saveDecoderPolicy(policy: MotionDecoderPolicy) {
        learnedDecoderPolicy = policy
        try {
            app.preferences.edit { it[DecoderPolicyKey] = Json.encodeToString(policy) }
        } catch (_: IOException) {
            // Keep the policy for the rest of this process if storage is unavailable.
        }
    }

    private fun saveVideo(key: String, video: MotionVideo) {
        results[key] = MotionResult(MotionStatus.READY, System.currentTimeMillis(), video)
        saveResults()
    }

    private fun offlineVideo(video: MotionVideo, maxEdge: Int): MotionVideo? {
        if (video.maxEdge <= maxEdge && fullyCached(video)) return video
        val limit = minOf(maxEdge, video.maxEdge)
        val alternatives = video.renditions.orEmpty().filter { it.url != video.url && it.maxEdge <= limit }
        return cachedRendition(video, alternatives)
    }

    private fun cachedRendition(video: MotionVideo, candidates: List<MotionRendition>): MotionVideo? {
        val remaining = candidates.toMutableList()
        while (remaining.isNotEmpty()) {
            val rendition = largestRendition(remaining) ?: return null
            val next = video.withRendition(rendition)
            if (fullyCached(next)) return next
            remaining.remove(rendition)
        }
        return null
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

    private suspend fun lookup(artist: String, album: String, maxEdge: Int): MotionResult {
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
                        val video = editorial?.let { squareVideo(it, maxEdge) }
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

    private suspend fun squareVideo(editorial: JsonObject, maxEdge: Int): MotionVideo? {
        for (field in listOf("motionDetailSquare", "motionSquareVideo1x1")) {
            val attributes = editorial[field]?.takeUnless { it is JsonNull }?.jsonObject ?: continue
            val address = attributes["video"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank) ?: continue
            val url = appleUrl(address)
            return when (val playlist = readPlaylist(url)) {
                is HlsMultivariantPlaylist -> {
                    val variants = renditions(playlist)
                    val variant = preferredRendition(variants, maxEdge, ::decoderSupports)
                        ?: error("Motion HLS rendition unavailable")
                    MotionVideo(variant.url, variant.width, variant.height, master = url.toString(), renditions = variants)
                }
                is HlsMediaPlaylist -> {
                    val width = attributes.getValue("width").jsonPrimitive.int
                    val height = attributes.getValue("height").jsonPrimitive.int
                    check(width in 1..maxEdge && height in 1..maxEdge && playlist.hasEndTag)
                    MotionVideo(url.toString(), width, height, renditions = emptyList())
                }
                else -> error("Motion playlist unavailable")
            }
        }
        return null
    }

    private suspend fun readPlaylist(url: HttpUrl) = HlsPlaylistParser().parse(
        Uri.parse(url.toString()), request(url, limit = MaxPlaylistBytes).inputStream()
    )

    private fun renditions(playlist: HlsMultivariantPlaylist): List<MotionRendition> = playlist.variants.mapNotNull { variant ->
        val format = variant.format
        val codecs = MimeTypes.getCodecsCorrespondingToMimeType(format.codecs, MimeTypes.VIDEO_H264)
        if (format.width !in 1..MaxVideoEdge || format.height !in 1..MaxVideoEdge || format.frameRate > MaxVideoRate || codecs == null) {
            return@mapNotNull null
        }
        val url = runCatching { appleUrl(variant.url.toString()).toString() }.getOrNull() ?: return@mapNotNull null
        MotionRendition(url, format.width, format.height, format.frameRate, codecs, format.peakBitrate)
    }

    private fun decoderSupports(rendition: MotionRendition): Boolean {
        val format = Format.Builder().setSampleMimeType(MimeTypes.VIDEO_H264).setCodecs(rendition.codecs)
            .setWidth(rendition.width).setHeight(rendition.height)
            .setFrameRate(rendition.frameRate.takeIf { it > 0f } ?: MaxVideoRate).build()
        // Media3 checks both size/rate and the AVC profile and level when CODECS provides them.
        return avcDecoders(decoderSelector(rendition.maxEdge)).any { codec ->
            runCatching { codec.isFormatSupported(app, format) }.getOrDefault(false)
        }
    }

    private fun avcDecoders(selector: MediaCodecSelector) = runCatching {
        selector.getDecoderInfos(MimeTypes.VIDEO_H264, false, false)
    }.getOrDefault(emptyList())

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
        // Apple moves this page (it now answers 301 → /us/new); follow up to three Apple-only hops.
        val html = request("$ApplePlayer/us/browse".toHttpUrl(), redirects = 3).decodeToString()
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

    private suspend fun request(url: HttpUrl, headers: Map<String, String> = emptyMap(), limit: Int = 4 * 1024 * 1024,
        redirects: Int = 0): ByteArray {
        val (bytes, next) = fetch(url, headers, limit, follow = redirects > 0)
        if (next == null) return checkNotNull(bytes)
        // Redirects are followed manually, and only to other HTTPS Apple URLs.
        check(isAppleUrl(next)) { "Motion redirect rejected" }
        return request(next, headers, limit, redirects - 1)
    }

    private suspend fun fetch(url: HttpUrl, headers: Map<String, String>, limit: Int, follow: Boolean): Pair<ByteArray?, HttpUrl?> =
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
                            if (follow && it.code in RedirectCodes) {
                                null to (it.header("Location")?.let(url::resolve) ?: throw HttpFailure(it.code))
                            } else {
                                if (!it.isSuccessful) throw HttpFailure(it.code)
                                checkNotNull(it.body).byteStream().readBounded(limit) to null
                            }
                        }
                    }
                    result.fold(continuation::resume, continuation::resumeWithException)
                }
            })
        }

    private class HttpFailure(val code: Int) : IOException("Motion HTTP $code")

    private companion object {
        val RedirectCodes = setOf(301, 302, 303, 307, 308)
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
