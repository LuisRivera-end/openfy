package app.openfy.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song

internal fun LazyListScope.detailItems(
    vm: OpenfyViewModel,detail: DetailState,playlist: PlaylistRow?,tracks: List<Song>,
    songMap: Map<String,Song>,currentId: String?,stats: Map<String,List<ListeningRow>>,period: String,onPeriod: (String)->Unit,
    query: String,onQuery: (String)->Unit,onFilters: ()->Unit,requestNotifications: ()->Unit,
    onRename: (PlaylistRow)->Unit,onDelete: (PlaylistRow)->Unit,onSongActions: (Song)->Unit,
    fullTracks: List<Song>,filtersActive: Boolean,onClearFilters: ()->Unit,
    albumYear: Int? = null,albumArtist: String? = null
) {
    val route="detail:${detail.kind}:${detail.id}"
    val isAlbum=detail.kind=="album" || detail.kind=="localalbum"
    val isArtist=detail.kind=="artist" || detail.kind=="localartist"
    val isRemoteArtist=detail.kind=="artist"
    val isFavorites=detail.kind=="favorites"
    val isTop=detail.kind=="top"
    val isFiltered=query.isNotEmpty() || filtersActive
    val artwork=detail.artwork?.takeIf { it.isNotBlank() } ?: fullTracks.firstNotNullOfOrNull { it.artwork }
    val title=playlist?.name ?: detail.title
    val plays=if(isTop) stats.values.sumOf { rows -> rows.sumOf { it.plays.toLong() } } else 0L
    val listenedMs=if(isTop) stats.values.sumOf { rows -> rows.sumOf { it.listenedMs } } else 0L
    val noListening=isTop && plays==0L && listenedMs==0L
    val trackCount=songCount(fullTracks.size)
    val artist=if(isAlbum) {
        albumArtist?.takeIf { it.isNotBlank() } ?: fullTracks.firstNotNullOfOrNull { it.artist.takeIf(String::isNotBlank) }
    } else null
    val subtitle=when {
        isAlbum -> listOfNotNull(
            "Álbum",
            artist,
            albumYear?.toString(),
            trackCount.takeUnless { detail.loading && fullTracks.isEmpty() }
        ).joinToString(" · ")
        isArtist -> "Artista"
        else -> "Playlist · $trackCount"
    }
    item(key="$route:header") {
        val actions: @Composable ()->Unit = {
            CollectionActions(vm,playlist,tracks,fullTracks,songMap,requestNotifications,onRename,onDelete)
        }
        if(isTop) {
            RankingHeader(title,fullTracks.take(4).mapNotNull { it.artwork },period,onPeriod,listenedMs,plays,actions)
        } else {
            CollectionHeader(title,subtitle,artwork,isArtist,isRemoteArtist,isFavorites,isAlbum,artist,
                description=detail.subtitle.takeIf { isArtist && !isRemoteArtist }.orEmpty(),actions=actions)
        }
    }

    val error=detail.error
    collectionFilterItem("$route:filter",query,onQuery,onFilters,filtersActive,if(isFiltered) tracks.size else null)
    if(error!=null) {
        gutterItem("$route:error") {
            Retry(error) { vm.back(); vm.openRemote(detail.kind,detail.id,detail.title) }
        }
    }
    if(isRemoteArtist && fullTracks.isNotEmpty()) {
        gutterItem("$route:popular") { SectionTitle("Canciones populares") }
    }
    when {
        detail.loading && fullTracks.isEmpty() -> skeletons("$route:loading")
        noListening -> gutterItem("$route:no-listening") {
            EmptyCollection("Sin escuchas en este período",if(period!="all") "Ver todo" else null) { onPeriod("all") }
        }
        tracks.isEmpty() && error==null && !detail.loading -> {
            if(isFiltered) noCollectionMatches("$route:no-matches",onClearFilters)
            else gutterItem("$route:empty") { EmptyCollection("Aún no hay canciones") }
        }
    }

    val trackNumbers=if(isAlbum) fullTracks.mapIndexed { index,song -> song.id to (index+1) }.toMap() else emptyMap()
    songItems(tracks,songMap,currentId,{ vm.play(it,tracks) },onSongActions,if(isTop) stats else emptyMap(),
        keyPrefix="$route:song",trackNumbers=trackNumbers,showFavorite=!isFavorites)
    if(detail.moreSongs) gutterItem("$route:more-songs") {
        TextButton(onClick=vm::artistSongs,enabled=!detail.loading) { Text("Ver más canciones") }
    }
    if(detail.albums.isNotEmpty()) {
        gutterItem("$route:albums-title") { SectionTitle("Álbumes y lanzamientos") }
        item(key="$route:albums") { Cards(detail.albums,"album",vm::openRemote) }
    }
    if(detail.moreAlbums) gutterItem("$route:more-albums") {
        TextButton(onClick={ vm.artistReleases("albums") }) { Text("Ver más álbumes") }
    }
    if(detail.moreSingles) gutterItem("$route:more-singles") {
        TextButton(onClick={ vm.artistReleases("singles") }) { Text("Ver más singles y EPs") }
    }
    if(detail.artists.isNotEmpty()) {
        gutterItem("$route:artists-title") { SectionTitle("Artistas similares") }
        item(key="$route:artists") { Cards(detail.artists,"artist",vm::openRemote) }
    }
    if(isRemoteArtist && detail.subtitle.isNotBlank()) {
        gutterItem("$route:bio") {
            SectionTitle("Acerca de")
            ExpandableBiography(detail.subtitle,collapsedLines=2,expandLabel="Leer más")
        }
    }
}

@Composable private fun CollectionHeader(
    title: String,subtitle: String,artwork: String?,isArtist: Boolean,isRemoteArtist: Boolean,isFavorites: Boolean,
    isAlbum: Boolean,albumArtist: String?,description: String,actions: @Composable ()->Unit
) {
    val tint=if(isFavorites) FavoriteArtworkColor else artworkTint(artwork)
    Column(
        Modifier.fillMaxWidth().collectionBackdrop(tint).padding(horizontal=Gutter).padding(top=16.dp,bottom=8.dp),
        horizontalAlignment=Alignment.CenterHorizontally
    ) {
        val size=if(isRemoteArtist) 152.dp else 224.dp
        val shape=if(isArtist) CircleShape else RoundedCornerShape(Radii.feature)
        val artworkModifier=Modifier.size(size).shadow(12.dp,shape)
        when {
            isFavorites -> FavoritesCover(artworkModifier,size)
            isAlbum -> MotionArtwork(artist=albumArtist,album=title,fallback=artwork,playing=true,
                modifier=artworkModifier,shape=shape)
            else -> Cover(artwork,artworkModifier,1024)
        }
        Text(
            title,Modifier.padding(top=16.dp),color=TextColor,textAlign=TextAlign.Center,maxLines=2,
            overflow=TextOverflow.Ellipsis,style=collectionTitleStyle()
        )
        Text(
            subtitle,Modifier.padding(top=4.dp),color=Muted,textAlign=TextAlign.Center,maxLines=2,
            overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall.copy(fontSize=13.sp)
        )
        if(description.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            ExpandableBiography(description,collapsedLines=3,expandLabel="Más")
        }
        Spacer(Modifier.height(12.dp))
        actions()
    }
}

@Composable private fun RankingHeader(
    title: String,artwork: List<String>,period: String,onPeriod: (String)->Unit,listenedMs: Long,plays: Long,
    actions: @Composable ()->Unit
) {
    val tint=artworkTint(artwork.firstOrNull())
    Column(Modifier.fillMaxWidth().collectionBackdrop(tint).padding(horizontal=Gutter).padding(top=12.dp,bottom=8.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,
            horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(title,Modifier.weight(1f),color=Color.White,style=collectionTitleStyle(),maxLines=2,overflow=TextOverflow.Ellipsis)
            if(artwork.isNotEmpty()) ArtworkMosaic(artwork,Modifier.size(64.dp).clip(RoundedCornerShape(Radii.card)),64.dp)
        }
        Spacer(Modifier.height(6.dp))
        Periods(period,onPeriod)
        Row(Modifier.fillMaxWidth().padding(top=8.dp,bottom=12.dp),horizontalArrangement=Arrangement.spacedBy(24.dp)) {
            Box(Modifier.weight(1f)) { Stat("${listenedMs/60_000}","minutos escuchados") }
            Box(Modifier.weight(1f)) { Stat("$plays","reproducciones") }
        }
        actions()
    }
}

@Composable private fun artworkTint(artwork: String?): Color {
    val context=LocalContext.current
    var dominant by remember(context,artwork) { mutableStateOf<Int?>(null) }
    LaunchedEffect(context,artwork) {
        dominant=CoverPalette.dominant(context,artwork)
    }
    return dominant?.let { Color(it) } ?: Raised
}

private fun Modifier.collectionBackdrop(tint: Color) = drawBehind {
    drawRect(Brush.verticalGradient(
        0f to tint.copy(alpha=0.55f).compositeOver(Ink),
        0.45f to tint.copy(alpha=0.18f).compositeOver(Ink),
        1f to Ink,
        endY=360.dp.toPx().coerceAtMost(size.height)
    ))
}

@Composable private fun collectionTitleStyle() = MaterialTheme.typography.headlineMedium.copy(
    fontSize=26.sp,fontWeight=FontWeight.Bold,lineHeight=31.sp
)

@Composable private fun CollectionActions(
    vm: OpenfyViewModel,playlist: PlaylistRow?,tracks: List<Song>,fullTracks: List<Song>,songMap: Map<String,Song>,
    requestNotifications: ()->Unit,onRename: (PlaylistRow)->Unit,onDelete: (PlaylistRow)->Unit
) {
    val downloadable=remember(fullTracks,songMap) {
        fullTracks.distinctBy { it.id }.filter { song ->
            song.source=="youtube" && !(songMap[song.id]?.offlineReady ?: song.offlineReady)
        }
    }
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        IconButton(
            onClick={ tracks.firstOrNull()?.let { vm.play(it,tracks,true) } },
            enabled=tracks.isNotEmpty(),modifier=Modifier.size(48.dp)
        ) { Icon(Icons.Default.Shuffle,"Aleatorio",Modifier.size(24.dp)) }
        IconButton(
            onClick={ requestNotifications(); downloadable.forEach { vm.download(it) } },
            enabled=downloadable.isNotEmpty(),modifier=Modifier.size(48.dp)
        ) { Icon(Icons.Default.Download,"Descargar") }
        if(playlist!=null) {
            PlaylistActions(playlist,{ onRename(playlist) },{ onDelete(playlist) }) {
                val keep=!playlist.keepDownloaded
                if(keep && downloadable.isNotEmpty()) requestNotifications()
                vm.run {
                    vm.app.repository.savePlaylist(playlist.copy(keepDownloaded=keep))
                    if(keep) vm.app.downloads.syncCollections()
                }
            }
        }
        Spacer(Modifier.weight(1f))
        IconButton(
            onClick={ tracks.firstOrNull()?.let { vm.play(it,tracks) } },
            enabled=tracks.isNotEmpty(),
            modifier=Modifier.size(56.dp).background(if(tracks.isEmpty()) Raised else Green,CircleShape),
            colors=IconButtonDefaults.iconButtonColors(contentColor=Color.Black,disabledContentColor=Muted)
        ) { Icon(Icons.Default.PlayArrow,"Reproducir",Modifier.size(32.dp)) }
    }
}

@Composable private fun PlaylistActions(
    playlist: PlaylistRow,onRename: ()->Unit,onDelete: ()->Unit,onKeepDownloaded: ()->Unit
) {
    var open by remember { mutableStateOf(false) }
    Box {
        ActionIcon(Icons.Default.MoreHoriz,"Opciones de la colección") { open=true }
        DropdownMenu(expanded=open,onDismissRequest={ open=false }) {
            DropdownMenuItem(text={ Text("Cambiar nombre") },onClick={ open=false; onRename() })
            DropdownMenuItem(text={ Text("Eliminar") },onClick={ open=false; onDelete() })
            DropdownMenuItem(
                text={ Text("Mantener descargada") },
                onClick={ open=false; onKeepDownloaded() },
                modifier=Modifier.semantics {
                    stateDescription=if(playlist.keepDownloaded) "Activado" else "Desactivado"
                },
                trailingIcon={ if(playlist.keepDownloaded) Icon(Icons.Default.Check,null,tint=Green) }
            )
        }
    }
}

@Composable private fun ExpandableBiography(description: String,collapsedLines: Int,expandLabel: String) {
    var expanded by rememberSaveable(description) { mutableStateOf(false) }
    var hasOverflow by remember(description) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Text(description,color=Muted,style=MaterialTheme.typography.bodyMedium,maxLines=if(expanded) Int.MAX_VALUE else collapsedLines,
            overflow=TextOverflow.Ellipsis,onTextLayout={ if(!expanded) hasOverflow=it.hasVisualOverflow })
        if(expanded || hasOverflow) TextButton(onClick={ expanded=!expanded },modifier=Modifier.heightIn(min=48.dp)) {
            Text(if(expanded) "Leer menos" else expandLabel)
        }
    }
}

internal fun LazyListScope.noCollectionMatches(key: String,clear: ()->Unit) {
    gutterItem(key) { EmptyCollection("Sin coincidencias","Limpiar filtros",clear) }
}

@Composable private fun EmptyCollection(title: String,actionLabel: String? = null,onAction: ()->Unit = {}) {
    Column(Modifier.padding(vertical=SectionGap),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text(title,style=MaterialTheme.typography.titleLarge)
        if(actionLabel!=null) TextButton(onClick=onAction,modifier=Modifier.heightIn(min=48.dp)) { Text(actionLabel) }
    }
}
