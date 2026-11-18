package app.openfy.android.downloads

import android.app.Notification
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
import app.openfy.android.OpenfyApplication
import app.openfy.android.data.*
import app.openfy.android.provider.readBounded
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.security.MessageDigest
import java.util.concurrent.Executors

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class Downloads(private val app: OpenfyApplication) {
    private val verifyMutex=Mutex()
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
        val address=song.artwork?.takeIf { it.startsWith("https://") } ?: return
        try {
            val uri=java.net.URI(address)
            if(listOf("ytimg.com","googleusercontent.com","ggpht.com").none { uri.host==it || uri.host.endsWith(".$it") }) return
            val bytes=app.http.newCall(okhttp3.Request.Builder().url(address).build()).execute().use {
                if(!it.isSuccessful) return
                it.body!!.byteStream().use { input -> input.readBounded(4*1024*1024) }
            }
            val directory=java.io.File(app.filesDir,"artwork").apply { mkdirs() }
            val file=java.io.File(directory,"${song.id.removePrefix("youtube:")}.jpg")
            file.writeBytes(bytes)
            app.database.library().song(song.id)?.let { app.database.library().putSong(it.copy(artwork=file.absolutePath)) }
        } catch(error: Exception) { if(error is CancellationException) throw error }
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
