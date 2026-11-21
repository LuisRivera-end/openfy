package app.openfy.android.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.openfy.android.OpenfyApplication
import app.openfy.android.data.CollectionRules
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song
import app.openfy.android.preferences
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import java.time.LocalDate
import java.time.ZoneId

@Composable internal fun OpenfyApp(vm: OpenfyViewModel) {
    OpenfyTheme {
        val library by vm.library.collectAsStateWithLifecycle()
        val player by vm.player.collectAsStateWithLifecycle()
        val search by vm.search.collectAsStateWithLifecycle()
        val detail by vm.detail.collectAsStateWithLifecycle()
        val tab by vm.tab.collectAsStateWithLifecycle()
        val notice by vm.notice.collectAsStateWithLifecycle()
        val importing by vm.app.repository.importing.collectAsStateWithLifecycle()
        val suggestions by vm.recommendations.collectAsStateWithLifecycle()
        val releases by vm.releases.collectAsStateWithLifecycle()
        val update by vm.app.updates.state.collectAsStateWithLifecycle()
        val preferences by vm.app.preferences.data.collectAsStateWithLifecycle(initialValue=emptyPreferences())
        val songMap=remember(library.songs) { library.songs.associateBy { it.id } }
        val current=songMap[player.id]
        val page=detail
        val context=LocalContext.current
        val snack=remember { SnackbarHostState() }
        var settings by rememberSaveable { mutableStateOf(false) }
        var expanded by rememberSaveable { mutableStateOf(false) }
        var actions by remember { mutableStateOf<Song?>(null) }
        var playlistPicker by remember { mutableStateOf<Song?>(null) }
        var create by rememberSaveable { mutableStateOf(false) }
        var rename by remember { mutableStateOf<PlaylistRow?>(null) }
        var removeDownload by remember { mutableStateOf<Song?>(null) }
        var deletePlaylist by remember { mutableStateOf<PlaylistRow?>(null) }
        var query by rememberSaveable(tab,page?.id) { mutableStateOf("") }
        var period by rememberSaveable { mutableStateOf("30d") }
        var libraryMode by rememberSaveable { mutableStateOf("Canciones") }
        val artistPage = page?.takeIf { it.kind == "artist" || it.kind == "localartist" }
        val filterKey=page?.let { "${it.kind}:${it.id}" } ?: "tab:$tab"
        var filters by remember(filterKey) { mutableStateOf(Filters()) }
        val persistedFilters=if(artistPage==null) preferences[stringPreferencesKey("filters:$filterKey")] else null
        LaunchedEffect(filterKey,persistedFilters) { filters=persistedFilters?.let { runCatching { Json.decodeFromString<Filters>(it) }.getOrNull() } ?: Filters() }
        var filterDialog by remember { mutableStateOf(false) }
        val importFiles=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> vm.run { vm.app.repository.importUris(uris) } }
        val importFolder=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> if(uri!=null) vm.run { vm.app.repository.importFolder(uri) } }
        val notifications=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
        fun launchFiles() { importFiles.launch(arrayOf("audio/*")) }
        fun launchFolder() { importFolder.launch(null) }
        fun requestNotifications() {
            if(android.os.Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        fun download(song: Song) { requestNotifications(); vm.download(song) }
        fun createPlaylist() { rename=null; create=true }
        fun clearFilters() {
            query=""; val cleared=filters.clearFilters(); filters=cleared
            vm.run { vm.app.preferences.edit { it[stringPreferencesKey("filters:$filterKey")]=Json.encodeToString(cleared) } }
        }

        LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.notice.value=null } }
        LaunchedEffect(tab,page?.id,library.listening.isNotEmpty()) { if(tab==0 && page==null && library.listening.isNotEmpty()) vm.discover(force=false) }
        BackHandler(page!=null && !expanded && !settings) { vm.back() }
        val threshold=when(period) { "7d" -> LocalDate.now(ZoneId.of("America/Mexico_City")).minusDays(6).toString()
            "30d" -> LocalDate.now(ZoneId.of("America/Mexico_City")).minusDays(29).toString()
            "year" -> "${LocalDate.now().year}-01-01"; else -> "0000-01-01" }
        val stats=remember(library.listening,threshold) { library.listening.filter { it.day>=threshold }.groupBy { it.songId } }
        val savedIds=remember(library.playlists) { library.playlists.flatMap { CollectionRules.entries(it.entries) }.toSet() }
        val librarySongs=remember(library.songs,savedIds) { library.songs.filter { it.saved || it.source=="local" || it.favorite || it.offlineReady || it.id in savedIds } }
        val playlist=page?.takeIf { it.kind=="playlist" }?.let { value -> library.playlists.find { it.id==value.id } }
        val topSongs=remember(stats,songMap) { stats.keys.mapNotNull(songMap::get).sortedWith(compareByDescending<Song> { stats[it.id]?.sumOf { s -> s.plays } ?: 0 }.thenByDescending { stats[it.id]?.sumOf { s -> s.listenedMs } ?: 0 }) }
        val source=if(page==null) {
            if(tab==1) search.songs else librarySongs
        } else when(page.kind) {
            "playlist" -> playlist?.let { CollectionRules.entries(it.entries).mapNotNull(songMap::get) }.orEmpty()
            "favorites" -> library.songs.filter { it.favorite }
            "localalbum" -> {
                if (page.id.contains('\u0000')) {
                    val delimiter = page.id.indexOf('\u0000')
                    val targetArtist = page.id.substring(0, delimiter)
                    val targetAlbum = page.id.substring(delimiter + 1)
                    librarySongs.filter { it.album == targetAlbum && it.albumArtist() == targetArtist }
                } else if (!page.artist.isNullOrBlank()) {
                    librarySongs.filter { it.album == page.id && it.albumArtist() == page.artist }
                } else {
                    librarySongs.filter { it.album == page.id }
                }
            }
            "localartist" -> librarySongs.filter { it.artist==page.id }
            "top" -> topSongs
            else -> page.songs
        }
        val tracks=if(artistPage!=null) source else remember(filters,source,query,stats) { filters.apply(source,query,stats) }
        val rankingArtwork=remember(stats,songMap) { stats.entries.sortedByDescending { (_,rows) -> rows.sumOf { it.plays } }.mapNotNull { songMap[it.key]?.artwork }.distinct().take(4) }
        val route=page?.let { "${it.kind}:${it.id}" } ?: "tab:$tab:$libraryMode"
        val scrolls=remember { linkedMapOf<String,LazyListState>() }
        val scroll=scrolls.getOrPut(route) { LazyListState() }
        val artistKey = artistPage?.let { if (it.kind == "artist") "youtube:${it.id}" else "local:${it.id}" }
        val artistImage = artistPage?.let { artist ->
            artist.banner?.takeIf(String::isNotBlank) ?: artist.artwork?.takeIf(String::isNotBlank)
                ?: source.firstNotNullOfOrNull { it.artwork?.takeIf(String::isNotBlank) }
        }
        LaunchedEffect(artistKey, artistImage) {
            if (artistKey != null) vm.loadArtistTheme(context, artistKey, artistImage)
        }
        val artistTheme = artistKey?.let { vm.artistThemes[it] ?: NEUTRAL }
        val artistColors = remember(artistTheme) { artistTheme?.let(::ArtistPageColors) }
        val reducedArtistMotion = artistColors != null && rememberReducedMotion()
        val density = LocalDensity.current
        val toolbarBottom = WindowInsets.statusBars.getTop(density) + with(density) { 56.dp.toPx() }
        val artistToolbar by remember(scroll, artistColors, reducedArtistMotion, toolbarBottom) {
            derivedStateOf { artistColors?.at(scroll.layoutInfo, toolbarBottom, reducedArtistMotion) }
        }

        var compact by rememberSaveable(route) { mutableStateOf(false) }
        LaunchedEffect(route) { compact = false }
        val threshold80Px = with(density) { 80.dp.toPx() }
        val delta8Px = with(density) { 8.dp.toPx() }
        var scrollDelta by remember(route) { mutableFloatStateOf(0f) }
        val nestedScrollConnection = remember(scroll, density) {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    val dy = available.y
                    if (scroll.firstVisibleItemIndex == 0 && scroll.firstVisibleItemScrollOffset < threshold80Px) {
                        compact = false
                        scrollDelta = 0f
                        return Offset.Zero
                    }
                    if (dy < 0f) {
                        if (scrollDelta > 0f) scrollDelta = 0f
                        scrollDelta += dy
                        if (scrollDelta <= -delta8Px) {
                            compact = true
                        }
                    } else if (dy > 0f) {
                        if (scrollDelta < 0f) scrollDelta = 0f
                        scrollDelta += dy
                        if (scrollDelta >= delta8Px) {
                            compact = false
                        }
                    }
                    return Offset.Zero
                }
            }
        }
        LaunchedEffect(scroll, density) {
            snapshotFlow { scroll.firstVisibleItemIndex == 0 && scroll.firstVisibleItemScrollOffset < threshold80Px }
                .distinctUntilChanged()
                .collect { nearTop ->
                    if (nearTop) compact = false
                }
        }

        val albumPage = page?.takeIf { it.kind == "album" || it.kind == "localalbum" }
        val albumKey = albumPage?.let { "${it.kind}:${it.id}" }
        val albumArtist = albumPage?.let { album ->
            if (album.kind == "localalbum") {
                if (!album.artist.isNullOrBlank()) {
                    album.artist
                } else if (album.id.contains('\u0000')) {
                    album.id.substringBefore('\u0000').takeIf(String::isNotBlank)
                } else {
                    val distinct = source.map { it.albumArtist() }.filter(String::isNotBlank).distinct()
                    if (distinct.size == 1) distinct.first() else null
                }
            } else {
                album.artist?.takeIf(String::isNotBlank) ?: source.firstNotNullOfOrNull { it.artist.takeIf(String::isNotBlank) }
            }
        }
        val albumArtwork = albumPage?.let { album ->
            album.artwork?.takeIf(String::isNotBlank) ?: source.firstNotNullOfOrNull { it.artwork?.takeIf(String::isNotBlank) }
        }
        val resolvedAlbumYear = if (albumPage?.kind == "localalbum") {
            val years = source.mapNotNull { song ->
                runCatching {
                    (Json.parseToJsonElement(song.metadata) as? JsonObject)?.get("year")?.jsonPrimitive?.intOrNull
                }.getOrNull()
            }.filter { it > 0 }.distinct()
            if (years.size == 1) years.first() else albumPage.year
        } else albumPage?.year
        val effects = preferences[Effects] ?: true
        val motion = preferences[Motion] ?: true
        val reducedMotion = rememberReducedMotion()
        val unmetered = rememberMotionUnmetered(context.applicationContext as OpenfyApplication)
        val coverVisible by remember(scroll, toolbarBottom) {
            derivedStateOf {
                scroll.firstVisibleItemIndex == 0 &&
                    scroll.firstVisibleItemScrollOffset < toolbarBottom + with(density) { 216.dp.toPx() }
            }
        }
        val allowMotion = effects && motion && !reducedMotion && unmetered && coverVisible

        LaunchedEffect(albumKey, albumArtist, albumArtwork, page?.subtitle, allowMotion) {
            if (albumPage != null && albumKey != null) {
                vm.loadAlbumPresentation(
                    context = context,
                    kind = albumPage.kind,
                    id = albumPage.id,
                    title = albumPage.title,
                    artist = albumArtist,
                    artworkUrl = albumArtwork,
                    youtubeDescription = albumPage.subtitle.takeIf(String::isNotBlank),
                    allowMotion = allowMotion
                )
            }
        }
        val albumTint = albumKey?.let { vm.albumTints[it] } ?: if (albumPage != null) albumTint(null) else null
        val albumPresentation = albumKey?.let { vm.albumPresentations[it] }

        val isAlbumPage = albumPage != null
        val isArtistPage = artistPage != null
        val isTintedPage = isAlbumPage || isArtistPage

        val targetChrome = when {
            page == null -> NeutralChrome
            isAlbumPage -> PageChrome(
                background = albumTint?.backgroundColor ?: Ink,
                surface = albumTint?.surfaceColor ?: Surface,
                muted = albumTint?.mutedColor ?: Muted,
                edge = albumTint?.edgeColor ?: Color.Transparent
            )
            isArtistPage -> PageChrome(
                background = artistColors?.base ?: Ink,
                surface = artistColors?.surface ?: Surface,
                muted = ArtistSecondaryText,
                edge = artistColors?.deep ?: Ink
            )
            else -> NeutralChrome
        }

        val chromeEasing = CubicBezierEasing(0.2f, 0f, 0.2f, 1f)
        val chromeSpec = if (reducedMotion || !effects) snap<Color>() else tween<Color>(240, easing = chromeEasing)
        val animatedChromeBg by animateColorAsState(targetChrome.background, chromeSpec, label = "chrome bg")
        val animatedChromeSurface by animateColorAsState(targetChrome.surface, chromeSpec, label = "chrome surface")
        val animatedChromeMuted by animateColorAsState(targetChrome.muted, chromeSpec, label = "chrome muted")
        val animatedChromeEdge by animateColorAsState(targetChrome.edge, chromeSpec, label = "chrome edge")

        val glassBg = mixColors(animatedChromeBg, Ink, 0.70f)

        val availableRelease=update.release
        var heroTitleBottomBelowBar by remember(route) { mutableIntStateOf(0) }
        val showCompactTitle by remember(scroll) {
            derivedStateOf {
                // The hero is the first item, including any update notice.
                scroll.firstVisibleItemIndex>0 || (heroTitleBottomBelowBar>0 &&
                    scroll.firstVisibleItemScrollOffset>=heroTitleBottomBelowBar)
            }
        }
        LaunchedEffect(search.query,search.kind) { if(tab==1) scroll.scrollToItem(0) }
        if(scrolls.size>24) scrolls.remove(scrolls.keys.first())
        LaunchedEffect(route,search.cursor,search.loading) {
            if(tab==1 && page==null && search.cursor!=null && !search.loading && search.error==null) snapshotFlow {
                val layout=scroll.layoutInfo
                layout.totalItemsCount>0 && (layout.visibleItemsInfo.lastOrNull()?.index ?: 0)>=layout.totalItemsCount-5
            }.filter { it }.take(1).collect { vm.moreSearch() }
        }

        Scaffold(containerColor=animatedChromeBg,contentColor=MaterialTheme.colorScheme.onBackground,snackbarHost={ SnackbarHost(snack) },topBar={
            val title=playlist?.name ?: page?.title ?: when(tab) {
                0 -> homeGreeting()
                1 -> "Buscar"
                2 -> "Tu biblioteca"
                else -> "Descargas"
            }
            val back: (() -> Unit)?=if(page!=null) ({ vm.back() }) else null
            key(page?.kind,page?.id) {
                OpenfyTopBar(title,back,back!=null && showCompactTitle, artistToolbar, animatedChromeSurface, isTintedPage) { settings=true }
            }
        },bottomBar={
            val navBarsBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
            val bottomOffset = maxOf(10.dp, navBarsBottom - 12.dp)
            val dockHeight = bottomOffset + 62.dp + if (current != null) (8.dp + 56.dp) else 0.dp
            val animSpec = if (reducedMotion) snap<Dp>() else tween<Dp>(300, easing = FastOutSlowInEasing)

            BoxWithConstraints(
                Modifier
                    .fillMaxWidth()
                    .height(dockHeight)
            ) {
                val targetTabBarWidth = if (compact) 62.dp else (maxWidth - 24.dp).coerceAtLeast(62.dp)
                val tabBarWidth by animateDpAsState(targetTabBarWidth, animSpec, label = "tabBarWidth")

                OpenfyBottomBar(
                    tab = tab,
                    selectTab = vm::selectTab,
                    glassBg = glassBg,
                    surfaceColor = animatedChromeSurface,
                    mutedColor = animatedChromeMuted,
                    isTintedPage = isTintedPage,
                    compact = compact,
                    onExpand = { compact = false },
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 12.dp, bottom = bottomOffset)
                        .width(tabBarWidth)
                        .height(62.dp)
                )

                if (current != null) {
                    val miniStart by animateDpAsState(if (compact) 82.dp else 12.dp, animSpec, label = "miniStart")
                    val miniBottom by animateDpAsState(if (compact) bottomOffset else (bottomOffset + 70.dp), animSpec, label = "miniBottom")
                    val miniWidth by animateDpAsState(
                        (if (compact) maxWidth - 94.dp else maxWidth - 24.dp).coerceAtLeast(0.dp),
                        animSpec,
                        label = "miniWidth"
                    )
                    val miniHeight by animateDpAsState(if (compact) 62.dp else 56.dp, animSpec, label = "miniHeight")
                    val miniCorner by animateDpAsState(if (compact) 31.dp else 16.dp, animSpec, label = "miniCorner")
                    val miniStartPad by animateDpAsState(if (compact) 10.dp else 6.dp, animSpec, label = "miniStartPad")

                    MiniPlayer(
                        song = current,
                        state = player,
                        toggle = vm::toggle,
                        next = vm::next,
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(start = miniStart, bottom = miniBottom)
                            .width(miniWidth)
                            .height(miniHeight),
                        shape = RoundedCornerShape(miniCorner),
                        startPadding = miniStartPad,
                        glassColor = if (isTintedPage) glassBg else null
                    ) {
                        expanded = true
                    }
                }
            }
        }) { padding ->
            // The hero consumes the top padding so its background can extend under the toolbar.
            val heroTopPadding=if(page==null) 0.dp else padding.calculateTopPadding()
            val heroTopPaddingPx=with(LocalDensity.current) { heroTopPadding.roundToPx() }
            val layoutDirection=LocalLayoutDirection.current
            val listPadding=if(page==null) PaddingValues(
                start=padding.calculateStartPadding(layoutDirection),
                top=padding.calculateTopPadding(),
                end=padding.calculateEndPadding(layoutDirection)
            ) else PaddingValues(
                start=padding.calculateStartPadding(layoutDirection),
                end=padding.calculateEndPadding(layoutDirection)
            )
            val release=availableRelease
            val updateNotice: (@Composable ()->Unit)?=if(release==null) null else {{ UpdateNotice(release.version) { settings=true } }}
            val artistBackdrop = artistColors?.run { Modifier.backdrop(scroll) } ?: Modifier
            val albumBackdrop = if (albumPage != null) Modifier.background(animatedChromeBg) else Modifier
            LazyColumn(state=scroll,modifier=Modifier.fillMaxSize().nestedScroll(nestedScrollConnection).padding(listPadding).then(artistBackdrop).then(albumBackdrop),
                contentPadding=PaddingValues(bottom=padding.calculateBottomPadding() + 24.dp),verticalArrangement=Arrangement.spacedBy(if(page==null && tab==2) 2.dp else 6.dp)) {
                if(page!=null) {
                    detailItems(vm,page,playlist,tracks,songMap,current?.id,stats,period,onPeriod={ period=it },
                        query=query,onQuery={ query=it },onFilters={ filterDialog=true },requestNotifications=::requestNotifications,
                        onRename={ rename=it; create=true },onDelete={ deletePlaylist=it },onSongActions={ actions=it },
                        fullTracks=source,filtersActive=filters.hasActiveFilters,onClearFilters=::clearFilters,
                        onHeroTitleMeasured={ heroTitleBottomBelowBar=it-heroTopPaddingPx },
                        heroTopPadding=heroTopPadding,updateNotice=updateNotice,albumYear=resolvedAlbumYear,albumArtist=albumArtist,
                        artistColors=artistColors,albumTint=albumTint,albumPresentation=albumPresentation)
                } else {
                    if(updateNotice!=null) gutterItem(content=updateNotice)
                    when(tab) {
                        0 -> homeItems(vm,library.listening,library.recents,songMap,current?.id,stats,period,onPeriod={ period=it },
                            suggestions=suggestions,releases=releases,importFiles=::launchFiles,onSongActions={ actions=it })
                        1 -> searchItems(vm,search,tracks,songMap,current?.id,onSongActions={ actions=it })
                        2 -> libraryItems(vm,librarySongs,library.playlists,tracks,songMap,current?.id,libraryMode,onMode={ libraryMode=it },
                            query=query,onQuery={ query=it },onFilters={ filterDialog=true },importFiles=::launchFiles,importFolder=::launchFolder,
                            createPlaylist=::createPlaylist,onSongActions={ actions=it },filtersActive=filters.hasActiveFilters,onClearFilters=::clearFilters,
                            rankingArtwork=rankingArtwork)
                        3 -> downloadsItems(vm,library.downloads,songMap,current?.id,::download,onRemove={ removeDownload=it },onSongActions={ actions=it })
                    }
                }
                if(importing) gutterItem {
                    Row(Modifier.padding(16.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)) { CircularProgressIndicator(Modifier.size(24.dp)); Text("Importando música…") }
                }
            }
        }

        if(settings) {
            val sync=vm.app.sync
            val status by sync.status.collectAsStateWithLifecycle()
            SettingsScreen(vm,update,status,sync.linked,sync.origin,effects,motion,{ settings=false },::launchFiles,::launchFolder,notice)
        }
        if(expanded && current!=null) FullPlayer(vm,current,player,library,effects,motion,{ expanded=false },{ actions=current },
            contextTitle=player.context,upcomingIndices=player.upcoming,
            overlayOpen=actions!=null || playlistPicker!=null || create || removeDownload!=null)
        actions?.let { selected ->
            SongActionsSheet(vm,songMap[selected.id] ?: selected,playlist,dismiss={ actions=null },onDownload=::download,
                onRemoveDownload={ removeDownload=it },onOpenRemote={ kind,id,title -> expanded=false; vm.openRemote(kind,id,title) },
                onPlaylistPicker={ playlistPicker=it })
        }
        playlistPicker?.let { song ->
            PlaylistPickerSheet(library.playlists,dismiss={ playlistPicker=null },onSelect={ row ->
                vm.run { vm.app.repository.addToPlaylist(row,song) }; playlistPicker=null
            },onCreate=::createPlaylist)
        }
        if(create) {
            val editing=rename
            PlaylistNameDialog(editing,dismiss={ create=false },save={ name ->
                vm.run { if(editing==null) vm.app.repository.createPlaylist(name) else vm.app.repository.savePlaylist(editing.copy(name=name.trim())) }
                create=false
            })
        }
        removeDownload?.let { song -> Confirm("¿Eliminar la descarga?","La canción seguirá en tu biblioteca y playlists.",{ removeDownload=null }) { vm.app.downloads.remove(song.id); removeDownload=null } }
        deletePlaylist?.let { row -> Confirm("¿Eliminar ${row.name}?","Las canciones locales se conservarán en una playlist independiente.",{ deletePlaylist=null }) { vm.run { vm.app.repository.deletePlaylist(row); vm.back() }; deletePlaylist=null } }
        if(filterDialog) FilterDialog(filters,{ chosen -> filters=chosen; filterDialog=false; vm.run { vm.app.preferences.edit { it[stringPreferencesKey("filters:$filterKey")]=Json.encodeToString(chosen) } } },{ filterDialog=false })
    }
}

@Composable private fun UpdateNotice(version: String,onClick: ()->Unit) {
    TextButton(onClick=onClick) {
        Icon(Icons.Default.SystemUpdate,null)
        Spacer(Modifier.width(8.dp))
        Text("Actualización disponible · $version")
    }
}

@Composable private fun OpenfyTopBar(
    title: String,
    back: (() -> Unit)?,
    showCompactTitle: Boolean,
    artistTint: Color?,
    surfaceColor: Color,
    isTintedPage: Boolean,
    settings: () -> Unit
) {
    val isArtistPage = artistTint != null
    // Artist pages: clear over the header art, then the section colour once the page title has scrolled away.
    val barFill by animateColorAsState(
        if (isArtistPage && showCompactTitle) artistTint!! else (artistTint ?: Color.Transparent).copy(alpha = 0f),
        tween(180), label = "artistBar"
    )
    val detailBar = if (back == null) Modifier else Modifier.background(barFill)
    val height = if (back == null) Modifier else Modifier.height(56.dp)
    val glassBg = artistTint?.copy(alpha = 0.28f) ?: Color.White.copy(alpha = 0.12f)
    val glassModifier = Modifier
        .size(44.dp)
        .background(glassBg, CircleShape)
        .border(1.dp, Color.White.copy(alpha = 0.22f), CircleShape)
    val backModifier = if (isArtistPage) glassModifier else Modifier
    val avatarModifier = when {
        isArtistPage -> glassModifier
        isTintedPage -> Modifier.background(surfaceColor, CircleShape)
        else -> Modifier
    }
    Row(
        Modifier.fillMaxWidth().then(detailBar).statusBarsPadding().then(height)
            .padding(start = if (back == null) Gutter else 12.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (back == null) {
            Text(
                title, Modifier.weight(1f), style = MaterialTheme.typography.headlineMedium,
                maxLines = 1, overflow = TextOverflow.Ellipsis
            )
        } else {
            ActionIcon(Icons.Default.ArrowBack, "Volver", tint = Color.White, modifier = backModifier, action = back)
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                androidx.compose.animation.AnimatedVisibility(
                    visible = showCompactTitle,
                    enter = fadeIn(tween(150)),
                    exit = fadeOut(tween(150))
                ) {
                    Text(
                        title, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 18.sp, fontWeight = FontWeight.Medium)
                    )
                }
            }
        }
        ActionIcon(
            Icons.Default.Settings,
            "Ajustes",
            tint = if (back == null && !isArtistPage) TextColor else Color.White,
            modifier = avatarModifier,
            action = settings
        )
    }
}

@Composable private fun OpenfyBottomBar(
    tab: Int,
    selectTab: (Int) -> Unit,
    glassBg: Color,
    surfaceColor: Color,
    mutedColor: Color,
    isTintedPage: Boolean,
    compact: Boolean = false,
    onExpand: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val destinations = listOf(
        "Inicio" to Icons.Default.Home,
        "Buscar" to Icons.Default.Search,
        "Biblioteca" to Icons.Default.LibraryMusic,
        "Descargas" to Icons.Default.Download
    )
    val barBg = if (isTintedPage) glassBg else Color(0xFF1F1F23).copy(alpha = 0.96f)
    Box(
        modifier
            .shadow(12.dp, CircleShape)
            .background(barBg, CircleShape)
            .border(1.dp, Color.White.copy(alpha = 0.09f), CircleShape)
            .clip(CircleShape)
    ) {
        if (compact) {
            Box(
                Modifier
                    .fillMaxSize()
                    .clickable(role = Role.Button, onClick = onExpand),
                contentAlignment = Alignment.CenterStart
            ) {
                Box(Modifier.size(62.dp), contentAlignment = Alignment.Center) {
                    val currentIcon = destinations.getOrNull(tab.coerceIn(0, destinations.lastIndex))?.second ?: Icons.Default.Home
                    Icon(currentIcon, contentDescription = null, modifier = Modifier.size(22.dp), tint = Color.White)
                }
            }
        } else {
            Row(
                Modifier
                    .fillMaxSize()
                    .selectableGroup()
                    .padding(6.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                destinations.forEachIndexed { index, (label, icon) ->
                    val selected = tab == index
                    val tint = if (selected) Color.White else if (isTintedPage) mutedColor else Muted
                    Column(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clip(CircleShape)
                            .then(if (selected) Modifier.background(Color.White.copy(alpha = 0.11f), CircleShape) else Modifier)
                            .selectable(
                                selected = selected,
                                role = Role.Tab,
                                onClick = { selectTab(index) }
                            ),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically)
                    ) {
                        Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp), tint = tint)
                        Text(
                            label,
                            color = tint,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }
    }
}

internal data class PageChrome(
    val background: Color,
    val surface: Color,
    val muted: Color,
    val edge: Color
)

private val NeutralChrome = PageChrome(
    background = Ink,
    surface = Surface,
    muted = Muted,
    edge = Color.Transparent
)

private fun mixColors(a: Color, b: Color, fraction: Float): Color = Color(
    red = a.red * fraction + b.red * (1f - fraction),
    green = a.green * fraction + b.green * (1f - fraction),
    blue = a.blue * fraction + b.blue * (1f - fraction),
    alpha = a.alpha * fraction + b.alpha * (1f - fraction)
)

internal fun Song.albumArtist(): String {
    val metaArtist = runCatching {
        val json = Json.parseToJsonElement(metadata) as? JsonObject
        json?.get("albumArtist")?.jsonPrimitive?.contentOrNull
            ?: json?.get("album_artist")?.jsonPrimitive?.contentOrNull
    }.getOrNull()
    return metaArtist?.takeIf(String::isNotBlank) ?: artist.trim()
}
