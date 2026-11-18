@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class,androidx.compose.foundation.ExperimentalFoundationApi::class)
package app.openfy.android.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.openfy.android.BuildConfig
import app.openfy.android.data.*
import app.openfy.android.lyrics.LyricsLine
import app.openfy.android.preferences
import coil3.compose.AsyncImage
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

internal val Ink=Color(0xff09090b)
internal val Surface=Color(0xff151518)
internal val Muted=Color(0xffa1a1aa)
internal val Green=Color(0xff1ed760)
internal val TextColor=Color(0xfff4f4f5)
private val Effects=booleanPreferencesKey("effects")
private val Motion=booleanPreferencesKey("motionArt")

@Composable fun OpenfyApp(vm: OpenfyViewModel) {
    MaterialTheme(colorScheme=darkColorScheme(primary=Green,onPrimary=Ink,secondary=Green,tertiary=Green,
        secondaryContainer=Color(0xff1c3528),onSecondaryContainer=Green,surfaceTint=Green,outline=Color(0xff3b3b42),
        background=Ink,surface=Surface,onSurface=TextColor,onBackground=TextColor)) {
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
        val preferences by vm.app.preferences.data.collectAsStateWithLifecycle(initialValue=androidx.datastore.preferences.core.emptyPreferences())
        val songMap=remember(library.songs) { library.songs.associateBy { it.id } }
        val current=songMap[player.id]
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
        var query by rememberSaveable(tab,detail?.id) { mutableStateOf("") }
        var period by rememberSaveable { mutableStateOf("30d") }
        var libraryMode by rememberSaveable { mutableStateOf("Canciones") }
        val filterKey=detail?.let { "${it.kind}:${it.id}" } ?: "tab:$tab"
        var filters by remember(filterKey) { mutableStateOf(Filters()) }
        val persistedFilters=preferences[stringPreferencesKey("filters:$filterKey")]
        LaunchedEffect(filterKey,persistedFilters) { filters=persistedFilters?.let { runCatching { Json.decodeFromString<Filters>(it) }.getOrNull() } ?: Filters() }
        var filterDialog by remember { mutableStateOf(false) }
        val importFiles=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> vm.run { vm.app.repository.importUris(uris) } }
        val importFolder=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> if(uri!=null) vm.run { vm.app.repository.importFolder(uri) } }
        val notifications=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
        fun download(song: Song) {
            if(android.os.Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            vm.download(song)
        }
        LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.notice.value=null } }
        LaunchedEffect(tab,library.listening.isNotEmpty()) { if(tab==0 && library.listening.isNotEmpty()) vm.discover() }
        BackHandler(detail!=null && !expanded && !settings) { vm.back() }
        val threshold=when(period) { "7d" -> LocalDate.now(ZoneId.of("America/Mexico_City")).minusDays(6).toString()
            "30d" -> LocalDate.now(ZoneId.of("America/Mexico_City")).minusDays(29).toString()
            "year" -> "${LocalDate.now().year}-01-01"; else -> "0000-01-01" }
        val stats=remember(library.listening,threshold) { library.listening.filter { it.day>=threshold }.groupBy { it.songId } }
        val savedIds=remember(library.playlists) { library.playlists.flatMap { CollectionRules.entries(it.entries) }.toSet() }
        val librarySongs=library.songs.filter { it.saved || it.source=="local" || it.favorite || it.offlineReady || it.id in savedIds }
        val playlist=detail?.takeIf { it.kind=="playlist" }?.let { value -> library.playlists.find { it.id==value.id } }
        val source=when(detail?.kind) {
            "playlist" -> playlist?.let { CollectionRules.entries(it.entries).mapNotNull(songMap::get) }.orEmpty()
            "favorites" -> library.songs.filter { it.favorite }
            "localalbum" -> librarySongs.filter { it.album==detail!!.id }
            "localartist" -> librarySongs.filter { it.artist==detail!!.id }
            "top" -> stats.keys.mapNotNull(songMap::get).sortedWith(compareByDescending<Song> { stats[it.id]?.sumOf { s -> s.plays } ?: 0 }.thenByDescending { stats[it.id]?.sumOf { s -> s.listenedMs } ?: 0 })
            null -> if(tab==1) search.songs else librarySongs
            else -> detail!!.songs
        }
        val tracks=filters.apply(source,query,stats)
        val route=detail?.let { "${it.kind}:${it.id}" } ?: "tab:$tab:$libraryMode"
        val scrolls=remember { linkedMapOf<String,LazyListState>() }
        val scroll=scrolls.getOrPut(route) { LazyListState() }
        LaunchedEffect(search.query,search.kind) { if(tab==1) scroll.scrollToItem(0) }
        if(scrolls.size>24) scrolls.remove(scrolls.keys.first())
        LaunchedEffect(route,search.cursor,search.loading) {
            if(tab==1 && detail==null && search.cursor!=null && !search.loading && search.error==null) snapshotFlow {
                val layout=scroll.layoutInfo
                layout.totalItemsCount>0 && (layout.visibleItemsInfo.lastOrNull()?.index ?: 0)>=layout.totalItemsCount-5
            }.filter { it }.take(1).collect { vm.moreSearch() }
        }
        Scaffold(containerColor=Ink,snackbarHost={ SnackbarHost(snack) },topBar={
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically) {
                if(detail!=null) ActionIcon(Icons.Default.ArrowBack,"Volver") { vm.back() }
                else Icon(Icons.Default.Album,null,tint=Green,modifier=Modifier.padding(12.dp).size(28.dp))
                Text(if(detail!=null) playlist?.name ?: detail!!.title else "Openfy",Modifier.weight(1f),fontWeight=FontWeight.Bold,fontSize=22.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                ActionIcon(Icons.Default.Settings,"Ajustes") { settings=true }
            }
        },bottomBar={
            Column(Modifier.navigationBarsPadding()) {
                current?.let { MiniPlayer(it,player,vm::toggle,vm::next) { expanded=true } }
                NavigationBar(containerColor=Ink,tonalElevation=0.dp) {
                    listOf("Inicio" to Icons.Default.Home,"Buscar" to Icons.Default.Search,"Biblioteca" to Icons.Default.LibraryMusic,"Descargas" to Icons.Default.Download).forEachIndexed { index,(label,icon) ->
                        NavigationBarItem(selected=tab==index,onClick={ vm.selectTab(index) },icon={ Icon(icon,label) },label={ Text(label,fontSize=11.sp) },
                            colors=NavigationBarItemDefaults.colors(selectedIconColor=Green,selectedTextColor=Green,indicatorColor=Surface,unselectedIconColor=Muted,unselectedTextColor=Muted))
                    }
                }
            }
        }) { padding ->
            LazyColumn(state=scroll,modifier=Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(start=20.dp,end=20.dp,bottom=24.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                if(update.release!=null) item {
                    TextButton(onClick={ settings=true }) { Icon(Icons.Default.SystemUpdate,null); Spacer(Modifier.width(8.dp)); Text("Actualización disponible · ${update.release!!.version}") }
                }
                if(detail!=null) {
                    item {
                        val value=detail!!
                        Column(Modifier.fillMaxWidth().padding(vertical=20.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                            Cover(value.artwork ?: tracks.firstOrNull()?.artwork,Modifier.size(192.dp).clip(RoundedCornerShape(16.dp)))
                            Text(playlist?.name ?: value.title,fontSize=28.sp,fontWeight=FontWeight.Bold,modifier=Modifier.padding(top=20.dp,bottom=8.dp))
                            if(value.subtitle.isNotBlank()) Text(value.subtitle,color=Muted,maxLines=5,overflow=TextOverflow.Ellipsis)
                            Text("${tracks.size} canciones",color=Muted,modifier=Modifier.padding(8.dp))
                            Row(horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically) {
                                ActionIcon(Icons.Default.Shuffle,"Reproducir aleatoriamente") { tracks.firstOrNull()?.let { vm.play(it,tracks,true) } }
                                Button(onClick={ tracks.firstOrNull()?.let { vm.play(it,tracks) } },enabled=tracks.isNotEmpty()) { Icon(Icons.Default.PlayArrow,null); Text("Reproducir") }
                                ActionIcon(Icons.Default.Download,"Descargar colección") {
                                    if(android.os.Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                                    tracks.filter { it.source=="youtube" }.forEach { vm.download(it) }
                                    playlist?.let { vm.run { vm.app.repository.savePlaylist(it.copy(keepDownloaded=true)) } }
                                }
                            }
                            playlist?.let { row ->
                                Row {
                                    TextButton(onClick={ rename=row; create=true }) { Text("Cambiar nombre") }
                                    TextButton(onClick={ deletePlaylist=row }) { Text("Eliminar") }
                                }
                                Row(verticalAlignment=Alignment.CenterVertically) {
                                    Text("Mantener descargada",Modifier.weight(1f))
                                    Switch(checked=row.keepDownloaded,onCheckedChange={ vm.run { vm.app.repository.savePlaylist(row.copy(keepDownloaded=it)) } })
                                }
                            }
                        }
                    }
                    detail!!.error?.let { message -> item { Retry(message) { val d=detail!!; vm.back(); vm.openRemote(d.kind,d.id,d.title) } } }
                    if(detail!!.loading && tracks.isEmpty()) skeletons()
                    if(detail!!.kind=="top") item { Periods(period) { period=it } }
                } else when(tab) {
                    0 -> {
                        item { Heading("Tu música, contigo", "Inicio") }
                        item {
                            Row(Modifier.fillMaxWidth().padding(vertical=16.dp),horizontalArrangement=Arrangement.spacedBy(24.dp)) {
                                Stat("${stats.values.flatten().sumOf { it.listenedMs }/60000}","minutos escuchados")
                                Stat("${stats.values.flatten().sumOf { it.plays }}","reproducciones")
                            }
                            Periods(period) { period=it }
                        }
                        val recent=library.listening.groupBy { it.songId }.toList().sortedByDescending { it.second.maxOf { s -> s.lastPlayedAt } }.take(10).mapNotNull { songMap[it.first] }
                        if(library.recents.isNotEmpty()) {
                            item { SectionTitle("Escuchadas recientemente") }
                            item { LazyRow(horizontalArrangement=Arrangement.spacedBy(16.dp)) { items(library.recents,key={ "${it.kind}:${it.id}" }) { card ->
                                Column(Modifier.width(144.dp).clickable { vm.openRecent(card) },verticalArrangement=Arrangement.spacedBy(8.dp)) {
                                    Cover(card.artwork,Modifier.size(144.dp).clip(RoundedCornerShape(12.dp)))
                                    Text(card.title,maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.Medium)
                                    Text(when(card.kind) { "playlist" -> "Playlist"; "favorites" -> "Tus favoritas"; "album" -> "Álbum"; "artist" -> "Artista"; else -> card.subtitle },color=Muted,fontSize=12.sp,maxLines=1)
                                }
                            } } }
                        } else if(recent.isNotEmpty()) {
                            item { SectionTitle("Escuchadas recientemente") }
                            item { LazyRow(horizontalArrangement=Arrangement.spacedBy(16.dp)) { items(recent,key={ it.id }) { song -> SongCard(song,{ vm.play(song,recent) },{ actions=song }) } } }
                        } else item {
                            Column(Modifier.padding(vertical=32.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                                Text("Tu próxima canción empieza aquí.",fontSize=28.sp,fontWeight=FontWeight.Bold)
                                Text("Busca música o añade tus archivos. Tus descargas te acompañan sin conexión.",color=Muted)
                                Button(onClick={ vm.selectTab(1) }) { Text("Buscar música") }
                                OutlinedButton(onClick={ importFiles.launch(arrayOf("audio/*")) }) { Text("Importar archivos") }
                            }
                        }
                        if(stats.isNotEmpty()) {
                            item { TextButton(onClick={ vm.openLocal("top","top","Más reproducidas",emptyList()) }) { Text("Más reproducidas"); Icon(Icons.Default.ArrowForward,null) } }
                            items(stats.keys.mapNotNull(songMap::get).sortedByDescending { stats[it.id]?.sumOf { row -> row.plays } }.take(5),key={ "top:${it.id}" }) { song ->
                                SongRow(song.copy(favorite=songMap[song.id]?.favorite ?: false),current?.id,{ vm.play(song) },{ actions=song },stats[song.id]?.sumOf { it.plays })
                            }
                        }
                        if(suggestions.isNotEmpty()) {
                            item { SectionTitle("Para descubrir") }
                            item { LazyRow(horizontalArrangement=Arrangement.spacedBy(16.dp)) { items(suggestions,key={ it.id }) { song -> SongCard(song,{ vm.play(song,suggestions) },{ actions=song }) } } }
                        }
                        if(releases.isNotEmpty()) { item { SectionTitle("Nuevos lanzamientos") }; item { Cards(releases,"album",vm) } }
                    }
                    1 -> {
                        item {
                            Heading("Encuentra algo que te mueva", "Buscar")
                            OutlinedTextField(search.query,{ vm.query(it) },Modifier.fillMaxWidth(),singleLine=true,label={ Text("¿Qué quieres escuchar?") },leadingIcon={ Icon(Icons.Default.Search,null) })
                            Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical=8.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                listOf("songs" to "Canciones","artists" to "Artistas","albums" to "Álbumes").forEach { (kind,label) -> FilterChip(search.kind==kind,{ vm.query(search.query,kind) },label={ Text(label) }) }
                            }
                        }
                        search.error?.let { item { Retry(it,vm::retrySearch) } }
                        if(search.loading && search.songs.isEmpty() && search.cards.isEmpty()) skeletons()
                        items(search.cards.chunked(2),key={ it.first().getValue("id").jsonPrimitive.content }) { pair ->
                            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)) {
                                pair.forEach { card ->
                                    val name=(card["name"] ?: card["title"])?.jsonPrimitive?.content.orEmpty()
                                    Column(Modifier.weight(1f).padding(bottom=16.dp).clickable { vm.openRemote(if(search.kind=="artists") "artist" else "album",card.getValue("id").jsonPrimitive.content,name) },verticalArrangement=Arrangement.spacedBy(8.dp)) {
                                        Cover(card["artwork"]?.jsonPrimitive?.contentOrNull,Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(if(search.kind=="artists") 100 else 12)))
                                        Text(name,maxLines=2,overflow=TextOverflow.Ellipsis)
                                    }
                                }
                                if(pair.size==1) Spacer(Modifier.weight(1f))
                            }
                        }
                        if(search.query.length<2) item { Empty("Busca canciones, artistas y álbumes.","El catálogo se consulta directamente desde tu teléfono.") }
                        else if(!search.loading && search.error==null && search.songs.isEmpty() && search.cards.isEmpty()) item { Empty("No encontramos resultados.","Prueba con otro nombre o artista.") }
                    }
                    2 -> {
                        item {
                            Heading("Tus canciones tienen un lugar", "Tu biblioteca")
                            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                AssistChip({ vm.openLocal("favorites","favorites","Tus favoritas",emptyList()) },label={ Text("Favoritas") },leadingIcon={ Icon(Icons.Default.Favorite,null,Modifier.size(18.dp),tint=Green) })
                                AssistChip({ vm.openLocal("top","top","Más reproducidas",emptyList()) },label={ Text("Más reproducidas") })
                            }
                            Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                listOf("Canciones","Álbumes","Artistas","Playlists").forEach { label -> FilterChip(libraryMode==label,{ libraryMode=label },label={ Text(label) }) }
                            }
                            Row {
                                TextButton(onClick={ importFiles.launch(arrayOf("audio/*")) }) { Icon(Icons.Default.Add,null); Text("Importar") }
                                TextButton(onClick={ importFolder.launch(null) }) { Icon(Icons.Default.FolderOpen,null); Text("Carpeta") }
                                if(libraryMode=="Playlists") TextButton(onClick={ rename=null; create=true }) { Text("Crear playlist") }
                            }
                        }
                        if(libraryMode=="Playlists") {
                            items(library.playlists,key={ it.id }) { row ->
                                ListItem(headlineContent={ Text(row.name,fontWeight=FontWeight.SemiBold) },supportingContent={ Text("${CollectionRules.entries(row.entries).size} canciones") },
                                    leadingContent={ Cover(CollectionRules.entries(row.entries).firstNotNullOfOrNull { songMap[it]?.artwork },Modifier.size(56.dp).clip(RoundedCornerShape(10.dp))) },
                                    modifier=Modifier.clickable { vm.openLocal("playlist",row.id,row.name,emptyList()) },colors=ListItemDefaults.colors(containerColor=Ink))
                            }
                        }
                        if(libraryMode=="Álbumes" || libraryMode=="Artistas") {
                            val groups=librarySongs.groupBy { if(libraryMode=="Álbumes") it.album.ifBlank { "Sin álbum" } else it.artist.ifBlank { "Artista desconocido" } }.toSortedMap()
                            items(groups.entries.toList(),key={ it.key }) { (name,songs) ->
                                ListItem(headlineContent={ Text(name) },supportingContent={ Text("${songs.size} canciones") },leadingContent={ Cover(songs.firstOrNull()?.artwork,Modifier.size(64.dp).clip(RoundedCornerShape(if(libraryMode=="Artistas") 100 else 12))) },
                                    modifier=Modifier.clickable { vm.openLocal(if(libraryMode=="Álbumes") "localalbum" else "localartist",if(name in setOf("Sin álbum","Artista desconocido")) "" else name,name,songs,songs.firstOrNull()?.artwork) },colors=ListItemDefaults.colors(containerColor=Ink))
                            }
                        }
                        if(librarySongs.isEmpty() && libraryMode!="Playlists") item { Empty("Tu biblioteca está lista para empezar.","Marca favoritas, crea una playlist o importa tus archivos.") }
                    }
                    3 -> {
                        item { Heading("Siempre contigo", "Descargas") }
                        item {
                            Text("${library.downloads.filter { it.state=="ready" }.size} canciones disponibles sin conexión",fontWeight=FontWeight.SemiBold)
                            Text("${String.format(Locale.US,"%.1f",library.downloads.sumOf { it.bytes }.toDouble()/1024/1024)} MB descargados",color=Muted,modifier=Modifier.padding(vertical=8.dp))
                        }
                        items(library.downloads.filter { it.state!="removed" },key={ it.id }) { row ->
                            songMap[row.id]?.let { song ->
                                Column {
                                    SongRow(song,current?.id,{ vm.play(song) },{ actions=song })
                                    Text(when(row.state) { "ready" -> "Disponible sin conexión"; "verifying" -> "Verificando audio"; "paused" -> "En pausa"; "error" -> row.error ?: "Descarga interrumpida"; "downloading" -> "Descargando"; else -> "En cola" },color=Muted,fontSize=12.sp)
                                    if(row.state=="downloading" && row.total>0) LinearProgressIndicator(progress={ (row.bytes.toFloat()/row.total).coerceIn(0f,1f) },modifier=Modifier.fillMaxWidth().padding(vertical=8.dp))
                                    Row {
                                        if(row.state in setOf("error","paused")) TextButton(onClick={ if(row.state=="error") download(song) else vm.app.downloads.pause(row.id,false) }) { Text("Reintentar / reanudar") }
                                        if(row.state in setOf("downloading","queued")) TextButton(onClick={ vm.app.downloads.pause(row.id,true) }) { Text("Pausar") }
                                        TextButton(onClick={ removeDownload=song }) { Text(if(row.state=="ready") "Eliminar descarga" else "Cancelar") }
                                    }
                                }
                            }
                        }
                        if(library.downloads.none { it.state!="removed" }) item { Empty("Lleva tu música sin conexión.","Abre las opciones de una canción, álbum o playlist y elige Descargar.") }
                    }
                }
                val showSongs=detail!=null || tab==1 && search.kind=="songs" || tab==2 && libraryMode=="Canciones"
                if(showSongs) {
                    if(tab!=1 || detail!=null) item {
                        Row(verticalAlignment=Alignment.CenterVertically) {
                            OutlinedTextField(query,{ query=it },Modifier.weight(1f),singleLine=true,label={ Text("Buscar en esta colección") })
                            ActionIcon(Icons.Default.Tune,"Filtros y orden") { filterDialog=true }
                        }
                    }
                    items(tracks,key={ it.id }) { song -> SongRow(song.copy(favorite=songMap[song.id]?.favorite ?: song.favorite,offlineReady=songMap[song.id]?.offlineReady ?: song.offlineReady),current?.id,
                        { vm.play(song,tracks) },{ actions=song },if(detail?.kind=="top") stats[song.id]?.sumOf { it.plays } else null) }
                }
                if(detail?.moreSongs==true) item { TextButton(onClick=vm::artistSongs,enabled=detail?.loading!=true) { Text("Ver más canciones") } }
                if(detail?.albums?.isNotEmpty()==true) { item { SectionTitle("Álbumes y lanzamientos") }; item { Cards(detail!!.albums,"album",vm) } }
                if(detail?.moreAlbums==true) item { TextButton(onClick={ vm.artistReleases("albums") }) { Text("Ver más álbumes") } }
                if(detail?.moreSingles==true) item { TextButton(onClick={ vm.artistReleases("singles") }) { Text("Ver más singles y EPs") } }
                if(detail?.artists?.isNotEmpty()==true) { item { SectionTitle("Artistas similares") }; item { Cards(detail!!.artists,"artist",vm) } }
                if(search.loading && tab==1 && detail==null && search.songs.isNotEmpty()) item { CircularProgressIndicator(Modifier.padding(16.dp)) }
                if(importing) item { Row(Modifier.padding(16.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)) { CircularProgressIndicator(Modifier.size(24.dp)); Text("Importando música…") } }
            }
        }
        if(settings) Settings(vm,preferences[Effects] ?: true,preferences[Motion] ?: true,{ settings=false },{ importFiles.launch(arrayOf("audio/*")) },{ importFolder.launch(null) },notice)
        if(expanded && current!=null) FullPlayer(vm,current!!,player,library,preferences[Effects] ?: true,preferences[Motion] ?: true,{ expanded=false },{ actions=current })
        actions?.let { selected ->
            val song=songMap[selected.id] ?: selected
            ModalBottomSheet(onDismissRequest={ actions=null },containerColor=Surface) {
                Text(song.title,fontWeight=FontWeight.Bold,fontSize=20.sp,modifier=Modifier.padding(horizontal=24.dp,vertical=12.dp))
                SheetAction(if(song.favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,if(song.favorite) "Quitar de favoritas" else "Añadir a favoritas") { vm.favorite(song); actions=null }
                SheetAction(Icons.Default.QueueMusic,"Añadir a la cola") { vm.queue(song); actions=null }
                if(song.source=="youtube") SheetAction(Icons.Default.Download,if(song.offlineReady) "Eliminar descarga" else "Descargar") { if(song.offlineReady) removeDownload=song else download(song); actions=null }
                song.albumId?.let { id -> SheetAction(Icons.Default.Album,"Ir al álbum") { expanded=false; vm.openRemote("album",id,song.album); actions=null } }
                song.artistId?.let { id -> SheetAction(Icons.Default.Person,"Ir al artista") { expanded=false; vm.openRemote("artist",id,song.artist); actions=null } }
                SheetAction(Icons.Default.PlaylistAdd,"Añadir a playlist") { playlistPicker=song; actions=null }
                playlist?.let { row ->
                    val ids=CollectionRules.entries(row.entries); val index=ids.indexOf(song.id)
                    if(index>=0) {
                        SheetAction(Icons.Default.RemoveCircleOutline,"Quitar de esta playlist") { vm.run { vm.app.repository.savePlaylist(row.copy(entries=CollectionRules.encode(ids.filterNot { it==song.id }))) }; actions=null }
                        if(index>0) SheetAction(Icons.Default.ArrowUpward,"Subir en la playlist") { val next=ids.toMutableList(); java.util.Collections.swap(next,index,index-1); vm.run { vm.app.repository.savePlaylist(row.copy(entries=CollectionRules.encode(next))) }; actions=null }
                        if(index<ids.lastIndex) SheetAction(Icons.Default.ArrowDownward,"Bajar en la playlist") { val next=ids.toMutableList(); java.util.Collections.swap(next,index,index+1); vm.run { vm.app.repository.savePlaylist(row.copy(entries=CollectionRules.encode(next))) }; actions=null }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
        playlistPicker?.let { song ->
            ModalBottomSheet(onDismissRequest={ playlistPicker=null }) {
                Text("Añadir a playlist",fontSize=24.sp,fontWeight=FontWeight.Bold,modifier=Modifier.padding(24.dp))
                LazyColumn(Modifier.heightIn(max=440.dp)) {
                    items(library.playlists,key={ it.id }) { row -> TextButton(onClick={ vm.run { vm.app.repository.addToPlaylist(row,song) }; playlistPicker=null },modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text(row.name,Modifier.fillMaxWidth()) } }
                    item { TextButton(onClick={ create=true; rename=null }) { Text("Crear playlist") } }
                }
            }
        }
        if(create) {
            var name by rememberSaveable(rename?.id) { mutableStateOf(rename?.name.orEmpty()) }
            AlertDialog(onDismissRequest={ create=false },title={ Text(if(rename==null) "Crear playlist" else "Cambiar nombre") },text={ OutlinedTextField(name,{ name=it.take(100) },label={ Text("Nombre") },singleLine=true) },
                confirmButton={ TextButton(enabled=name.isNotBlank(),onClick={ vm.run { rename?.let { vm.app.repository.savePlaylist(it.copy(name=name.trim())) } ?: vm.app.repository.createPlaylist(name) }; create=false }) { Text("Guardar") } },dismissButton={ TextButton(onClick={ create=false }) { Text("Cancelar") } })
        }
        removeDownload?.let { song -> Confirm("¿Eliminar la descarga?","La canción seguirá en tu biblioteca y playlists.",{ removeDownload=null }) { vm.app.downloads.remove(song.id); removeDownload=null } }
        deletePlaylist?.let { row -> Confirm("¿Eliminar ${row.name}?","Las canciones locales se conservarán en una playlist independiente.",{ deletePlaylist=null }) { vm.run { vm.app.repository.deletePlaylist(row); vm.back() }; deletePlaylist=null } }
        if(filterDialog) FilterDialog(filters,{ chosen -> filters=chosen; filterDialog=false; vm.run { vm.app.preferences.edit { it[stringPreferencesKey("filters:$filterKey")]=Json.encodeToString(chosen) } } },{ filterDialog=false })
    }
}

@Composable private fun Heading(subtitle: String,title: String) {
    Column(Modifier.padding(top=24.dp,bottom=20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(subtitle,color=Muted,fontSize=13.sp); Text(title,fontSize=34.sp,fontWeight=FontWeight.Bold)
    }
}
@Composable private fun SectionTitle(title: String) { Text(title,fontSize=22.sp,fontWeight=FontWeight.Bold,modifier=Modifier.padding(top=24.dp,bottom=12.dp)) }
@Composable private fun Stat(value: String,label: String) { Column { Text(value,fontSize=32.sp,fontWeight=FontWeight.Bold); Text(label,color=Muted,fontSize=12.sp) } }
@Composable private fun Periods(current: String,select: (String)->Unit) { Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) { listOf("7d" to "7 días","30d" to "30 días","year" to "Este año","all" to "Todo").forEach { (id,label) -> FilterChip(current==id,{ select(id) },label={ Text(label) }) } } }
@Composable private fun Empty(title: String,body: String) { Column(Modifier.padding(vertical=28.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) { Text(title,fontSize=21.sp,fontWeight=FontWeight.SemiBold); Text(body,color=Muted) } }
@Composable private fun Retry(message: String,retry: ()->Unit) { Column { Text(message,color=Muted); TextButton(onClick=retry) { Text("Reintentar") } } }
private fun LazyListScope.skeletons() { items(7) { Row(Modifier.padding(vertical=10.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)) { Box(Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)).background(Surface)); Column { Box(Modifier.padding(top=5.dp).width(180.dp).height(16.dp).background(Surface)); Box(Modifier.padding(top=10.dp).width(110.dp).height(12.dp).background(Surface)) } } } }
@Composable internal fun Cover(uri: String?,modifier: Modifier) {
    Box(modifier.background(Surface),contentAlignment=Alignment.Center) {
        Icon(Icons.Default.MusicNote,null,Modifier.size(28.dp),tint=Muted)
        if(uri!=null) AsyncImage(model=if(uri.startsWith("https:")) uri else File(uri),contentDescription=null,modifier=Modifier.matchParentSize(),contentScale=androidx.compose.ui.layout.ContentScale.Crop)
    }
}
@Composable internal fun ActionIcon(icon: ImageVector,label: String,tint: Color = TextColor,action: ()->Unit) { IconButton(onClick=action,modifier=Modifier.sizeIn(minWidth=48.dp,minHeight=48.dp)) { Icon(icon,label,tint=tint) } }
@Composable private fun SongRow(song: Song,current: String?,play: ()->Unit,more: ()->Unit,plays: Int? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min=76.dp).combinedClickable(onClick=play,onLongClick=more),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Cover(song.artwork,Modifier.size(52.dp).clip(RoundedCornerShape(8.dp)))
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(song.title,color=if(current==song.id) Green else TextColor,fontWeight=FontWeight.Medium,maxLines=1,overflow=TextOverflow.Ellipsis)
            Row(verticalAlignment=Alignment.CenterVertically) {
                if(song.offlineReady) { Icon(Icons.Default.Download,"Disponible sin conexión",Modifier.size(13.dp),tint=Green); Spacer(Modifier.width(4.dp)) }
                Text(if(plays!=null) "${song.artist} · $plays reproducciones" else song.artist,color=Muted,fontSize=12.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            }
        }
        if(song.favorite) Icon(Icons.Default.Favorite,"Favorita",Modifier.size(16.dp),tint=Green)
        ActionIcon(Icons.Default.MoreVert,"Opciones de ${song.title}",action=more)
    }
}
@Composable private fun SongCard(song: Song,play: ()->Unit,more: ()->Unit) {
    Column(Modifier.width(144.dp).combinedClickable(onClick=play,onLongClick=more),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Cover(song.artwork,Modifier.size(144.dp).clip(RoundedCornerShape(12.dp)))
        Text(song.title,maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.Medium)
        Text(song.artist,maxLines=1,overflow=TextOverflow.Ellipsis,color=Muted,fontSize=12.sp)
    }
}
@Composable private fun Cards(cards: List<JsonObject>,kind: String,vm: OpenfyViewModel) {
    LazyRow(horizontalArrangement=Arrangement.spacedBy(16.dp)) {
        items(cards,key={ it.getValue("id").jsonPrimitive.content }) { card ->
            val name=(card["title"] ?: card["name"])?.jsonPrimitive?.content.orEmpty()
            Column(Modifier.width(144.dp).clickable { vm.openRemote(kind,card.getValue("id").jsonPrimitive.content,name) },verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Cover(card["artwork"]?.jsonPrimitive?.contentOrNull,Modifier.size(144.dp).clip(RoundedCornerShape(if(kind=="artist") 100 else 12)))
                Text(name,maxLines=2,overflow=TextOverflow.Ellipsis)
            }
        }
    }
}
@Composable private fun MiniPlayer(song: Song,state: PlayerState,toggle: ()->Unit,next: ()->Unit,expand: ()->Unit) {
    Column(Modifier.padding(horizontal=12.dp,vertical=4.dp).clip(RoundedCornerShape(12.dp)).background(Surface)) {
        Row(Modifier.fillMaxWidth().semantics { contentDescription="Abrir reproductor" }.clickable(onClick=expand).padding(start=8.dp),verticalAlignment=Alignment.CenterVertically) {
            Cover(song.artwork,Modifier.size(44.dp).clip(RoundedCornerShape(6.dp)))
            Column(Modifier.weight(1f).padding(horizontal=12.dp)) { Text(song.title,maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=13.sp,fontWeight=FontWeight.SemiBold); Text(song.artist,color=Muted,fontSize=11.sp,maxLines=1,overflow=TextOverflow.Ellipsis) }
            ActionIcon(if(state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,if(state.playing) "Pausar" else "Reproducir",action=toggle)
            ActionIcon(Icons.Default.SkipNext,"Siguiente",action=next)
        }
        LinearProgressIndicator(progress={ if(state.duration>0) state.position.toFloat()/state.duration else 0f },Modifier.fillMaxWidth().height(2.dp),color=Green,trackColor=Surface)
    }
}
@Composable private fun SheetAction(icon: ImageVector,label: String,action: ()->Unit) { ListItem(headlineContent={ Text(label) },leadingContent={ Icon(icon,null) },modifier=Modifier.fillMaxWidth().heightIn(min=52.dp).clickable(onClick=action),colors=ListItemDefaults.colors(containerColor=Surface)) }
@Composable private fun Confirm(title: String,body: String,dismiss: ()->Unit,confirm: ()->Unit) { AlertDialog(onDismissRequest=dismiss,title={ Text(title) },text={ Text(body) },confirmButton={ TextButton(onClick=confirm) { Text("Eliminar") } },dismissButton={ TextButton(onClick=dismiss) { Text("Cancelar") } }) }

@kotlinx.serialization.Serializable
private data class Filters(val source: String = "all",val downloaded: Boolean = false,val favorite: Boolean = false,
    val artist: String = "",val album: String = "",val genre: String = "",val sort: String = "default",val descending: Boolean = false) {
    fun apply(songs: List<Song>,query: String,stats: Map<String,List<ListeningRow>>): List<Song> {
        val filtered=songs.filter { song ->
            (source=="all" || song.source==source) && (!downloaded || song.offlineReady) && (!favorite || song.favorite) &&
                song.artist.contains(artist,true) && song.album.contains(album,true) &&
                (genre.isBlank() || runCatching { Json.parseToJsonElement(song.metadata).jsonObject["genres"]?.jsonArray?.any { it.jsonPrimitive.content.contains(genre,true) }==true }.getOrDefault(false)) && "${song.title} ${song.artist} ${song.album}".contains(query,true)
        }
        val comparator: Comparator<Song>?=when(sort) { "title" -> compareBy { it.title.lowercase() }; "artist" -> compareBy { it.artist.lowercase() }; "album" -> compareBy { it.album.lowercase() }
            "duration" -> compareBy { it.duration }; "plays" -> compareBy { stats[it.id]?.sumOf { row -> row.plays } ?: 0 }
            "minutes" -> compareBy { stats[it.id]?.sumOf { row -> row.listenedMs } ?: 0 }; "added" -> compareBy { it.addedAt }; else -> null }
        return if(comparator==null) filtered else filtered.sortedWith(if(descending) comparator.reversed() else comparator)
    }
}
@Composable private fun FilterDialog(initial: Filters,save: (Filters)->Unit,dismiss: ()->Unit) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(onDismissRequest=dismiss,title={ Text("Filtros y orden") },text={
        Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value.artist,{ value=value.copy(artist=it) },label={ Text("Artista") })
            OutlinedTextField(value.album,{ value=value.copy(album=it) },label={ Text("Álbum") })
            OutlinedTextField(value.genre,{ value=value.copy(genre=it) },label={ Text("Género") })
            Row { listOf("all" to "Todo","local" to "Local","youtube" to "YouTube").forEach { (id,label) -> FilterChip(value.source==id,{ value=value.copy(source=id) },label={ Text(label) }) } }
            Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(value.downloaded,{ value=value.copy(downloaded=it) }); Text("Solo descargadas") }
            Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(value.favorite,{ value=value.copy(favorite=it) }); Text("Solo favoritas") }
            var menu by remember { mutableStateOf(false) }
            val labels=mapOf("default" to "Original","title" to "Título","artist" to "Artista","album" to "Álbum","duration" to "Duración","plays" to "Reproducciones","minutes" to "Minutos","added" to "Fecha")
            Box { TextButton(onClick={ menu=true }) { Text("Orden: ${labels[value.sort]}") }; DropdownMenu(menu,{ menu=false }) {
                listOf("default" to "Original","title" to "Título","artist" to "Artista","album" to "Álbum","duration" to "Duración","plays" to "Reproducciones","minutes" to "Minutos","added" to "Fecha").forEach { (id,label) -> DropdownMenuItem(text={ Text(label) },onClick={ value=value.copy(sort=id); menu=false }) }
            } }
            Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(value.descending,{ value=value.copy(descending=it) }); Text("Orden descendente") }
        }
    },confirmButton={ TextButton(onClick={ save(value) }) { Text("Aplicar") } },dismissButton={ TextButton(onClick={ save(Filters()) }) { Text("Restablecer") } })
}

@Composable private fun Settings(vm: OpenfyViewModel,effects: Boolean,motion: Boolean,dismiss: ()->Unit,importFiles: ()->Unit,importFolder: ()->Unit,notice: String?) {
    val status by vm.app.sync.status.collectAsStateWithLifecycle()
    val update by vm.app.updates.state.collectAsStateWithLifecycle()
    val context=LocalContext.current
    var address by rememberSaveable { mutableStateOf(vm.app.sync.origin) }
    var code by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var licenses by remember { mutableStateOf(false) }
    Dialog(onDismissRequest=dismiss,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxSize(),color=Ink) {
            Column(Modifier.safeDrawingPadding().padding(20.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) { ActionIcon(Icons.Default.ArrowBack,"Volver",action=dismiss); Text("Ajustes",fontSize=28.sp,fontWeight=FontWeight.Bold) }
                Text("Openfy ${BuildConfig.VERSION_NAME} · ${BuildConfig.VERSION_CODE}",color=Muted)
                SectionTitle("Actualizaciones de GitHub")
                Text(update.message,color=Muted)
                update.progress?.let { LinearProgressIndicator(progress={ it/100f },modifier=Modifier.fillMaxWidth()); Text("$it %",color=Muted) }
                OutlinedButton(onClick={ vm.run { vm.app.updates.check() } },enabled=!update.busy) { Text("Buscar actualizaciones") }
                if(update.release!=null) {
                    if(update.ready) Button(onClick={ vm.run { vm.app.updates.install(context) } },enabled=!update.busy) { Text("Instalar actualización") }
                    else Button(onClick={ vm.run { vm.app.updates.download() } },enabled=!update.busy) { Text("Descargar APK") }
                    Text("Android pedirá confirmar la instalación. Se conservan tu biblioteca y descargas.",color=Muted,fontSize=12.sp)
                }
                SectionTitle("Tu música")
                Text("El teléfono mantiene su biblioteca, descargas e historial.",color=Muted)
                OutlinedButton(onClick=importFiles) { Text("Importar archivos") }
                OutlinedButton(onClick=importFolder) { Text("Importar carpeta") }
                SectionTitle("Apariencia")
                Row(verticalAlignment=Alignment.CenterVertically) { Text("Movimiento ambiental",Modifier.weight(1f)); Switch(effects,{ vm.run { vm.app.preferences.edit { prefs -> prefs[Effects]=it } } }) }
                Row(verticalAlignment=Alignment.CenterVertically) { Text("Portadas animadas con Wi-Fi",Modifier.weight(1f)); Switch(motion,{ vm.run { vm.app.preferences.edit { prefs -> prefs[Motion]=it } } }) }
                SectionTitle("Vincular con Windows")
                Text("Comparte favoritos y playlists de YouTube. Abre Ajustes → Android en el PC para obtener un código.",color=Muted)
                Text(status,color=Green)
                if(vm.app.sync.linked) {
                    Text(vm.app.sync.origin,color=Muted)
                    Button(onClick={ vm.run { busy=true; try { vm.app.sync.exchange() } finally { busy=false } } },enabled=!busy) { Text("Sincronizar ahora") }
                    TextButton(onClick={ vm.app.sync.unlink() }) { Text("Desvincular este teléfono") }
                } else {
                    OutlinedTextField(address,{ address=it },Modifier.fillMaxWidth(),label={ Text("https://tu-pc.tu-red.ts.net") },singleLine=true)
                    OutlinedTextField(code,{ code=it },Modifier.fillMaxWidth(),label={ Text("Código de Windows") },singleLine=true)
                    Button(onClick={ vm.run { busy=true; try { vm.app.sync.pair(address,code); code="" } finally { busy=false } } },enabled=!busy && address.isNotBlank() && code.isNotBlank()) { Text(if(busy) "Vinculando…" else "Vincular") }
                }
                notice?.let { Text(it,color=Muted) }
                SectionTitle("Almacenamiento")
                Text("Las descargas se conservan hasta que las elimines. Android puede pausar los trabajos en segundo plano; se reanudan al permitirlo el sistema.",color=Muted)
                Text("YouTube.js · QuickJS-KT · AndroidX Media3",fontSize=12.sp,color=Muted)
                TextButton(onClick={ licenses=true }) { Text("Licencias de código abierto") }
            }
        }
    }
    if(licenses) AlertDialog(onDismissRequest={ licenses=false },title={ Text("Licencias") },text={
        val text=remember { vm.app.assets.open("provider/NOTICE.txt").bufferedReader().use { it.readText() } }
        Text(text,Modifier.heightIn(max=440.dp).verticalScroll(rememberScrollState()),fontSize=12.sp)
    },confirmButton={ TextButton(onClick={ licenses=false }) { Text("Cerrar") } })
}
