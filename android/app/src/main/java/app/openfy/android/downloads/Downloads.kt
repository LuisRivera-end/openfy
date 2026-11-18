package app.openfy.android.downloads

import android.app.Notification
import android.graphics.BitmapFactory
import android.net.Uri
import android.media.MediaDataSource
import android.media.MediaMetadataRetriever
import androidx.media3.common.C
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.exoplayer.offline.*
import androidx.media3.exoplayer.scheduler.Requirements
import androidx.media3.exoplayer.scheduler.Scheduler
import androidx.media3.exoplayer.scheduler.PlatformScheduler
import androidx.room.withTransaction
import app.openfy.android.OpenfyApplication
import app.openfy.android.data.*
import app.openfy.android.provider.readBounded
import app.openfy.android.ui.ArtworkUrls
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.coroutines.resume

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class Downloads(private val app: OpenfyApplication) {
    private val verifyMutex=Mutex()
    private val artworkWrites=Mutex()
    private val artworkUpgrade=Mutex()
    private val artworkDirectory=File(app.filesDir,"artwork")
    private val artworkHttp by lazy { app.http.newBuilder().followRedirects(false).build() }
    val manager=DownloadManager(app,StandaloneDatabaseProvider(app),app.cache,
        app.upstreamFactory,Executors.newFixedThreadPool(2)).apply {
        maxParallelDownloads=2
        setRequirements(Requirements(Requirements.NETWORK))
        addListener(object : DownloadManager.Listener {
            override fun onDownloadChanged(manager: DownloadManager, download: Download, error: Exception?) {
                app.scope.launch { update(download,error) }
            }
            override fun onDownloadRemoved(manager: DownloadManager, download: Download) {
                app.scope.launch {
                    app.database.library().offlineReady(download.request.id,false)
                    app.database.library().putDownload(DownloadRow(download.request.id,"removed"))
                }
            }
        })
    }

    init {
        app.scope.launch {
            while(isActive) {
                delay(1500)
                val current=withContext(Dispatchers.Main) { manager.currentDownloads }
                for(download in current) if(download.state!=Download.STATE_COMPLETED) update(download,null)
            }
        }
    }
    fun add(song: Song) {
        if(song.source!="youtube") return
        val request=DownloadRequest.Builder(song.id,Uri.parse("openfy://youtube/${song.id.removePrefix("youtube:")}"))
            .setCustomCacheKey(song.id).setMimeType("audio/mp4").build()
        app.scope.launch {
            // Restart failed resources from zero; paused downloads retain their verified resource identity.
            val failed=app.database.library().download(song.id)?.state=="error"
            withContext(Dispatchers.Main) {
                if(failed) DownloadService.sendRemoveDownload(app,AudioDownloadService::class.java,song.id,false)
                DownloadService.sendAddDownload(app,AudioDownloadService::class.java,request,true)
            }
        }
        app.scope.launch { app.lyrics.resolve(song) }
        app.scope.launch { cacheArtwork(song) }
    }
    fun pause(id: String, paused: Boolean) = DownloadService.sendSetStopReason(app,AudioDownloadService::class.java,id,if(paused) 1 else 0,false)
    fun remove(id: String) = DownloadService.sendRemoveDownload(app,AudioDownloadService::class.java,id,false)
    private suspend fun cacheArtwork(song: Song) {
        try {
            val original=song.artwork?.takeIf { it.startsWith("https://") } ?: metadataArtwork(song) ?: return
            val directory=artworkDirectory.canonicalFile
            val file=File(directory,"${song.id.removePrefix("youtube:")}.jpg").canonicalFile
            if(file.parentFile!=directory || !downloadArtwork(original,file)) return
            app.database.withTransaction {
                val dao=app.database.library()
                val current=dao.song(song.id) ?: return@withTransaction
                if(current.artwork!=file.absolutePath) dao.putSong(current.copy(artwork=file.absolutePath))
            }
        } catch(error: Exception) { if(error is CancellationException) throw error }
    }
    suspend fun upgradeArtwork() = withContext(Dispatchers.IO) {
        artworkUpgrade.withLock {
            val dao=app.database.library()
            val key="artwork:upgraded:v1"
            if(dao.meta(key)!=null) return@withLock
            val directory=artworkDirectory.canonicalFile.toPath()
            for(song in dao.songs()) {
                if(song.source!="youtube") continue
                currentCoroutineContext().ensureActive()
                try {
                    val file=song.artwork?.let(::File)?.takeIf { it.isAbsolute }?.canonicalFile ?: continue
                    if(!file.toPath().startsWith(directory) || artworkWidth(file) !in 1..511) continue
                    val original=metadataArtwork(song) ?: continue
                    downloadArtwork(original,file,upgrade=true)
                } catch(error: Exception) { if(error is CancellationException) throw error }
                delay(150)
            }
            dao.putMeta(SyncMeta(key,"true"))
        }
    }
    private fun metadataArtwork(song: Song): String? = runCatching {
        Json.parseToJsonElement(song.metadata).jsonObject["artwork"]?.jsonPrimitive?.contentOrNull
            ?.takeIf { it.startsWith("https://") }
    }.getOrNull()

    private suspend fun downloadArtwork(original: String, file: File, upgrade: Boolean=false): Boolean {
        val url=original.toHttpUrlOrNull() ?: return false
        if(!url.isHttps || listOf("ytimg.com","googleusercontent.com","ggpht.com").none { url.host==it || url.host.endsWith(".$it") }) return false
        val directory=file.parentFile ?: return false
        val large=ArtworkUrls.large(original)
        for(address in listOfNotNull(large,ArtworkUrls.fallback(large),original).distinct()) {
            val bytes=artworkBytes(address) ?: continue
            directory.mkdirs()
            val temporary=File.createTempFile("cover-",".partial",directory)
            try {
                temporary.writeBytes(bytes)
                val width=artworkWidth(temporary)
                if(width<=0) continue
                val ready=artworkWrites.withLock {
                    currentCoroutineContext().ensureActive()
                    val previous=artworkWidth(file)
                    if(upgrade && width<=previous) return@withLock false
                    if(width>=previous) Files.move(temporary.toPath(),file.toPath(),ATOMIC_MOVE,REPLACE_EXISTING)
                    true
                }
                if(ready) return true
            } finally { temporary.delete() }
        }
        return false
    }
    private fun artworkWidth(file: File): Int {
        if(!file.isFile) return 0
        val options=BitmapFactory.Options().apply { inJustDecodeBounds=true }
        BitmapFactory.decodeFile(file.absolutePath,options)
        return options.outWidth
    }
    private suspend fun artworkBytes(address: String): ByteArray? = suspendCancellableCoroutine { continuation ->
        val call=artworkHttp.newCall(Request.Builder().url(address).build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call,error: IOException) { continuation.resume(null) }
            override fun onResponse(call: Call,response: Response) {
                val bytes=try {
                    response.use { if(it.isSuccessful) it.body?.byteStream()?.use { input -> input.readBounded(8*1024*1024) } else null }
                } catch(_: IOException) { null }
                continuation.resume(bytes)
            }
        })
    }
    suspend fun syncCollections() {
        for(playlist in app.database.library().playlists().filter { it.keepDownloaded }) {
            for(id in CollectionRules.entries(playlist.entries)) {
                val song=app.database.library().song(id) ?: continue
                val prior=app.database.library().download(id)
                if(song.source=="youtube" && !song.offlineReady && prior==null) withContext(Dispatchers.Main) { add(song) }
            }
        }
    }
    suspend fun reconcile() {
        val dao=app.database.library()
        for(song in dao.songs().filter { it.source=="youtube" && it.offlineReady }) {
            val row=dao.download(song.id)
            if(row==null || row.total<=0 || app.cache.getCachedBytes(song.id,0,row.total)!=row.total) dao.offlineReady(song.id,false)
        }
        syncCollections()
    }
    private suspend fun update(download: Download, error: Exception?) {
        val dao=app.database.library()
        val id=download.request.id
        if(download.state==Download.STATE_COMPLETED) {
            verifyMutex.withLock {
                val old=dao.download(id)
                if(old?.state=="ready" && dao.song(id)?.offlineReady==true) return
                try {
                    dao.putDownload(DownloadRow(id,"verifying",download.bytesDownloaded,download.contentLength))
                    val data=CacheDataSource.Factory().setCache(app.cache).createDataSource()
                    val digest=MessageDigest.getInstance("SHA-256")
                    var count=0L
                    val expected=data.open(DataSpec.Builder().setUri(download.request.uri).setKey(id).build())
                    try {
                        val buffer=ByteArray(64*1024)
                        while(true) { val read=data.read(buffer,0,buffer.size); if(read==C.RESULT_END_OF_INPUT) break; digest.update(buffer,0,read); count+=read }
                    } finally { data.close() }
                    check(count>0 && (expected<0 || count==expected) && (download.contentLength<0 || count==download.contentLength)) { "Incomplete audio" }
                    val retriever=MediaMetadataRetriever()
                    try {
                        retriever.setDataSource(object : MediaDataSource() {
                            override fun getSize()=count
                            override fun close() {}
                            override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
                                if(position>=count) return -1
                                val source=CacheDataSource.Factory().setCache(app.cache).createDataSource()
                                source.open(DataSpec.Builder().setUri(download.request.uri).setKey(id).setPosition(position).setLength(minOf(size.toLong(),count-position)).build())
                                return try { source.read(buffer,offset,minOf(size.toLong(),count-position).toInt()) } finally { source.close() }
                            }
                        })
                        check((retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0)>0) { "Unreadable audio" }
                    } finally { retriever.release() }
                    if(dao.download(id)?.state=="removed") return
                    val hash=digest.digest().joinToString("") { "%02x".format(it) }
                    dao.putDownload(DownloadRow(id,"ready",count,count,hash))
                    dao.offlineReady(id,true)
                } catch(error: Exception) {
                    dao.offlineReady(id,false)
                    dao.putDownload(DownloadRow(id,"error",error="No se pudo verificar el audio. Reintenta la descarga."))
                }
            }
        } else {
            val state=when(download.state) {
                Download.STATE_DOWNLOADING -> "downloading"
                Download.STATE_FAILED -> "error"
                Download.STATE_STOPPED -> "paused"
                Download.STATE_REMOVING -> "removing"
                else -> "queued"
            }
            dao.putDownload(DownloadRow(id,state,download.bytesDownloaded,download.contentLength,
                error=if(error!=null || download.state==Download.STATE_FAILED) "Descarga interrumpida. Puedes reintentar." else null))
        }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AudioDownloadService : DownloadService(2001,1000,"downloads",app.openfy.android.R.string.download_channel_name,0) {
    override fun getDownloadManager()=(application as OpenfyApplication).downloads.manager
    override fun getScheduler(): Scheduler = PlatformScheduler(this,2001)
    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification {
        return DownloadNotificationHelper(this,"downloads").buildProgressNotification(this,
            app.openfy.android.R.drawable.ic_openfy,null,"Descargando música",downloads,notMetRequirements)
    }
    override fun onTimeout(startId: Int, fgsType: Int) {
        downloadManager.pauseDownloads(); stopSelf()
    }
}
