package app.openfy.android.updates

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.openfy.android.BuildConfig
import app.openfy.android.OpenfyApplication
import app.openfy.android.provider.readBounded
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import okhttp3.*
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class UpdateState(val release: AndroidRelease?=null,val busy: Boolean=false,val progress: Int?=null,
    val ready: Boolean=false,val message: String="Las versiones se comprueban en GitHub.")

class GitHubUpdates(private val app: OpenfyApplication) {
    val state=MutableStateFlow(UpdateState())
    private val mutex=Mutex()
    private val prefs=app.getSharedPreferences("github-updates",Context.MODE_PRIVATE)
    private val directory=File(app.filesDir,"updates")
    private val json=Json { ignoreUnknownKeys=true }
    private var assetUrl: String?=null
    private val client=OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS)
        .followSslRedirects(false).addNetworkInterceptor { chain ->
            val url=chain.request().url
            if(!url.isHttps || url.host !in setOf("api.github.com","github.com","release-assets.githubusercontent.com","objects.githubusercontent.com","github-releases.githubusercontent.com")) throw IOException("Origen de actualización no permitido.")
            chain.proceed(chain.request())
        }.build()

    @Suppress("DEPRECATION")
    private fun installedCertificate(): String {
        val info=app.packageManager.getPackageInfo(app.packageName,PackageManager.GET_SIGNING_CERTIFICATES)
        val certs=info.signingInfo?.apkContentsSigners ?: error("No se pudo comprobar la firma instalada.")
        require(certs.size==1) { "La instalación tiene una firma no compatible." }
        return AndroidRelease.hex(MessageDigest.getInstance("SHA-256").digest(certs.single().toByteArray()))
    }
    fun scheduleCheck() {
        if(!BuildConfig.DEBUG && System.currentTimeMillis()-prefs.getLong("checkedAt",0)>24*60*60*1000L)
            app.scope.launch { check() }
    }
    suspend fun check() = withContext(Dispatchers.IO) {
        if(!mutex.tryLock()) return@withContext
        try {
            if(BuildConfig.DEBUG) { state.value=UpdateState(message="La versión debug se actualiza desde Android Studio. GitHub distribuye la versión de producción."); return@withContext }
            state.value=state.value.copy(busy=true,message="Comprobando GitHub…")
            val certificate=installedCertificate()
            val releases=Json.parseToJsonElement(bytes("https://api.github.com/repos/${AndroidRelease.REPOSITORY}/releases?per_page=30",2*1024*1024).decodeToString()).jsonArray
            val options=mutableListOf<Pair<AndroidRelease,String>>()
            for(release in releases.map { it.jsonObject }) {
                if(release["draft"]?.jsonPrimitive?.boolean!=false || release["prerelease"]?.jsonPrimitive?.boolean!=false) continue
                val assets=release["assets"]?.jsonArray?.map { it.jsonObject } ?: continue
                val descriptor=assets.find { it["name"]?.jsonPrimitive?.content==AndroidRelease.DESCRIPTOR } ?: continue
                val descriptorUrl=descriptor["browser_download_url"]?.jsonPrimitive?.content ?: continue
                if(!AndroidRelease.officialAsset(descriptorUrl,AndroidRelease.DESCRIPTOR) || descriptor["size"]?.jsonPrimitive?.long !in 1L..32768L) continue
                // A malformed asset in an unrelated release must not hide a valid newer build.
                val candidate=try {
                    val raw=bytes(descriptorUrl,32768)
                    if(!matchesDigest(descriptor,AndroidRelease.hex(MessageDigest.getInstance("SHA-256").digest(raw)))) continue
                    json.decodeFromString<AndroidRelease>(raw.decodeToString().removePrefix("\uFEFF")).also { it.validate() }
                } catch(error: CancellationException) { throw error } catch(_: Exception) { continue }
                if(!candidate.compatible(BuildConfig.VERSION_CODE.toLong(),Build.VERSION.SDK_INT,Build.SUPPORTED_ABIS.toList(),certificate)) continue
                val apk=assets.find { it["name"]?.jsonPrimitive?.content==candidate.file } ?: continue
                val url=apk["browser_download_url"]?.jsonPrimitive?.content ?: continue
                if(apk["size"]?.jsonPrimitive?.long!=candidate.bytes || !matchesDigest(apk,candidate.sha256) || !AndroidRelease.officialAsset(url,candidate.file)) continue
                options+=candidate to url
            }
            val latest=options.maxByOrNull { it.first.build }
            prefs.edit().putLong("checkedAt",System.currentTimeMillis()).apply()
            assetUrl=latest?.second
            if(latest==null) state.value=UpdateState(message="Openfy está actualizado.")
            else {
                val ready=runCatching { verifyArchive(latest.first,File(directory,latest.first.file)); true }.getOrDefault(false)
                state.value=UpdateState(latest.first,ready=ready,message=if(ready) "APK verificado. Puedes instalar la actualización." else "Openfy ${latest.first.version} · ${latest.first.build} disponible en GitHub.")
            }
        } catch(error: CancellationException) { state.value=state.value.copy(busy=false); throw error }
        catch(_: Exception) { state.value=state.value.copy(busy=false,message="No se pudo comprobar GitHub. Reintenta cuando tengas conexión.") }
        finally { mutex.unlock() }
    }
    suspend fun download() = withContext(Dispatchers.IO) {
        mutex.withLock {
            val release=state.value.release ?: return@withLock
            val url=assetUrl ?: return@withLock
            directory.mkdirs()
            val target=File(directory,release.file)
            val partial=File(directory,release.file+".part")
            state.value=state.value.copy(busy=true,progress=0,message="Descargando actualización…")
            try {
                response(url).use { result ->
                    require(result.isSuccessful) { "Descarga no disponible." }
                    val body=result.body ?: error("Descarga vacía.")
                    require(body.contentLength()==-1L || body.contentLength()==release.bytes) { "Tamaño de descarga inesperado." }
                    body.byteStream().use { input -> partial.outputStream().use { output ->
                        val buffer=ByteArray(65536); var total=0L
                        while(true) {
                            currentCoroutineContext().ensureActive()
                            val n=input.read(buffer); if(n<0) break
                            total+=n; require(total<=release.bytes) { "La descarga supera el tamaño anunciado." }
                            output.write(buffer,0,n)
                            state.value=state.value.copy(progress=(total*100/release.bytes).toInt())
                        }
                    } }
                }
                verifyArchive(release,partial)
                check(partial.renameTo(target)) { "No se pudo guardar la actualización." }
                // Remove only APKs owned by this updater after a new verified package is ready.
                directory.listFiles()?.filter { it!=target && it.extension=="apk" }?.forEach { it.delete() }
                state.value=state.value.copy(busy=false,progress=null,ready=true,message="APK verificado. Puedes instalar la actualización.")
            } catch(error: CancellationException) { state.value=state.value.copy(busy=false,progress=null); throw error }
            catch(_: Exception) { state.value=state.value.copy(busy=false,progress=null,ready=false,message="No se pudo verificar la actualización. Vuelve a descargarla.") }
            finally { partial.delete() }
        }
    }
    @Suppress("DEPRECATION")
    internal fun verifyArchive(release: AndroidRelease,file: File) {
        release.validate(); release.verify(file)
        require(release.compatible(BuildConfig.VERSION_CODE.toLong(),Build.VERSION.SDK_INT,Build.SUPPORTED_ABIS.toList(),installedCertificate())) { "Esta actualización no es compatible con la instalación." }
        val info=ApkIdentity.read(app.packageManager,file.absolutePath) ?: error("El APK no es legible.")
        require(info.packageName==app.packageName && info.longVersionCode==release.build && info.versionName==release.version && info.applicationInfo?.minSdkVersion==release.minSdk) { "La identidad del APK no coincide." }
        val signers=info.signingInfo?.apkContentsSigners ?: error("APK sin firma.")
        require(signers.size==1 && AndroidRelease.hex(MessageDigest.getInstance("SHA-256").digest(signers.single().toByteArray())).equals(installedCertificate(),true)) { "La firma del APK no coincide con Openfy." }
    }
    suspend fun install(context: Context) {
        val release=state.value.release ?: return
        val file=File(directory,release.file)
        withContext(Dispatchers.IO) { verifyArchive(release,file) }
        if(!app.packageManager.canRequestPackageInstalls()) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${app.packageName}")))
            state.value=state.value.copy(message="Permite instalar actualizaciones de Openfy y vuelve a pulsar Instalar actualización.")
            return
        }
        val uri=FileProvider.getUriForFile(app,"${app.packageName}.updates",file)
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }
    private suspend fun bytes(url: String,limit: Int)=response(url).use { result ->
        require(result.isSuccessful) { "GitHub no está disponible." }
        result.body?.byteStream()?.use { it.readBounded(limit) } ?: error("Respuesta vacía.")
    }
    private suspend fun response(url: String): Response = suspendCancellableCoroutine { continuation ->
        val call=client.newCall(Request.Builder().url(url).header("User-Agent","Openfy-Android/${BuildConfig.VERSION_NAME}").header("Accept","application/vnd.github+json").build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object: Callback {
            override fun onFailure(call: Call,e: IOException) { if(continuation.isActive) continuation.resumeWithException(e) }
            override fun onResponse(call: Call,response: Response) { continuation.resume(response) { _,value,_ -> value.close() } }
        })
    }
    private fun matchesDigest(asset: JsonObject,hash: String)=asset["digest"]?.jsonPrimitive?.content?.equals("sha256:$hash",true)==true
}
