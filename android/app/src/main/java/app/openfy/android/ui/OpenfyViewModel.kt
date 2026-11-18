package app.openfy.android.ui

import android.app.Application
import android.content.ComponentName
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.*
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.room.withTransaction
import app.openfy.android.OpenfyApplication
import app.openfy.android.data.*
import app.openfy.android.playback.PlaybackService
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

data class LibraryState(val songs: List<Song> = emptyList(),val playlists: List<PlaylistRow> = emptyList(),
    val downloads: List<DownloadRow> = emptyList(),val listening: List<ListeningRow> = emptyList(),val recents: List<RecentContext> = emptyList())
data class PlayerState(val id: String? = null,val playing: Boolean = false,val position: Long = 0,val duration: Long = 0,
    val queue: List<String> = emptyList(),val index: Int = 0,val shuffle: Boolean = false,val repeat: Int = Player.REPEAT_MODE_OFF)
data class SearchState(val query: String = "",val kind: String = "songs",val songs: List<Song> = emptyList(),
    val cards: List<JsonObject> = emptyList(),val cursor: String? = null,val loading: Boolean = false,val error: String? = null)
data class DetailState(val kind: String,val id: String,val title: String,val subtitle: String = "",val artwork: String? = null,
    val songs: List<Song> = emptyList(),val albums: List<JsonObject> = emptyList(),val artists: List<JsonObject> = emptyList(),
    val loading: Boolean = false,val error: String? = null,val cursor: String? = null,val moreSongs: Boolean = false,
    val moreAlbums: Boolean = false,val moreSingles: Boolean = false,val releaseCursors: Map<String,String> = emptyMap())

class OpenfyViewModel(application: Application) : AndroidViewModel(application) {
    val app=application as OpenfyApplication
    val library=combine(app.database.library().observeSongs(),app.database.library().observePlaylists(),
        app.database.library().observeDownloads(),app.database.library().observeListening(),app.database.library().observeRecents().distinctUntilChanged()) { songs,playlists,downloads,listening,recents ->
        LibraryState(songs,playlists,downloads,listening,recents.mapNotNull { runCatching { Json.decodeFromString<RecentContext>(it) }.getOrNull() }.sortedByDescending { it.lastPlayedAt }.take(10))
    }.stateIn(viewModelScope,SharingStarted.WhileSubscribed(5000),LibraryState())
    val player=MutableStateFlow(PlayerState())
    val search=MutableStateFlow(SearchState())
    val detail=MutableStateFlow<DetailState?>(null)
    val notice=MutableStateFlow<String?>(null)
    val lyrics=MutableStateFlow<LyricsRow?>(null)
    val recommendations=MutableStateFlow<List<Song>>(emptyList())
    val releases=MutableStateFlow<List<JsonObject>>(emptyList())
    val tab=MutableStateFlow(0)
    private var searchJob: Job?=null
    private var detailJob: Job?=null
    private var lyricsJob: Job?=null
    private var generation=0L
    private val history=mutableListOf<DetailState>()
    private var controller: MediaController?=null
    private val controllerFuture=MediaController.Builder(application,SessionToken(application,ComponentName(application,PlaybackService::class.java))).buildAsync()

    init {
        controllerFuture.addListener({
            runCatching {
                controller=controllerFuture.get()
                controller!!.addListener(object : Player.Listener {
                    override fun onEvents(player: Player, events: Player.Events) { updatePlayer() }
                    override fun onPlayerError(error: PlaybackException) { notice.value="No se pudo reproducir la canción. Reintenta o elige otra." }
                })
                updatePlayer()
            }.onFailure { notice.value="No se pudo iniciar el reproductor." }
        },ContextCompat.getMainExecutor(application))
        viewModelScope.launch {
            var last: String?=null
            while(isActive) {
                if(player.subscriptionCount.value>0) updatePlayer()
                if(player.value.id!=last) { last=player.value.id; loadLyrics() }
                delay(if(player.subscriptionCount.value>0) 250 else 1000)
            }
        }
    }
    fun run(action: suspend () -> Unit) = viewModelScope.launch {
        try { action() } catch(error: Exception) {
            if(error is CancellationException) throw error
            notice.value=error.message?.takeIf { !it.contains("https://") }?.take(200) ?: "No se pudo completar la acción. Reintenta."
        }
    }
    private fun updatePlayer() {
        val c=controller ?: return
        val duration=c.duration.takeIf { it>0 } ?: library.value.songs.find { it.id==c.currentMediaItem?.mediaId }?.duration ?: 0
        player.value=PlayerState(c.currentMediaItem?.mediaId,c.isPlaying,c.currentPosition,duration,
            (0 until c.mediaItemCount).map { c.getMediaItemAt(it).mediaId },c.currentMediaItemIndex,c.shuffleModeEnabled,c.repeatMode)
    }
    fun selectTab(value: Int) { tab.value=value; detailJob?.cancel(); detail.value=null; history.clear() }
    fun back(): Boolean {
        if(detail.value==null) return false
        detailJob?.cancel(); generation++
        detail.value=if(history.isEmpty()) null else history.removeAt(history.lastIndex)
        return true
    }
    fun play(song: Song, songs: List<Song> = listOf(song), shuffled: Boolean = false) = run {
        val c=controller ?: error("El reproductor se está preparando")
        val playable=songs.filter { it.source=="youtube" || it.path!=null }
        app.database.withTransaction { for(row in playable) if(row.source=="youtube") app.repository.saveRemote(Json.parseToJsonElement(row.metadata).jsonObject) }
        if(playable.isEmpty()) return@run
        val source=detail.value
        val context=source?.let { page ->
            val kind=when(page.kind) { "playlist","favorites" -> page.kind; "album","localalbum" -> "album"; "artist","localartist" -> "artist"; else -> "song" }
            if(kind=="song") null else RecentContext(kind,if(page.kind in setOf("album","artist")) "youtube:${page.id}" else if(page.kind.startsWith("local")) "local:${page.id}" else page.id,
                library.value.playlists.find { it.id==page.id }?.name ?: page.title,page.subtitle,page.artwork ?: playable.firstOrNull()?.artwork)
        }
        c.setMediaItems(playable.map { value -> val item=PlaybackService.mediaItem(value); if(context==null) item else PlaybackService.withContext(item,Json.parseToJsonElement(Json.encodeToString(context)).jsonObject) },playable.indexOfFirst { it.id==song.id }.coerceAtLeast(0),0)
        c.shuffleModeEnabled=shuffled; c.prepare(); c.play()
    }
    fun toggle() { controller?.let { if(it.isPlaying) it.pause() else { it.prepare(); it.play() } } }
    fun openRecent(card: RecentContext) {
        when(card.kind) {
            "song" -> library.value.songs.find { it.id==card.id }?.let { play(it) }
            "favorites" -> openLocal("favorites","favorites","Tus favoritas",emptyList(),card.artwork)
            "playlist" -> openLocal("playlist",card.id,card.title,emptyList(),card.artwork)
            else -> if(card.id.startsWith("youtube:")) openRemote(card.kind,card.id.removePrefix("youtube:"),card.title)
                else openLocal(if(card.kind=="album") "localalbum" else "localartist",card.id.removePrefix("local:"),card.title,emptyList(),card.artwork)
        }
    }
    fun next() { controller?.seekToNextMediaItem() }
    fun previous() { controller?.let { if(it.currentPosition>3000) it.seekTo(0) else it.seekToPreviousMediaItem() } }
    fun seek(position: Long) { controller?.seekTo(position.coerceAtLeast(0)) }
    fun jump(index: Int) { controller?.let { it.seekTo(index,0); it.play() } }
    fun shuffle() { controller?.let { it.shuffleModeEnabled=!it.shuffleModeEnabled } }
    fun repeat() { controller?.let { it.repeatMode=(it.repeatMode+1)%3 } }
    fun queue(song: Song) = run {
        if(song.source=="youtube") app.repository.saveRemote(Json.parseToJsonElement(song.metadata).jsonObject)
        controller?.addMediaItem(PlaybackService.mediaItem(song)); notice.value="Añadida a la cola"
    }
    fun removeQueue(index: Int) { controller?.removeMediaItem(index) }
    fun moveQueue(from: Int,to: Int) { controller?.moveMediaItem(from,to) }
    fun favorite(song: Song) = run {
        if(song.source=="youtube") app.repository.saveRemote(Json.parseToJsonElement(song.metadata).jsonObject)
        app.repository.favorite(app.database.library().song(song.id) ?: song)
    }
    fun download(song: Song) = run {
        if(song.source=="youtube") { val saved=app.repository.saveRemote(Json.parseToJsonElement(song.metadata).jsonObject); app.database.library().save(song.id); app.downloads.add(saved) }
    }
    fun loadLyrics(refresh: Boolean = false) {
        lyricsJob?.cancel(); lyrics.value=null
        val id=player.value.id ?: return
        lyricsJob=run {
            val song=app.database.library().song(id) ?: return@run
            lyrics.value=app.database.library().lyrics(id)
            val result=app.lyrics.resolve(song,refresh)
            if(player.value.id==id) lyrics.value=result
        }
    }

    fun query(value: String, kind: String = search.value.kind) {
        searchJob?.cancel()
        search.value=SearchState(query=value,kind=kind)
        if(value.trim().length<2) return
        searchJob=run { delay(350); fetchSearch(false) }
    }
    fun moreSearch() {
        if(search.value.loading || search.value.cursor==null) return
        searchJob=run { fetchSearch(true) }
    }
    fun retrySearch() { searchJob?.cancel(); searchJob=run { fetchSearch(search.value.cursor!=null && (search.value.songs.isNotEmpty() || search.value.cards.isNotEmpty())) } }
    private suspend fun fetchSearch(more: Boolean) {
        val before=search.value
        search.value=before.copy(loading=true,error=null)
        try {
            val result=app.provider.call("search",buildJsonObject { put("query",before.query); put("kind",before.kind); if(more && before.cursor!=null) put("cursor",before.cursor) })
            val songs=result["songs"]?.jsonArray?.map { remoteSong(it.jsonObject) }.orEmpty()
            val cards=searchCards(before.kind,result)
            search.value=before.copy(songs=((if(more) before.songs else emptyList())+songs).distinctBy { it.id },
                cards=((if(more) before.cards else emptyList())+cards).distinctBy { it["id"] },
                cursor=result["nextCursor"]?.jsonPrimitive?.contentOrNull,loading=false)
        } catch(error: Exception) {
            if(error is CancellationException) throw error
            val expired=Regex("caduc|expired",RegexOption.IGNORE_CASE).containsMatchIn(error.message.orEmpty())
            search.value=before.copy(loading=false,cursor=if(expired) null else before.cursor,
                error=if(expired) "La búsqueda caducó. Pulsa Reintentar para actualizarla." else "No se pudo cargar la búsqueda. Puedes reintentar.")
        }
    }
    fun openLocal(kind: String,id: String,title: String,songs: List<Song>,artwork: String? = null) {
        detail.value?.let(history::add); detailJob?.cancel(); generation++
        detail.value=DetailState(kind,id,title,artwork=artwork,songs=songs)
    }
    fun openRemote(kind: String,id: String,title: String) {
        detail.value?.let(history::add); detailJob?.cancel(); val token=++generation
        detail.value=DetailState(kind,id,title,loading=true)
        detailJob=run {
            try {
                val value=app.provider.call(kind,buildJsonObject { put("id",id) })
                if(token!=generation) return@run
                detail.value=DetailState(kind,id,value["title"]?.jsonPrimitive?.content ?: value["name"]?.jsonPrimitive?.content ?: title,
                    value["description"]?.jsonPrimitive?.contentOrNull.orEmpty(),value["artwork"]?.jsonPrimitive?.contentOrNull,
                    (value["songs"] ?: value["topSongs"])?.jsonArray?.map { remoteSong(it.jsonObject) }.orEmpty(),
                    (value["albums"]?.jsonArray.orEmpty()+value["singles"]?.jsonArray.orEmpty()).map { it.jsonObject },
                    value["similar"]?.jsonArray?.map { it.jsonObject }.orEmpty(),
                    moreSongs=value["expandable"]?.jsonObject?.get("songs")?.jsonPrimitive?.booleanOrNull ?: false,
                    moreAlbums=value["expandable"]?.jsonObject?.get("albums")?.jsonPrimitive?.booleanOrNull ?: false,
                    moreSingles=value["expandable"]?.jsonObject?.get("singles")?.jsonPrimitive?.booleanOrNull ?: false)
            } catch(error: Exception) {
                if(error is CancellationException) throw error
                if(token==generation) detail.value=detail.value?.copy(loading=false,error="No se pudo abrir esta página. Reintenta.")
            }
        }
    }
    fun artistSongs() {
        val old=detail.value ?: return
        if(old.loading) return
        val token=generation
        detailJob=run {
            detail.value=old.copy(loading=true)
            try {
                val value=app.provider.call("artistSongs",buildJsonObject { put("id",old.id); old.cursor?.let { put("cursor",it) } })
                if(token==generation) detail.value=old.copy(songs=(old.songs+value.getValue("songs").jsonArray.map { remoteSong(it.jsonObject) }).distinctBy { it.id },
                    cursor=value["nextCursor"]?.jsonPrimitive?.contentOrNull,moreSongs=value["nextCursor"] !is JsonNull,loading=false)
            } catch(error: Exception) { if(error is CancellationException) throw error; if(token==generation) detail.value=old.copy(error="No se pudieron cargar más canciones.") }
        }
    }
    fun artistReleases(kind: String) {
        val old=detail.value ?: return
        if(old.loading) return
        val token=generation
        detailJob=run {
            detail.value=old.copy(loading=true)
            try {
                val value=app.provider.call("artistReleases",buildJsonObject { put("id",old.id); put("kind",kind); old.releaseCursors[kind]?.let { put("cursor",it) } })
                val cursor=value["nextCursor"]?.jsonPrimitive?.contentOrNull
                if(token==generation) detail.value=old.copy(albums=(old.albums+value.getValue("albums").jsonArray.map { it.jsonObject }).distinctBy { it["id"] },loading=false,
                    moreAlbums=if(kind=="albums") cursor!=null else old.moreAlbums,moreSingles=if(kind=="singles") cursor!=null else old.moreSingles,
                    releaseCursors=if(cursor==null) old.releaseCursors-kind else old.releaseCursors+(kind to cursor))
            } catch(error: Exception) { if(error is CancellationException) throw error; if(token==generation) detail.value=old.copy(error="No se pudieron cargar más lanzamientos.") }
        }
    }
    fun discover() = run {
        val rows=library.value.listening.groupBy { it.songId }.toList().sortedByDescending { it.second.sumOf { row -> row.listenedMs } }
        val seed=rows.mapNotNull { (id,_) -> library.value.songs.find { it.id==id && it.source=="youtube" } }.firstOrNull() ?: return@run
        val data=app.provider.call("recommendations",buildJsonObject {
            put("seed",Json.parseToJsonElement(seed.metadata)); put("excluded",JsonArray(library.value.listening.map { JsonPrimitive(it.songId.removePrefix("youtube:")) }.distinct()))
        })
        recommendations.value=data["songs"]?.jsonArray?.map { remoteSong(it.jsonObject) }.orEmpty()
        releases.value=data["albums"]?.jsonArray?.map { it.jsonObject }.orEmpty()
    }
    override fun onCleared() { MediaController.releaseFuture(controllerFuture); super.onCleared() }

    companion object {
        fun remoteSong(value: JsonObject)=Song(id="youtube:${value.getValue("videoId").jsonPrimitive.content}",title=value.getValue("title").jsonPrimitive.content,
            artist=value["artists"]?.jsonArray?.joinToString(", ") { it.jsonPrimitive.content }.orEmpty(),album=value["album"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            duration=((value["duration"]?.jsonPrimitive?.doubleOrNull ?: 0.0)*1000).toLong(),artwork=value["artwork"]?.jsonPrimitive?.contentOrNull,metadata=value.toString(),
            artistId=value["artistRefs"]?.jsonArray?.firstOrNull()?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull,albumId=value["albumId"]?.jsonPrimitive?.contentOrNull)
    }
}
