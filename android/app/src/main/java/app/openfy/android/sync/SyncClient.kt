package app.openfy.android.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.room.withTransaction
import androidx.work.*
import app.openfy.android.OpenfyApplication
import app.openfy.android.BuildConfig
import app.openfy.android.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SyncClient(private val app: OpenfyApplication) {
    private val prefs=app.getSharedPreferences("sync",Context.MODE_PRIVATE)
    private val mutex=Mutex()
    val status=MutableStateFlow(if(prefs.contains("token")) "Lista para sincronizar" else "Sin vincular")
    val linked get()=prefs.contains("token")
    val origin get()=prefs.getString("origin","").orEmpty()
    private val http=app.http.newBuilder().followRedirects(false).followSslRedirects(false).build()
    private fun key(): SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("openfy.sync",null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("openfy.sync",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun seal(token: String): String {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key())
        return Base64.getEncoder().encodeToString(cipher.iv+cipher.doFinal(token.toByteArray()))
    }
    private fun token(): String {
        val bytes=Base64.getDecoder().decode(prefs.getString("token",null) ?: error("Sin vincular"))
        val cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)))
        return String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)),Charsets.UTF_8)
    }
    suspend fun pair(address: String, code: String) = withContext(Dispatchers.IO) {
        val uri=java.net.URI(address.trim())
        val loopback=BuildConfig.DEBUG && uri.scheme=="http" && uri.host=="127.0.0.1" && uri.port in 1024..65535
        require(uri.userInfo==null && uri.query==null && uri.fragment==null && uri.path.orEmpty() in setOf("","/") &&
            (loopback || uri.scheme=="https" && (uri.port==-1 || uri.port==443) && uri.host?.endsWith(".ts.net")==true)) { "Introduce la dirección HTTPS privada de Tailscale." }
        val base=if(loopback) "http://127.0.0.1:${uri.port}" else "https://${uri.host}"
        val id=UUID.randomUUID().toString()
        val result=post(base,"pair",buildJsonObject { put("code",code); put("deviceId",id); put("name",android.os.Build.MODEL.take(100)) },null)
        app.database.withTransaction {
            app.database.library().putMeta(SyncMeta("cursor","0"))
            app.database.library().resetSyncRevisions()
            // Existing local edits are already in the outbox. Seed any imported favorites/playlists once.
            val dao=app.database.library()
            var sequence=dao.meta("sequence")?.toLongOrNull() ?: 0
            for(song in dao.songs().filter { it.source=="youtube" && it.favorite }) if(dao.pendingFor(song.id).isEmpty()) {
                dao.enqueue(OutboxRow(UUID.randomUUID().toString(),++sequence,"favorite",song.id,0,
                    buildJsonObject { put("song",Json.parseToJsonElement(song.metadata)); put("favorite",true) }.toString()))
            }
            for(row in dao.playlists().filterNot { it.localOnly }) {
                dao.putPlaylist(row.copy(syncRevision=0))
                dao.rebase(row.id,0,0)
                if(dao.pendingFor(row.id).isEmpty()) dao.enqueue(OutboxRow(UUID.randomUUID().toString(),++sequence,"playlist",row.id,0,app.repository.playlistPayload(row).toString()))
            }
            dao.putMeta(SyncMeta("sequence",sequence.toString()))
        }
        prefs.edit().putString("origin",base).putString("device",id).putString("token",seal(result.getValue("token").jsonPrimitive.content)).commit()
        schedule(); exchange()
    }
    fun unlink() {
        prefs.edit().remove("token").remove("device").apply()
        WorkManager.getInstance(app).cancelUniqueWork("openfy-sync-periodic")
        status.value="Sin vincular"
    }
    fun schedule() {
        app.scope.launch { app.downloads.syncCollections() }
        if(!linked) return
        val constraints=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(app).enqueueUniquePeriodicWork("openfy-sync-periodic",ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15,TimeUnit.MINUTES).setConstraints(constraints).build())
        WorkManager.getInstance(app).enqueueUniqueWork("openfy-sync-now",ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(constraints).build())
    }
    suspend fun exchange() = mutex.withLock {
        if(!linked) return@withLock
        status.value="Sincronizando…"
        try {
            var more: Boolean
            do {
                val dao=app.database.library(); val pending=dao.pending()
                val result=post(origin,"exchange",buildJsonObject {
                    put("deviceId",prefs.getString("device","")!!); put("cursor",dao.meta("cursor")?.toLongOrNull() ?: 0)
                    put("operations",JsonArray(pending.map { op -> buildJsonObject {
                        put("operationId",op.operationId); put("sequence",op.sequence); put("kind",op.kind); put("entityId",op.entityId)
                        put("baseRevision",op.baseRevision); put("payload",Json.parseToJsonElement(op.payload))
                    } }))
                },token())
                app.database.withTransaction {
                    for(ack in result.getValue("acknowledgements").jsonArray.map { it.jsonObject }) {
                        val operationId=ack.getValue("operationId").jsonPrimitive.content
                        val op=pending.find { it.operationId==operationId } ?: continue
                        dao.acknowledge(operationId)
                        val revision=ack.getValue("revision").jsonPrimitive.long
                        dao.putMeta(SyncMeta("revision:${op.entityId}",revision.toString()))
                        dao.rebase(op.entityId,revision,op.sequence)
                        dao.playlist(op.entityId)?.let { dao.putPlaylist(it.copy(syncRevision=revision)) }
                    }
                    for(change in result.getValue("changes").jsonArray.map { it.jsonObject }) apply(change)
                    dao.putMeta(SyncMeta("cursor",result.getValue("cursor").toString()))
                }
                more=result.getValue("hasMore").jsonPrimitive.boolean || dao.pending().isNotEmpty()
            } while(more)
            app.downloads.syncCollections(); status.value="Favoritos y playlists al día"
        } catch(error: Exception) {
            if(error is CancellationException) throw error
            status.value=error.message?.take(200) ?: "Pendiente de conexión con Windows"
            throw error
        }
    }
    private suspend fun apply(change: JsonObject) {
        val dao=app.database.library(); val id=change.getValue("entityId").jsonPrimitive.content
        if(dao.pendingFor(id).isNotEmpty()) return
        val revision=change.getValue("revision").jsonPrimitive.long
        val known=maxOf(dao.meta("revision:$id")?.toLongOrNull() ?: 0,dao.playlist(id)?.syncRevision ?: 0)
        if(revision<known) return
        dao.putMeta(SyncMeta("revision:$id",revision.toString()))
        if(change.getValue("kind").jsonPrimitive.content=="favorite") {
            val payload=change.getValue("payload").jsonObject
            app.repository.saveRemote(payload.getValue("song").jsonObject)
            dao.favorite(id,payload.getValue("favorite").jsonPrimitive.boolean)
            if(payload.getValue("favorite").jsonPrimitive.boolean) dao.save(id)
        } else if(change.getValue("deleted").jsonPrimitive.boolean) {
            dao.playlist(id)?.let { row ->
                val local=CollectionRules.entries(row.entries).filterNot { it.startsWith("youtube:") }
                if(local.isNotEmpty()) dao.putPlaylist(PlaylistRow(UUID.randomUUID().toString(),"${row.name} (local)",CollectionRules.encode(local),localOnly=true))
            }
            dao.deletePlaylist(id)
        } else {
            val payload=change.getValue("payload").jsonObject
            payload.getValue("songs").jsonArray.forEach { val saved=app.repository.saveRemote(it.jsonObject); dao.save(saved.id) }
            val prior=dao.playlist(id)
            val combined=CollectionRules.applyPortable(prior?.let { CollectionRules.entries(it.entries) } ?: emptyList(),payload.getValue("trackIds").jsonArray.map { it.jsonPrimitive.content })
            dao.putPlaylist((prior ?: PlaylistRow(id,payload.getValue("name").jsonPrimitive.content)).copy(
                name=payload.getValue("name").jsonPrimitive.content,entries=CollectionRules.encode(combined),syncRevision=revision))
        }
    }
    private suspend fun post(base: String, path: String, body: JsonObject, bearer: String?): JsonObject = withContext(Dispatchers.IO) {
        val request=Request.Builder().url("$base/api/sync/v1/$path").post(body.toString().toRequestBody("application/json".toMediaType()))
        if(bearer!=null) request.header("Authorization","Bearer $bearer")
        http.newCall(request.build()).execute().use {
            if(!it.isSuccessful) throw IllegalStateException(when(it.code) {
                401 -> "Vuelve a vincular el dispositivo desde Windows."
                409 -> "Hay cambios pendientes que necesitan volver a sincronizarse."
                else -> "Windows no está disponible (${it.code}). Se conservan los cambios pendientes."
            })
            Json.parseToJsonElement(it.body!!.string()).jsonObject
        }
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context,params) {
    override suspend fun doWork(): Result = try { (applicationContext as OpenfyApplication).sync.exchange(); Result.success() }
    catch(error: Exception) { if(error is CancellationException) throw error; Result.retry() }
}
