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

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private val app get() = application as OpenfyApplication
    private val scope = CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
    private lateinit var player: ExoPlayer
    private var session: MediaSession? = null
    private var restore: Job? = null
    private var listening = ListeningClock()
    private var songId: String? = null
    private var lastDuration=0L
    private var recordedRecent=false
    private var playbackContext=""

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
                songId=item?.mediaId; listening=ListeningClock(); lastDuration=0; recordedRecent=false
                playbackContext=item?.mediaMetadata?.extras?.getString("openfy.context").orEmpty(); resetClock()
                scope.launch { persist() }
            }
            override fun onPositionDiscontinuity(old: Player.PositionInfo, next: Player.PositionInfo, reason: Int) { recordListening(old.positionMs,lastDuration); resetClock() }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if(isPlaying) recordedRecent=false; recordListening(); scope.launch { persist() } }
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
    private fun resetClock() { if(::player.isInitialized) listening.reset(player.currentPosition,SystemClock.elapsedRealtime(),System.currentTimeMillis(),player.isPlaying) }
    private fun recordListening(position: Long = player.currentPosition,duration: Long = player.duration.coerceAtLeast(0)) {
        val id=songId ?: return
        val at=System.currentTimeMillis()
        if(duration>0) lastDuration=duration
        val (days,counted)=listening.sample(position,lastDuration,SystemClock.elapsedRealtime(),at,player.isPlaying)
        if(days.isEmpty()) return
        val recent=if(!recordedRecent) runCatching { Json.decodeFromString<RecentContext>(playbackContext).copy(lastPlayedAt=at) }.getOrNull() else null
        recordedRecent=true
        app.scope.launch { app.database.withTransaction {
            val dao=app.database.library()
            days.forEach { (day,amount) ->
                val key="$day:$id"; val prior=dao.listening(key) ?: ListeningRow(key,id,day)
                dao.putListening(prior.copy(listenedMs=prior.listenedMs+amount,plays=prior.plays+if(counted && day==days.keys.last()) 1 else 0,lastPlayedAt=at))
            }
            if(recent!=null) {
                dao.putMeta(SyncMeta("recent:${recent.kind}:${recent.id}",Json.encodeToString(recent)))
                dao.recents().mapNotNull { runCatching { Json.decodeFromString<RecentContext>(it) }.getOrNull() }
                    .sortedByDescending { it.lastPlayedAt }.drop(64).forEach { dao.deleteMeta("recent:${it.kind}:${it.id}") }
            }
        } }
    }
    private suspend fun persist() {
        if(restore?.isActive==true || player.mediaItemCount==0) return
        val snapshot=buildJsonObject {
            put("version",3); put("queue",JsonArray((0 until player.mediaItemCount).map { JsonPrimitive(player.getMediaItemAt(it).mediaId) }))
            put("index",player.currentMediaItemIndex); put("position",player.currentPosition)
            put("repeat",player.repeatMode); put("shuffle",player.shuffleModeEnabled)
            put("contexts",JsonArray((0 until player.mediaItemCount).map { index ->
                runCatching { Json.parseToJsonElement(player.getMediaItemAt(index).mediaMetadata.extras?.getString("openfy.context") ?: "{}") }.getOrDefault(JsonObject(emptyMap()))
            }))
        }.toString()
        preferences.edit { it[SNAPSHOT]=snapshot }
    }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session
    override fun onTaskRemoved(rootIntent: Intent?) { if(!player.playWhenReady) stopSelf() }
    override fun onDestroy() {
        // Preference writes are normally checkpointed every five seconds and on transport changes.
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
