package app.openfy.android.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.openfy.android.data.CollectionRules
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song
import app.openfy.android.preferences
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json
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
        val filterKey=page?.let { "${it.kind}:${it.id}" } ?: "tab:$tab"
        var filters by remember(filterKey) { mutableStateOf(Filters()) }
        val persistedFilters=preferences[stringPreferencesKey("filters:$filterKey")]
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

        LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.notice.value=null } }
        LaunchedEffect(tab,library.listening.isNotEmpty()) { if(tab==0 && library.listening.isNotEmpty()) vm.discover() }
        BackHandler(page!=null && !expanded && !settings) { vm.back() }
        val threshold=when(period) { "7d" -> LocalDate.now(ZoneId.of("America/Mexico_City")).minusDays(6).toString()
            "30d" -> LocalDate.now(ZoneId.of("America/Mexico_City")).minusDays(29).toString()
            "year" -> "${LocalDate.now().year}-01-01"; else -> "0000-01-01" }
        val stats=remember(library.listening,threshold) { library.listening.filter { it.day>=threshold }.groupBy { it.songId } }
        val savedIds=remember(library.playlists) { library.playlists.flatMap { CollectionRules.entries(it.entries) }.toSet() }
        val librarySongs=library.songs.filter { it.saved || it.source=="local" || it.favorite || it.offlineReady || it.id in savedIds }
        val playlist=page?.takeIf { it.kind=="playlist" }?.let { value -> library.playlists.find { it.id==value.id } }
        val source=if(page==null) {
            if(tab==1) search.songs else librarySongs
        } else when(page.kind) {
            "playlist" -> playlist?.let { CollectionRules.entries(it.entries).mapNotNull(songMap::get) }.orEmpty()
            "favorites" -> library.songs.filter { it.favorite }
            "localalbum" -> librarySongs.filter { it.album==page.id }
            "localartist" -> librarySongs.filter { it.artist==page.id }
            "top" -> stats.keys.mapNotNull(songMap::get).sortedWith(compareByDescending<Song> { stats[it.id]?.sumOf { s -> s.plays } ?: 0 }.thenByDescending { stats[it.id]?.sumOf { s -> s.listenedMs } ?: 0 })
            else -> page.songs
        }
        val tracks=filters.apply(source,query,stats)
        val route=page?.let { "${it.kind}:${it.id}" } ?: "tab:$tab:$libraryMode"
        val scrolls=remember { linkedMapOf<String,LazyListState>() }
        val scroll=scrolls.getOrPut(route) { LazyListState() }
        LaunchedEffect(search.query,search.kind) { if(tab==1) scroll.scrollToItem(0) }
        if(scrolls.size>24) scrolls.remove(scrolls.keys.first())
        LaunchedEffect(route,search.cursor,search.loading) {
            if(tab==1 && page==null && search.cursor!=null && !search.loading && search.error==null) snapshotFlow {
                val layout=scroll.layoutInfo
                layout.totalItemsCount>0 && (layout.visibleItemsInfo.lastOrNull()?.index ?: 0)>=layout.totalItemsCount-5
            }.filter { it }.take(1).collect { vm.moreSearch() }
        }

        Scaffold(containerColor=Ink,snackbarHost={ SnackbarHost(snack) },topBar={
            val title=playlist?.name ?: page?.title ?: when(tab) {
                0 -> homeGreeting()
                1 -> "Buscar"
                2 -> "Tu biblioteca"
                else -> "Descargas"
            }
            val back: (() -> Unit)?=if(page!=null) ({ vm.back() }) else null
            OpenfyTopBar(title,back) { settings=true }
        },bottomBar={
            Column(Modifier.navigationBarsPadding()) {
                current?.let { MiniPlayer(it,player,vm::toggle,vm::next) { expanded=true } }
                OpenfyBottomBar(tab,vm::selectTab)
            }
        }) { padding ->
            LazyColumn(state=scroll,modifier=Modifier.fillMaxSize().padding(padding),
                contentPadding=PaddingValues(bottom=24.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                update.release?.let { release -> gutterItem {
                    TextButton(onClick={ settings=true }) { Icon(Icons.Default.SystemUpdate,null); Spacer(Modifier.width(8.dp)); Text("Actualización disponible · ${release.version}") }
                } }
                if(page!=null) {
                    detailItems(vm,page,playlist,tracks,songMap,current?.id,stats,period,onPeriod={ period=it },
                        query=query,onQuery={ query=it },onFilters={ filterDialog=true },requestNotifications=::requestNotifications,
                        onRename={ rename=it; create=true },onDelete={ deletePlaylist=it },onSongActions={ actions=it })
                } else when(tab) {
                    0 -> homeItems(vm,library.listening,library.recents,songMap,current?.id,stats,period,onPeriod={ period=it },
                        suggestions=suggestions,releases=releases,importFiles=::launchFiles,onSongActions={ actions=it })
                    1 -> searchItems(vm,search,tracks,songMap,current?.id,onSongActions={ actions=it })
                    2 -> libraryItems(vm,librarySongs,library.playlists,tracks,songMap,current?.id,libraryMode,onMode={ libraryMode=it },
                        query=query,onQuery={ query=it },onFilters={ filterDialog=true },importFiles=::launchFiles,importFolder=::launchFolder,
                        createPlaylist=::createPlaylist,onSongActions={ actions=it })
                    3 -> downloadsItems(vm,library.downloads,songMap,current?.id,::download,onRemove={ removeDownload=it },onSongActions={ actions=it })
                }
                if(importing) gutterItem {
                    Row(Modifier.padding(16.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)) { CircularProgressIndicator(Modifier.size(24.dp)); Text("Importando música…") }
                }
            }
        }

        val effects=preferences[Effects] ?: true
        val motion=preferences[Motion] ?: true
        if(settings) {
            val sync=vm.app.sync
            val status by sync.status.collectAsStateWithLifecycle()
            SettingsScreen(vm,update,status,sync.linked,sync.origin,effects,motion,{ settings=false },::launchFiles,::launchFolder,notice)
        }
        if(expanded && current!=null) FullPlayer(vm,current,player,library,effects,motion,{ expanded=false },{ actions=current })
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

@Composable private fun OpenfyTopBar(title: String,back: (() -> Unit)?,settings: ()->Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start=if(back==null) Gutter else 12.dp,end=12.dp),verticalAlignment=Alignment.CenterVertically) {
        if(back!=null) ActionIcon(Icons.Default.ArrowBack,"Volver",action=back)
        Text(title,Modifier.weight(1f),style=if(back==null) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleMedium,
            maxLines=1,overflow=TextOverflow.Ellipsis)
        ActionIcon(Icons.Default.Settings,"Ajustes",action=settings)
    }
}

@Composable private fun OpenfyBottomBar(tab: Int,selectTab: (Int)->Unit) {
    NavigationBar(containerColor=Ink,tonalElevation=0.dp) {
        listOf("Inicio" to Icons.Default.Home,"Buscar" to Icons.Default.Search,"Biblioteca" to Icons.Default.LibraryMusic,"Descargas" to Icons.Default.Download).forEachIndexed { index,(label,icon) ->
            NavigationBarItem(selected=tab==index,onClick={ selectTab(index) },icon={ Icon(icon,label) },
                label={ Text(label,style=MaterialTheme.typography.labelSmall) },
                colors=NavigationBarItemDefaults.colors(selectedIconColor=Green,selectedTextColor=Green,indicatorColor=Surface,unselectedIconColor=Muted,unselectedTextColor=Muted))
        }
    }
}
