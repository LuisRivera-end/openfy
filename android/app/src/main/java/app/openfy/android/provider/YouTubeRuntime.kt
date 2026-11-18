package app.openfy.android.provider

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.asyncFunction
import com.dokar.quickjs.binding.function
import com.dokar.quickjs.evaluate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resumeWithException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Shared by the Android APK and the JVM integration smoke. No Node, loopback or PC service. */
class YouTubeRuntime(private val sources: () -> Pair<String,String>) {
    constructor(polyfills: String, bundle: String) : this({ polyfills to bundle })
    private val mutex = Mutex()
    // QuickJS evaluates on the caller's thread; callers include Dispatchers.Main (ANR on search).
    // One owned thread keeps the VM off the UI and on the thread it was created on (QuickJS
    // derives its stack limit from it), with the same 8 MB stack the bundle had on the main thread.
    private val thread = Executors.newSingleThreadExecutor { task ->
        Thread(null,task,"openfy-quickjs",8L shl 20).apply { isDaemon = true }
    }.asCoroutineDispatcher()
    private val json = Json { ignoreUnknownKeys = true }
    private val client = OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS)
        .readTimeout(15,TimeUnit.SECONDS).callTimeout(30,TimeUnit.SECONDS).build()
    private var vm: QuickJs? = null
    private var returned = ""

    private suspend fun machine(): QuickJs {
        vm?.let { return it }
        val next = QuickJs.create(Dispatchers.Default)
        next.evaluationTimeoutMillis = 45_000
        next.function("__result") { args -> returned = args[0].toString() }
        next.function("__uuid") { UUID.randomUUID().toString() }
        next.function("__random") { args ->
            val count = (args[0] as Number).toInt(); require(count in 0..65536)
            val bytes = ByteArray(count); SecureRandom().nextBytes(bytes)
            bytes.joinToString(prefix="[",postfix="]") { (it.toInt() and 255).toString() }
        }
        next.function("__sha1") { args -> MessageDigest.getInstance("SHA-1")
            .digest(args[0].toString().toByteArray()).joinToString("") { "%02x".format(it) } }
        next.function("__base64") { args -> if(args[1] == true) Base64.getEncoder().encodeToString(args[0].toString().toByteArray(Charsets.ISO_8859_1))
            else String(Base64.getDecoder().decode(args[0].toString()),Charsets.ISO_8859_1) }
        next.function("__utf8") { args -> if(args[1] == true) Base64.getEncoder().encodeToString(args[0].toString().toByteArray(Charsets.UTF_8))
            else String(Base64.getDecoder().decode(args[0].toString()),Charsets.UTF_8) }
        next.function("__bytes64") { args ->
            @Suppress("UNCHECKED_CAST") val bytes = (args[0] as List<Number>).map { it.toByte() }.toByteArray()
            Base64.getEncoder().encodeToString(bytes)
        }
        next.asyncFunction("__http") { args -> request(args[0].toString()) }
        next.asyncFunction("__decipher") { args ->
            val sandbox = QuickJs.create(Dispatchers.Default)
            sandbox.evaluationTimeoutMillis = 1_000
            try {
                val env = json.parseToJsonElement(args[1].toString()).jsonObject
                val declarations = env.entries.joinToString("\n") { (key,value) -> "globalThis[${Json.encodeToString(key)}]=$value;" }
                withTimeout(1500) { sandbox.evaluate<String>("$declarations\nJSON.stringify((function(){\n${args[0]}\n})())") }
            } finally { sandbox.close() }
        }
        try {
            val (polyfills,bundle) = sources()
            next.evaluate<Any?>(polyfills)
            next.evaluate<Any?>(bundle)
            vm = next
            return next
        } catch (error: Throwable) { next.close(); throw error }
    }

    /** Evaluates the bundle ahead of the first call so the first song starts sooner. Makes no network request. */
    suspend fun warm() = withContext(thread) { mutex.withLock { machine(); Unit } }

    suspend fun call(method: String, params: JsonObject): JsonObject {
        require(method in setOf("probe","probeAudio","search","resolve","artist","album","artistSongs","artistReleases","lyrics","recommendations","spotifyMatch"))
        return withContext(thread) { mutex.withLock {
            try { withTimeout(60_000) {
                    returned = ""
                    machine().evaluate<Any?>("__result(JSON.stringify(await openfy.$method($params)))", asModule = true)
                    json.parseToJsonElement(returned).jsonObject
            } } catch(error: CancellationException) {
                // Interrupted SDK promises/cursors cannot be reused by a later navigation.
                withContext(NonCancellable) { vm?.close(); vm=null }
                throw error
            }
        } }
    }

    private suspend fun request(serialized: String): String = withContext(Dispatchers.IO) {
        val data = json.parseToJsonElement(serialized).jsonObject
        val address = data.getValue("url").jsonPrimitive.content
        val uri = java.net.URI(address)
        require(uri.scheme == "https" && uri.userInfo == null && uri.port == -1 && allowedHost(uri.host)) { "Provider host rejected" }
        val method = data["method"]?.jsonPrimitive?.content ?: "GET"
        val body = data["body"]?.takeUnless { it is JsonNull }?.let {
            if(it is JsonObject) Base64.getDecoder().decode(it.getValue("base64").jsonPrimitive.content)
            else it.jsonPrimitive.content.toByteArray()
        }
        val builder = Request.Builder().url(address)
        data["headers"]?.jsonObject?.forEach { (key,value) -> builder.header(key,value.jsonPrimitive.content) }
        builder.method(method, if(method in setOf("GET","HEAD")) null else (body ?: ByteArray(0)).toRequestBody())
        client.newCall(builder.build()).awaitResponse().use { response ->
            val stream = response.body?.byteStream()
            val bytes = stream?.readBounded(16 * 1024 * 1024) ?: ByteArray(0)
            require(bytes.size <= 16 * 1024 * 1024) { "Provider response exceeds metadata limit" }
            buildJsonObject {
                put("status",response.code); put("statusText",response.message); put("url",response.request.url.toString())
                put("headers",buildJsonObject { response.headers.names().forEach { put(it,response.header(it).orEmpty()) } })
                put("base64",Base64.getEncoder().encodeToString(bytes))
            }.toString()
        }
    }

    private fun allowedHost(host: String) = listOf("youtube.com","youtubei.googleapis.com","googlevideo.com","ytimg.com","ggpht.com","googleusercontent.com")
        .any { host == it || host.endsWith(".$it") }
    suspend fun close() = withContext(thread) { mutex.withLock { vm?.close(); vm = null } }
}

private suspend fun Call.awaitResponse(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call,e: IOException) { if(continuation.isActive) continuation.resumeWithException(e) }
        override fun onResponse(call: Call,response: Response) { continuation.resume(response) { _,value,_ -> value.close() } }
    })
}
