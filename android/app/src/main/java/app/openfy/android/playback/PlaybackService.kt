package app.openfy.android.playback

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.media3.common.*
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.*
import androidx.room.withTransaction
import app.openfy.android.OpenfyApplication
import app.openfy.android.MainActivity
import app.openfy.android.data.*
import app.openfy.android.preferences
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import java.io.File

internal data class PendingListening(
    val songId: String,
    val day: String,
    var listenedMs: Long,
    var plays: Int,
    var lastPlayedAt: Long
)

internal class ListeningBatcher {
    val pending = mutableMapOf<String, PendingListening>()
    var recent: RecentContext? = null
        private set
    var lastFlushAt = 0L

    val isEmpty: Boolean get() = pending.isEmpty() && recent == null

    fun accumulate(days: Map<String, Long>, songId: String, counted: Boolean, at: Long, recentContext: RecentContext?) {
        days.forEach { (day, amount) ->
            val key = "$day:$songId"
            val cur = pending.getOrPut(key) { PendingListening(songId, day, 0L, 0, at) }
            cur.listenedMs += amount
            if (counted && day == days.keys.last()) cur.plays += 1
            cur.lastPlayedAt = at
        }
        if (recentContext != null) recent = recentContext
    }

    fun shouldFlush(counted: Boolean, nowMonotonic: Long, force: Boolean = false): Boolean {
        if (isEmpty) return false
        return force || counted || (pending.isNotEmpty() && nowMonotonic - lastFlushAt >= 15_000L)
    }

    fun drain(nowMonotonic: Long): Pair<Map<String, PendingListening>, RecentContext?> {
        val drained = HashMap(pending)
        val drainedRecent = recent
        pending.clear()
        recent = null
        lastFlushAt = nowMonotonic
        return drained to drainedRecent
    }

    fun restore(flushed: Map<String, PendingListening>, flushedRecent: RecentContext?) {
        flushed.forEach { (key, p) ->
            val cur = pending[key]
            if (cur == null) {
                pending[key] = p
            } else {
                cur.listenedMs += p.listenedMs
                cur.plays += p.plays
                cur.lastPlayedAt = maxOf(cur.lastPlayedAt, p.lastPlayedAt)
            }
        }
        if (flushedRecent != null && recent == null) {
            recent = flushedRecent
        }
    }
}

internal data class QueueSnapshotState(
    val count: Int,
    val index: Int,
    val position: Long,
    val repeat: Int,
    val shuffle: Boolean,
    val queueIds: List<String>,
    val contexts: List<String?>
) {
    fun isIdentical(other: QueueSnapshotState): Boolean =
        count == other.count && index == other.index && position == other.position &&
        repeat == other.repeat && shuffle == other.shuffle &&
        queueIds == other.queueIds && contexts == other.contexts

    fun hasSameQueueAndContexts(other: QueueSnapshotState): Boolean =
        count == other.count && queueIds == other.queueIds && contexts == other.contexts
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private val app get() = application as OpenfyApplication
    private val scope = CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
    private lateinit var player: ExoPlayer
    private var session: MediaSession? = null
    private var restore: Job? = null
    private var listening = ListeningClock()
    private val batcher = ListeningBatcher()
    private var songId: String? = null
    private var lastDuration=0L
    private var recordedRecent=false
    private var playbackContext=""
    private var lastSnapshot: QueueSnapshotState? = null
    private var lastContextsJson: JsonArray? = null

    override fun onCreate() {
        super.onCreate()
        player=ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(app.audioFactory))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),true)
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_NETWORK).build()
        val activityIntent = android.app.PendingIntent.getActivity(this,0,
            Intent(this,MainActivity::class.java),android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT)
        session=MediaSession.Builder(this,player).setSessionActivity(activityIntent).setCallback(object : MediaSession.Callback {
            override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                if(controller.packageName != packageName && !controller.isTrusted) return MediaSession.ConnectionResult.reject()
                return super.onConnect(session,controller)
            }
            override fun onAddMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo, items: List<MediaItem>): ListenableFuture<List<MediaItem>> {
                val future=SettableFuture.create<List<MediaItem>>()
                scope.launch {
                    try {
                        restore?.join()
                        future.set(items.mapNotNull { requested -> app.database.library().song(requested.mediaId)?.let { song ->
                            val item=mediaItem(song)
                            item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setExtras(requested.mediaMetadata.extras ?: item.mediaMetadata.extras).build()).build()
                        } })
                    } catch(error: Throwable) { future.setException(error) }
                }
                return future
            }
        }).build()
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                recordListening(forceFlush = true)
                songId=item?.mediaId; listening=ListeningClock(); lastDuration=0; recordedRecent=false
                playbackContext=item?.mediaMetadata?.extras?.getString("openfy.context").orEmpty(); resetClock()
                publish(); scope.launch { persist() }
            }
            override fun onPositionDiscontinuity(old: Player.PositionInfo, next: Player.PositionInfo, reason: Int) {
                recordListening(old.positionMs, lastDuration, forceFlush = true)
                resetClock()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if(isPlaying) recordedRecent=false
                recordListening(forceFlush = !isPlaying)
                publish()
                scope.launch { persist() }
            }
        })
        restore=scope.launch {
            val saved=preferences.data.first()[SNAPSHOT] ?: return@launch
            runCatching {
                val data=Json.parseToJsonElement(saved).jsonObject
                val queue=data.getValue("queue").jsonArray.mapIndexedNotNull { index,key -> app.database.library().song(key.jsonPrimitive.content)?.let { song ->
                    val item=mediaItem(song)
                    val context=data["contexts"]?.jsonArray?.getOrNull(index)?.takeIf { it is JsonObject }?.jsonObject
                    if(context==null) item else withContext(item,context)
                } }
                if(queue.isNotEmpty()) {
                    player.setMediaItems(queue,(data["index"]?.jsonPrimitive?.int ?: 0).coerceIn(queue.indices),data["position"]?.jsonPrimitive?.long ?: 0)
                    player.repeatMode=data["repeat"]?.jsonPrimitive?.int ?: Player.REPEAT_MODE_OFF
                    player.shuffleModeEnabled=data["shuffle"]?.jsonPrimitive?.boolean ?: false
                    player.playWhenReady=false
                }
            }
            publish()
        }
        scope.launch {
            restore?.join()
            var ticks=0
            while(isActive) {
                delay(1000)
                recordListening()
                if(++ticks%5==0) persist()
            }
        }
    }
    private fun publish() { app.nowPlaying.value=NowPlaying(player.currentMediaItem?.mediaId,player.isPlaying) }
    private fun resetClock() { if(::player.isInitialized) listening.reset(player.currentPosition,SystemClock.elapsedRealtime(),System.currentTimeMillis(),player.isPlaying) }
    private fun recordListening(position: Long = player.currentPosition, duration: Long = player.duration.coerceAtLeast(0), forceFlush: Boolean = false) {
        val id=songId ?: return
        val at=System.currentTimeMillis()
        if(duration>0) lastDuration=duration
        val (days,counted)=listening.sample(position,lastDuration,SystemClock.elapsedRealtime(),at,player.isPlaying)
        val recent=if(days.isNotEmpty() && !recordedRecent) runCatching { Json.decodeFromString<RecentContext>(playbackContext).copy(lastPlayedAt=at) }.getOrNull() else null
        if(recent!=null) recordedRecent=true
        val shouldFlush: Boolean
        val now=SystemClock.elapsedRealtime()
        synchronized(batcher) {
            if(days.isNotEmpty()) {
                batcher.accumulate(days,id,counted,at,recent)
            }
            shouldFlush=batcher.shouldFlush(counted,now,forceFlush)
        }
        if(shouldFlush) flushListening()
    }
    private fun flushListening(blocking: Boolean = false) {
        val now=SystemClock.elapsedRealtime()
        val (toFlush,recentToFlush)=synchronized(batcher) {
            if(batcher.isEmpty) return
            batcher.drain(now)
        }
        val action: suspend () -> Unit = {
            try {
                app.database.withTransaction {
                    val dao=app.database.library()
                    toFlush.values.forEach { pending ->
                        val key="${pending.day}:${pending.songId}"
                        val prior=dao.listening(key) ?: ListeningRow(key,pending.songId,pending.day)
                        dao.putListening(prior.copy(
                            listenedMs=prior.listenedMs+pending.listenedMs,
                            plays=prior.plays+pending.plays,
                            lastPlayedAt=maxOf(prior.lastPlayedAt,pending.lastPlayedAt)
                        ))
                    }
                    if(recentToFlush!=null) {
                        dao.putMeta(SyncMeta("recent:${recentToFlush.kind}:${recentToFlush.id}",Json.encodeToString(recentToFlush)))
                        dao.recents().mapNotNull { runCatching { Json.decodeFromString<RecentContext>(it) }.getOrNull() }
                            .sortedByDescending { it.lastPlayedAt }.drop(64).forEach { dao.deleteMeta("recent:${it.kind}:${it.id}") }
                    }
                }
            } catch(error: Throwable) {
                if(error is CancellationException) throw error
                synchronized(batcher) { batcher.restore(toFlush,recentToFlush) }
            }
        }
        if(blocking) {
            runCatching { runBlocking(Dispatchers.IO) { kotlinx.coroutines.withTimeout(2000) { action() } } }
        } else {
            app.scope.launch { action() }
        }
    }
    private suspend fun persist() {
        if(restore?.isActive==true || player.mediaItemCount==0) return
        val count=player.mediaItemCount
        val index=player.currentMediaItemIndex
        val pos=player.currentPosition
        val repeat=player.repeatMode
        val shuffle=player.shuffleModeEnabled
        val queueIds=(0 until count).map { player.getMediaItemAt(it).mediaId }
        val contextRaws=(0 until count).map { player.getMediaItemAt(it).mediaMetadata.extras?.getString("openfy.context") }
        val current=QueueSnapshotState(count,index,pos,repeat,shuffle,queueIds,contextRaws)
        val prior=lastSnapshot
        if(prior!=null && current.isIdentical(prior)) return

        val contextsJson=if(prior!=null && current.hasSameQueueAndContexts(prior) && lastContextsJson!=null) {
            lastContextsJson!!
        } else {
            JsonArray(contextRaws.map { raw ->
                runCatching { Json.parseToJsonElement(raw ?: "{}") }.getOrDefault(JsonObject(emptyMap()))
            })
        }
        val snapshot=buildJsonObject {
            put("version",3); put("queue",JsonArray(queueIds.map { JsonPrimitive(it) }))
            put("index",index); put("position",pos)
            put("repeat",repeat); put("shuffle",shuffle)
            put("contexts",contextsJson)
        }.toString()
        lastSnapshot=current
        lastContextsJson=contextsJson
        preferences.edit { it[SNAPSHOT]=snapshot }
    }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session
    override fun onTaskRemoved(rootIntent: Intent?) { if(!player.playWhenReady) stopSelf() }
    override fun onDestroy() {
        recordListening(forceFlush = true)
        flushListening(blocking = true)
        app.nowPlaying.value=app.nowPlaying.value.copy(playing=false)
        scope.cancel(); session?.release(); player.release(); super.onDestroy()
    }
    companion object {
        val SNAPSHOT=stringPreferencesKey("playback.v3")
        fun mediaItem(song: Song): MediaItem = MediaItem.Builder().setMediaId(song.id)
            .setUri(if(song.source=="local") Uri.fromFile(File(requireNotNull(song.path))) else Uri.parse("openfy://youtube/${song.id.removePrefix("youtube:")}"))
            .setCustomCacheKey(song.id)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(song.title).setArtist(song.artist).setAlbumTitle(song.album)
                .setExtras(android.os.Bundle().apply { putString("openfy.context",Json.encodeToString(RecentContext("song",song.id,song.title,song.artist,song.artwork))) })
                .setArtworkUri(song.artwork?.let {
                    if(it.startsWith("https:")) Uri.parse(app.openfy.android.ui.ArtworkUrls.large(it)) else Uri.fromFile(File(it))
                }).build()).build()
        fun withContext(item: MediaItem,context: JsonObject): MediaItem = item.buildUpon()
            .setMediaMetadata(item.mediaMetadata.buildUpon().setExtras(android.os.Bundle().apply { putString("openfy.context",context.toString()) }).build()).build()
    }
}
