package app.openfy.android.ui

import android.app.Application
import android.content.ComponentName
import androidx.compose.runtime.mutableStateMapOf
import androidx.core.content.ContextCompat
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.*
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.room.withTransaction
import app.openfy.android.OpenfyApplication
import app.openfy.android.data.*
import app.openfy.android.playback.PlaybackService
import app.openfy.android.preferences
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import java.io.IOException
import coil3.toBitmap
import coil3.request.allowHardware

data class LibraryState(val songs: List<Song> = emptyList(),val playlists: List<PlaylistRow> = emptyList(),
    val downloads: List<DownloadRow> = emptyList(),val listening: List<ListeningRow> = emptyList(),val recents: List<RecentContext> = emptyList(),
    internal val ready: Boolean = false,internal val recentSongs: List<Song> = emptyList(),
    internal val homePlaylists: List<RecentContext> = emptyList())
data class PlayerState(val id: String? = null,val playing: Boolean = false,val position: Long = 0,val duration: Long = 0,
    val queue: List<String> = emptyList(),val index: Int = 0,val shuffle: Boolean = false,val repeat: Int = Player.REPEAT_MODE_OFF,
    val context: String? = null,val upcoming: List<Int>? = null)
data class SearchState(val query: String = "",val kind: String = "songs",val songs: List<Song> = emptyList(),
    val cards: List<JsonObject> = emptyList(),val cursor: String? = null,val loading: Boolean = false,val error: String? = null,
    val pending: Boolean = false)
data class DetailState(val kind: String,val id: String,val title: String,val subtitle: String = "",val artwork: String? = null,
    val songs: List<Song> = emptyList(),val albums: List<JsonObject> = emptyList(),val artists: List<JsonObject> = emptyList(),
    val loading: Boolean = false,val error: String? = null,val cursor: String? = null,val moreSongs: Boolean = false,
    val moreAlbums: Boolean = false,val moreSingles: Boolean = false,val releaseCursors: Map<String,String> = emptyMap(),
    val year: Int? = null,val artist: String? = null,val banner: String? = null,val singles: List<JsonObject> = emptyList())

@Serializable
private data class DiscoveryCache(val songs: List<Song>, val albums: List<JsonObject>, val fetchedAt: Long)

private val discoveryCacheKey = stringPreferencesKey("home-discovery-v1")
private const val discoveryCacheTtl = 60 * 60 * 1000L

private data class DiscoveryInputs(val songs: List<Song>, val playlists: List<PlaylistRow>, val listenedIds: Set<String>) {
    constructor(library: LibraryState) : this(library.songs, library.playlists, library.listening.mapTo(hashSetOf()) { it.songId })

    fun collectionIds(): Set<String> = buildSet {
        playlists.forEach { addAll(CollectionRules.entries(it.entries)) }
        songs.forEach { if (it.saved || it.favorite || it.source == "local" || it.offlineReady) add(it.id) }
    }
}

private class DiscoveryExclusions(inputs: DiscoveryInputs) {
    private val collectionIds = inputs.collectionIds()
    private val knownIds = collectionIds + inputs.listenedIds
    private val songsByKey = buildMap<String, MutableSet<String>> {
        inputs.songs.filter { it.id in knownIds }.forEach { song ->
            discoverySongKeys(song).forEach { key -> getOrPut(key) { mutableSetOf() }.add(song.id) }
        }
    }
    val albumIds = inputs.songs.filter { it.id in knownIds }.mapNotNull { it.albumId }.toHashSet()

    fun permits(song: Song, activeId: String? = null): Boolean {
        // Keep the current card in place while its first listen is recorded.
        val allowedId = activeId?.takeIf { it == song.id && it !in collectionIds }
        return (song.id == allowedId || song.id !in knownIds) &&
            discoverySongKeys(song).none { key -> songsByKey[key]?.any { it != allowedId } == true }
    }
}

class OpenfyViewModel(application: Application) : AndroidViewModel(application) {
    val app=application as OpenfyApplication
    private val dao = app.database.library()
    private val collections = combine(dao.observeSongs().distinctUntilChanged(), dao.observePlaylists().distinctUntilChanged()) { songs, playlists ->
        val songMap = songs.associateBy { it.id }
        val homePlaylists = playlists.map { playlist ->
            val first = CollectionRules.entries(playlist.entries).firstOrNull()?.let(songMap::get)
            RecentContext("playlist", playlist.id, playlist.name, artwork = first?.artwork)
        }
        LibraryState(songs = songs, playlists = playlists, homePlaylists = homePlaylists)
    }
    val library=combine(collections, dao.observeDownloads(), dao.observeListening(), dao.observeRecents().distinctUntilChanged()) { contents,downloads,listening,recents ->
        val contexts = recents.mapNotNull { runCatching { Json.decodeFromString<RecentContext>(it) }.getOrNull() }
            .sortedByDescending { it.lastPlayedAt }.take(10)
        contents.copy(downloads = downloads, listening = listening, recents = contexts, ready = true,
            recentSongs = if (contexts.isEmpty()) recentHomeSongs(listening, contents.songs) else emptyList())
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope,SharingStarted.Eagerly,LibraryState())
    val player=MutableStateFlow(PlayerState())
    private val positionClock = MutableStateFlow(0L)
    val position: StateFlow<Long> = positionClock.asStateFlow()
    val search=MutableStateFlow(SearchState())
    val detail=MutableStateFlow<DetailState?>(null)
    val notice=MutableStateFlow<String?>(null)
    val lyrics=MutableStateFlow<LyricsRow?>(null)
    private val discoveryCache = MutableStateFlow<DiscoveryCache?>(null)
    private val discoveryLoading = MutableStateFlow(false)
    val recommendationsLoading: StateFlow<Boolean> = discoveryLoading.asStateFlow()
    private val discoveryFailed = MutableStateFlow(false)
    val recommendationsFailed: StateFlow<Boolean> = discoveryFailed.asStateFlow()
    private val knownMusic = library.filter { it.ready }.map { DiscoveryInputs(it) }.distinctUntilChanged()
        .map { DiscoveryExclusions(it) }.flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val recommendations: StateFlow<List<Song>> = combine(
        discoveryCache, knownMusic, player.map { it.id }.distinctUntilChanged(),
    ) { cache, exclusions, activeId ->
        if (cache == null || exclusions == null) emptyList()
        else cache.songs.filter { exclusions.permits(it, activeId) }
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val releases: StateFlow<List<JsonObject>> = combine(discoveryCache, knownMusic) { cache, exclusions ->
        if (cache == null || exclusions == null) emptyList()
        else cache.albums.filter { it.homeAlbumId !in exclusions.albumIds }
    }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val tab=MutableStateFlow(0)
    val artistThemes = mutableStateMapOf<String, ArtistThemeColors>()
    private val themeSources = mutableMapOf<String, String>()

    private suspend fun sampleTheme(context: android.content.Context, artworkUrl: String): ArtistThemeColors? = withContext(Dispatchers.IO) {
        val sized = ArtworkUrls.sized(artworkUrl, 128) ?: artworkUrl
        val data = java.io.File(sized).takeIf { it.isAbsolute } ?: sized
        val request = coil3.request.ImageRequest.Builder(context).data(data).size(64).allowHardware(false).build()
        val image = (coil3.SingletonImageLoader.get(context).execute(request) as? coil3.request.SuccessResult)?.image ?: return@withContext null
        val bitmap = image.toBitmap()
        val scaled = android.graphics.Bitmap.createScaledBitmap(bitmap, 16, 16, true)
        val pixels = IntArray(256)
        try {
            scaled.getPixels(pixels, 0, 16, 0, 0, 16, 16)
            artistTheme(pixels)
        } finally {
            if (scaled !== bitmap) scaled.recycle()
        }
    }

    suspend fun loadArtistTheme(context: android.content.Context, key: String, artworkUrl: String?): ArtistThemeColors {
        if (artworkUrl.isNullOrBlank()) return artistThemes[key] ?: NEUTRAL
        if (themeSources[key] == artworkUrl && artistThemes.containsKey(key)) {
            return artistThemes.getValue(key)
        }
        val theme = sampleTheme(context, artworkUrl) ?: return artistThemes[key] ?: NEUTRAL
        themeSources[key] = artworkUrl
        artistThemes[key] = theme
        return theme
    }

    suspend fun loadSearchTheme(context: android.content.Context, artistId: String?, artworkUrl: String?): ArtistThemeColors {
        if (artistId != null) {
            val artistKey = "youtube:$artistId"
            artistThemes[artistKey]?.let { return it }
        }
        if (artworkUrl.isNullOrBlank()) return NEUTRAL
        artistThemes[artworkUrl]?.let { return it }
        val theme = sampleTheme(context, artworkUrl) ?: return NEUTRAL
        artistThemes[artworkUrl] = theme
        return theme
    }
    private var searchJob: Job?=null
    private var detailJob: Job?=null
    private var lyricsJob: Job?=null
    private var discoveryJob: Job? = null
    private var generation=0L
    private val history=mutableListOf<DetailState>()
    private var controller: MediaController?=null
    private val controllerFuture=MediaController.Builder(application,SessionToken(application,ComponentName(application,PlaybackService::class.java))).buildAsync()
    private val loadDiscoveryCache = viewModelScope.launch {
        try {
            val saved = app.preferences.data.first()[discoveryCacheKey]
            discoveryCache.value = saved?.let { Json.decodeFromString<DiscoveryCache>(it) }
        } catch (_: IOException) {
            // Discovery can still run when local storage is unavailable.
        } catch (_: SerializationException) {
            // A malformed cache is replaced after the next successful refresh.
        }
    }

    init {
        controllerFuture.addListener({
            runCatching {
                controller=controllerFuture.get()
                controller!!.addListener(object : Player.Listener {
                    override fun onEvents(player: Player, events: Player.Events) { updatePlayer(events) }
                    override fun onPlayerError(error: PlaybackException) { notice.value="No se pudo reproducir la canción. Reintenta o elige otra." }
                })
                updatePlayer()
            }.onFailure { notice.value="No se pudo iniciar el reproductor." }
        },ContextCompat.getMainExecutor(application))
        viewModelScope.launch {
            positionClock.subscriptionCount.map { it > 0 }.distinctUntilChanged().collectLatest { subscribed ->
                if (subscribed) while (isActive) {
                    controller?.let { positionClock.value = it.currentPosition }
                    delay(250)
                }
            }
        }
        viewModelScope.launch { player.map { it.id }.distinctUntilChanged().collect { loadLyrics() } }
        viewModelScope.launch {
            library.collect { snapshot ->
                val current = player.value
                if (controller?.duration?.let { it <= 0 } == true && current.id != null) {
                    val duration = snapshot.songs.find { it.id == current.id }?.duration ?: 0
                    if (duration != current.duration) player.value = current.copy(duration = duration)
                }
            }
        }
    }
    fun run(action: suspend () -> Unit) = viewModelScope.launch {
        try { action() } catch(error: Exception) {
            if(error is CancellationException) throw error
            notice.value=error.message?.takeIf { !it.contains("https://") }?.take(200) ?: "No se pudo completar la acción. Reintenta."
        }
    }
    private fun updatePlayer(events: Player.Events? = null) {
        val c = controller ?: return
        val previous = player.value
        val id = c.currentMediaItem?.mediaId
        val duration = c.duration.takeIf { it > 0 } ?: library.value.songs.find { it.id == id }?.duration ?: 0
        val queue = if (events == null || events.contains(Player.EVENT_TIMELINE_CHANGED)) {
            (0 until c.mediaItemCount).map { c.getMediaItemAt(it).mediaId }
        } else previous.queue
        val context = c.currentMediaItem?.mediaMetadata?.extras?.getString("openfy.context")
            ?.let { runCatching { Json.decodeFromString<RecentContext>(it) }.getOrNull() }?.takeIf { it.kind != "song" }?.title
        // With shuffle on, "A continuación" follows Media3's real order instead of the list order.
        val upcoming = if (!c.shuffleModeEnabled) null
            else if (events != null && !events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED,
                    Player.EVENT_MEDIA_ITEM_TRANSITION) && previous.upcoming != null) previous.upcoming
            else buildList {
                val timeline = c.currentTimeline
                var index = c.currentMediaItemIndex
                while (size < timeline.windowCount) {
                    index = timeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, true)
                    if (index == C.INDEX_UNSET) break
                    add(index)
                }
            }
        val updated = PlayerState(id, c.isPlaying, previous.position, duration,
            queue, c.currentMediaItemIndex, c.shuffleModeEnabled, c.repeatMode, context, upcoming)
        val now = c.currentPosition
        if (updated != previous) player.value = updated.copy(position = now)
        positionClock.value = now
    }
    fun selectTab(value: Int) { cancelFeaturedPlayback(); tab.value=value; detailJob?.cancel(); detail.value=null; history.clear() }
    fun back(): Boolean {
        if(detail.value==null) return false
        detailJob?.cancel(); generation++
        detail.value=if(history.isEmpty()) null else history.removeAt(history.lastIndex)
        return true
    }
    fun play(song: Song, songs: List<Song> = listOf(song), shuffled: Boolean = false, explicitContext: RecentContext? = null) = run {
        val c=controller ?: error("El reproductor se está preparando")
        val playable=songs.filter { it.source=="youtube" || it.path!=null }
        app.database.withTransaction { for(row in playable) if(row.source=="youtube") app.repository.saveRemote(Json.parseToJsonElement(row.metadata).jsonObject) }
        if(playable.isEmpty()) return@run
        val source=detail.value
        val context=explicitContext ?: source?.let { page ->
            val kind=when(page.kind) { "playlist","favorites" -> page.kind; "album","localalbum" -> "album"; "artist","localartist" -> "artist"; else -> "song" }
            if(kind=="song") null else RecentContext(kind,if(page.kind in setOf("album","artist")) "youtube:${page.id}" else if(page.kind.startsWith("local")) "local:${page.id}" else page.id,
                library.value.playlists.find { it.id==page.id }?.name ?: page.title,page.subtitle,page.artwork ?: playable.firstOrNull()?.artwork)
        }
        c.setMediaItems(playable.map { value -> val item=PlaybackService.mediaItem(value); if(context==null) item else PlaybackService.withContext(item,Json.parseToJsonElement(Json.encodeToString(context)).jsonObject) },playable.indexOfFirst { it.id==song.id }.coerceAtLeast(0),0)
        c.shuffleModeEnabled=shuffled; c.prepare(); c.play()
    }

    private var featuredPlayJob: Job? = null
    private var featuredPlayGeneration = 0L

    private fun cancelFeaturedPlayback() {
        featuredPlayJob?.cancel()
        featuredPlayGeneration++
    }

    private fun currentFeaturedThemeKey(): String? {
        val s = search.value
        return when (s.kind) {
            "songs" -> s.songs.firstOrNull()?.id
            "artists" -> s.cards.firstOrNull()?.get("id")?.jsonPrimitive?.contentOrNull?.let { "youtube:$it" }
            "albums" -> s.cards.firstOrNull()?.get("id")?.jsonPrimitive?.contentOrNull?.let { "youtube:album:$it" }
            else -> null
        }
    }

    fun playFeatured(featured: FeaturedSearchResult, fallbackSongs: List<Song> = emptyList()) {
        cancelFeaturedPlayback()
        val id = when (featured) {
            is FeaturedSearchResult.SongResult -> {
                play(featured.song, fallbackSongs.ifEmpty { listOf(featured.song) })
                return
            }
            is FeaturedSearchResult.Artist -> featured.id
            is FeaturedSearchResult.Album -> featured.id
        }
        val kind = if (featured.isArtist) "artist" else "album"
        val token = featuredPlayGeneration
        featuredPlayJob = run {
            val value = app.provider.call(kind, buildJsonObject { put("id", id) })
            if (token != featuredPlayGeneration || currentFeaturedThemeKey() != featured.themeKey) return@run
            val songs = (value[if (featured.isArtist) "topSongs" else "songs"] as? JsonArray)
                .orEmpty().map { remoteSong(it.jsonObject) }
            val first = songs.firstOrNull() ?: error("No hay canciones disponibles para reproducir.")
            val context = RecentContext(kind, "youtube:$id", featured.title, featured.subtitle, featured.artwork ?: first.artwork)
            play(first, songs, explicitContext = context)
        }
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
        val before = search.value
        if (value == before.query && kind == before.kind) return
        searchJob?.cancel()
        cancelFeaturedPlayback()
        if (value.trim().length < 2) {
            search.value = SearchState(query = value, kind = kind)
            return
        }
        val retained = before.takeIf { it.kind == kind } ?: SearchState()
        search.value = retained.copy(query = value, kind = kind, cursor = null, loading = false, error = null, pending = true)
        searchJob = run { delay(350); fetchSearch(false) }
    }
    fun moreSearch() {
        if(search.value.pending || search.value.loading || search.value.cursor==null) return
        searchJob=run { fetchSearch(true) }
    }
    fun retrySearch() {
        val before = search.value
        if (before.query.trim().length < 2) return
        searchJob?.cancel()
        searchJob = run { fetchSearch(before.cursor != null && (before.songs.isNotEmpty() || before.cards.isNotEmpty())) }
    }
    private suspend fun fetchSearch(more: Boolean) {
        val before=search.value
        search.value=before.copy(loading=true,error=null,pending=!more)
        try {
            val result=app.provider.call("search",buildJsonObject { put("query",before.query); put("kind",before.kind); if(more && before.cursor!=null) put("cursor",before.cursor) })
            val songs=result["songs"]?.jsonArray?.map { remoteSong(it.jsonObject) }.orEmpty()
            val cards=searchCards(before.kind,result)
            currentCoroutineContext().ensureActive()
            search.value=before.copy(songs=((if(more) before.songs else emptyList())+songs).distinctBy { it.id },
                cards=((if(more) before.cards else emptyList())+cards).distinctBy { it["id"] },
                cursor=result["nextCursor"]?.jsonPrimitive?.contentOrNull,loading=false,pending=false,error=null)
        } catch(error: Exception) {
            currentCoroutineContext().ensureActive()
            val expired=Regex("caduc|expired",RegexOption.IGNORE_CASE).containsMatchIn(error.message.orEmpty())
            // A failed first page must not leave the previous query's results under the new one.
            search.value=before.copy(loading=false,pending=false,cursor=if(expired) null else before.cursor,
                songs=if(more) before.songs else emptyList(),cards=if(more) before.cards else emptyList(),
                error=if(expired) "La búsqueda caducó. Pulsa Reintentar para actualizarla." else "No se pudo cargar la búsqueda. Puedes reintentar.")
        }
    }
    fun openLocal(kind: String,id: String,title: String,songs: List<Song>,artwork: String? = null) {
        cancelFeaturedPlayback()
        detail.value?.let(history::add); detailJob?.cancel(); generation++
        detail.value=DetailState(kind,id,title,artwork=artwork,songs=songs)
    }
    fun openRemote(kind: String,id: String,title: String) {
        cancelFeaturedPlayback()
        detail.value?.let(history::add); detailJob?.cancel(); val token=++generation
        detail.value=DetailState(kind,id,title,loading=true)
        detailJob=run {
            try {
                val value=app.provider.call(kind,buildJsonObject { put("id",id) })
                if(token!=generation) return@run
                detail.value=DetailState(kind,id,value["title"]?.jsonPrimitive?.content ?: value["name"]?.jsonPrimitive?.content ?: title,
                    value["description"]?.jsonPrimitive?.contentOrNull.orEmpty(),value["artwork"]?.jsonPrimitive?.contentOrNull,
                    (value["songs"] ?: value["topSongs"])?.jsonArray?.map { remoteSong(it.jsonObject) }.orEmpty(),
                    value["albums"]?.jsonArray.orEmpty().map { it.jsonObject },
                    value["similar"]?.jsonArray?.map { it.jsonObject }.orEmpty(),
                    moreSongs=value["expandable"]?.jsonObject?.get("songs")?.jsonPrimitive?.booleanOrNull ?: false,
                    moreAlbums=value["expandable"]?.jsonObject?.get("albums")?.jsonPrimitive?.booleanOrNull ?: false,
                    moreSingles=value["expandable"]?.jsonObject?.get("singles")?.jsonPrimitive?.booleanOrNull ?: false,
                    year=value["year"]?.jsonPrimitive?.intOrNull,
                    artist=value["artists"]?.jsonArray?.mapNotNull { (it as? JsonObject)?.get("name")?.jsonPrimitive?.contentOrNull ?: (it as? JsonPrimitive)?.contentOrNull }?.joinToString(", ")?.ifBlank { null },
                    banner=value["banner"]?.jsonPrimitive?.contentOrNull,
                    singles=value["singles"]?.jsonArray.orEmpty().map { it.jsonObject })
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
                val cursor=value["nextCursor"]?.jsonPrimitive?.contentOrNull
                if(token==generation) detail.value=old.copy(songs=(old.songs+value.getValue("songs").jsonArray.map { remoteSong(it.jsonObject) }).distinctBy { it.id },
                    cursor=cursor,moreSongs=cursor!=null,loading=false,error=null)
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
                val additions=value.getValue("albums").jsonArray.map { it.jsonObject }
                if(token==generation) detail.value=old.copy(
                    albums=if(kind=="albums") (old.albums+additions).distinctBy { it["id"] } else old.albums,
                    singles=if(kind=="singles") (old.singles+additions).distinctBy { it["id"] } else old.singles,
                    loading=false,error=null,
                    moreAlbums=if(kind=="albums") cursor!=null else old.moreAlbums,moreSingles=if(kind=="singles") cursor!=null else old.moreSingles,
                    releaseCursors=if(cursor==null) old.releaseCursors-kind else old.releaseCursors+(kind to cursor))
            } catch(error: Exception) { if(error is CancellationException) throw error; if(token==generation) detail.value=old.copy(error="No se pudieron cargar más lanzamientos.") }
        }
    }
    fun discover(force: Boolean = false) {
        if (discoveryJob?.isActive == true) return
        discoveryJob = viewModelScope.launch {
            loadDiscoveryCache.join()
            val now = System.currentTimeMillis()
            val cacheAge = discoveryCache.value?.let { now - it.fetchedAt }
            if (!force && cacheAge != null && cacheAge in 0..discoveryCacheTtl) return@launch

            val snapshot = library.first { it.ready }
            val seeds = withContext(Dispatchers.Default) { discoverySeeds(snapshot) }
            if (seeds.isEmpty()) return@launch
            discoveryLoading.value = true
            discoveryFailed.value = false
            try {
                val year = homeYear()
                val excluded = withContext(Dispatchers.Default) {
                    val inputs = DiscoveryInputs(snapshot)
                    JsonArray((inputs.collectionIds() + inputs.listenedIds).mapNotNull { id ->
                        id.takeIf { it.startsWith("youtube:") }?.removePrefix("youtube:")?.let(::JsonPrimitive)
                    })
                }
                val songGroups = mutableListOf<List<Song>>()
                val albumGroups = mutableListOf<List<JsonObject>>()
                for (seed in seeds) {
                    val data = app.provider.call("recommendations", buildJsonObject {
                        put("seed", Json.parseToJsonElement(seed.metadata))
                        put("excluded", excluded)
                        put("year", year)
                    })
                    songGroups.add(data["songs"]?.jsonArray?.map { remoteSong(it.jsonObject) }.orEmpty())
                    albumGroups.add(data["albums"]?.jsonArray?.map { it.jsonObject }.orEmpty())
                }
                val latest = library.value
                val result = withContext(Dispatchers.Default) {
                    val exclusions = DiscoveryExclusions(DiscoveryInputs(latest))
                    val songs = interleaveDiscovery(songGroups) { it.id }.filter { exclusions.permits(it) }.take(12).toList()
                    val albums = interleaveDiscovery(albumGroups) { it.homeAlbumId to it["year"] }
                        .filter { it.homeAlbumId !in exclusions.albumIds }.toList()
                    DiscoveryCache(songs, currentYearReleases(albums, year), System.currentTimeMillis())
                }
                discoveryCache.value = result
                try {
                    app.preferences.edit { it[discoveryCacheKey] = Json.encodeToString(result) }
                } catch (_: IOException) {
                    // The refreshed selection is still available in memory.
                }
            } catch (_: Exception) {
                currentCoroutineContext().ensureActive()
                discoveryFailed.value = true
            } finally {
                discoveryLoading.value = false
            }
        }
    }
    override fun onCleared() { MediaController.releaseFuture(controllerFuture); super.onCleared() }

    companion object {
        fun remoteSong(value: JsonObject)=Song(id="youtube:${value.getValue("videoId").jsonPrimitive.content}",title=value.getValue("title").jsonPrimitive.content,
            artist=value["artists"]?.jsonArray?.joinToString(", ") { it.jsonPrimitive.content }.orEmpty(),album=value["album"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            duration=((value["duration"]?.jsonPrimitive?.doubleOrNull ?: 0.0)*1000).toLong(),artwork=value["artwork"]?.jsonPrimitive?.contentOrNull,metadata=value.toString(),
            artistId=value["artistRefs"]?.jsonArray?.firstOrNull()?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull,albumId=value["albumId"]?.jsonPrimitive?.contentOrNull)
    }
}
