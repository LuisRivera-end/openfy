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
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song
import kotlin.math.roundToInt

internal fun LazyListScope.detailItems(
    vm: OpenfyViewModel,detail: DetailState,playlist: PlaylistRow?,tracks: List<Song>,
    songMap: Map<String,Song>,currentId: String?,stats: Map<String,List<ListeningRow>>,period: String,onPeriod: (String)->Unit,
    query: String,onQuery: (String)->Unit,onFilters: ()->Unit,requestNotifications: ()->Unit,
    onRename: (PlaylistRow)->Unit,onDelete: (PlaylistRow)->Unit,onSongActions: (Song)->Unit,
    fullTracks: List<Song>,filtersActive: Boolean,onClearFilters: ()->Unit,onHeroTitleMeasured: (Int)->Unit,
    heroTopPadding: Dp,updateNotice: (@Composable ()->Unit)?,
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
        val rankingArtwork=if(isTop) fullTracks.take(4).mapNotNull { it.artwork } else emptyList()
        val tint=if(isFavorites) FavoriteArtworkColor else artworkTint(if(isTop) rankingArtwork.firstOrNull() else artwork)
        val measurement=remember { HeroTitleMeasurement() }
        val titleModifier=Modifier.onGloballyPositioned {
            measurement.title=it
            measurement.bottomPx()?.let(onHeroTitleMeasured)
        }
        val actions: @Composable ()->Unit = {
            CollectionActions(vm,playlist,tracks,fullTracks,songMap,requestNotifications,onRename,onDelete)
        }
        Box(Modifier.fillMaxWidth().collectionBackdrop(tint,heroTopPadding).onGloballyPositioned {
            measurement.hero=it
            measurement.bottomPx()?.let(onHeroTitleMeasured)
        }) {
            Column(Modifier.fillMaxWidth().padding(top=heroTopPadding)) {
                if(updateNotice!=null) {
                    Box(Modifier.padding(horizontal=Gutter)) { updateNotice() }
                    Spacer(Modifier.height(6.dp))
                }
                if(isTop) {
                    RankingHeader(title,rankingArtwork,period,onPeriod,listenedMs,plays,titleModifier,actions)
                } else {
                    CollectionHeader(title,subtitle,artwork,isArtist,isFavorites,isAlbum,artist,titleModifier,
                        description=detail.subtitle.takeIf { isArtist && !isRemoteArtist }.orEmpty(),actions=actions)
                }
            }
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

    if(isTop && tracks.isNotEmpty()) {
        gutterItem("$route:plays-heading") {
            Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterEnd) { PlayCountHeading() }
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

private class HeroTitleMeasurement {
    var hero: LayoutCoordinates? = null
    var title: LayoutCoordinates? = null

    fun bottomPx(): Int? {
        val container=hero?.takeIf { it.isAttached } ?: return null
        val heading=title?.takeIf { it.isAttached } ?: return null
        return container.localPositionOf(heading,Offset(0f,heading.size.height.toFloat())).y.roundToInt()
    }
}

@Composable private fun CollectionHeader(
    title: String,subtitle: String,artwork: String?,isArtist: Boolean,isFavorites: Boolean,
    isAlbum: Boolean,albumArtist: String?,titleModifier: Modifier,description: String,actions: @Composable ()->Unit
) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal=Gutter).padding(top=16.dp,bottom=8.dp),
        horizontalAlignment=Alignment.CenterHorizontally
    ) {
        val size=if(isArtist) 152.dp else 176.dp
        val shape=if(isArtist) CircleShape else RoundedCornerShape(Radii.feature)
        val artworkModifier=Modifier.size(size).shadow(12.dp,shape)
        when {
            isFavorites -> FavoritesCover(artworkModifier,size)
            isAlbum -> MotionArtwork(artist=albumArtist,album=title,fallback=artwork,playing=true,
                modifier=artworkModifier,shape=shape)
            else -> Cover(artwork,artworkModifier,1024)
        }
        Text(
            title,Modifier.padding(top=16.dp).then(titleModifier),color=TextColor,textAlign=TextAlign.Center,maxLines=2,
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
    titleModifier: Modifier,actions: @Composable ()->Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal=Gutter).padding(top=12.dp,bottom=8.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,
            horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(title,Modifier.weight(1f).then(titleModifier),color=Color.White,style=collectionTitleStyle(),
                maxLines=2,overflow=TextOverflow.Ellipsis)
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

private fun Modifier.collectionBackdrop(tint: Color,heroTopPadding: Dp) = drawWithCache {
    val startColor=tint.copy(alpha=0.55f).compositeOver(Ink)
    val backdrop=Brush.verticalGradient(
        0f to startColor,
        0.45f to tint.copy(alpha=0.18f).compositeOver(Ink),
        1f to Ink,
        endY=(heroTopPadding+360.dp).toPx().coerceAtMost(size.height)
    )
    val barHeight=heroTopPadding.toPx().coerceAtMost(size.height)
    val whiteContrast=1.05f/(startColor.luminance()+0.05f)
    val scrim=if(barHeight>0f && whiteContrast<4.5f) {
        Brush.verticalGradient(listOf(Ink.copy(alpha=0.35f),Ink.copy(alpha=0f)),endY=barHeight)
    } else null
    onDrawBehind {
        drawRect(backdrop)
        if(scrim!=null) drawRect(scrim,size=Size(size.width,barHeight))
    }
}

@Composable private fun collectionTitleStyle() = MaterialTheme.typography.headlineMedium.copy(
    fontSize=26.sp,fontWeight=FontWeight.Bold,lineHeight=31.sp
)

@Composable private fun CollectionActions(
    vm: OpenfyViewModel,playlist: PlaylistRow?,tracks: List<Song>,fullTracks: List<Song>,songMap: Map<String,Song>,
    requestNotifications: ()->Unit,onRename: (PlaylistRow)->Unit,onDelete: (PlaylistRow)->Unit
) {
    fun isDownloadable(song: Song) = song.source=="youtube" && !(songMap[song.id]?.offlineReady ?: song.offlineReady)

    val downloadable=remember(tracks,songMap) { tracks.distinctBy { it.id }.filter(::isDownloadable) }
    var pendingDownload by remember { mutableStateOf<List<Song>?>(null) }
    fun downloadSongs(songs: List<Song>) {
        val remaining=songs.filter(::isDownloadable)
        if(remaining.isNotEmpty()) {
            requestNotifications()
            remaining.forEach { vm.download(it) }
        }
    }
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        IconButton(
            onClick={ tracks.firstOrNull()?.let { vm.play(it,tracks,true) } },
            enabled=tracks.isNotEmpty(),modifier=Modifier.size(48.dp)
        ) { Icon(Icons.Default.Shuffle,"Aleatorio",Modifier.size(24.dp)) }
        IconButton(
            onClick={
                if(downloadable.size>10) pendingDownload=downloadable
                else downloadSongs(downloadable)
            },
            enabled=downloadable.isNotEmpty(),modifier=Modifier.size(48.dp)
        ) { Icon(Icons.Default.Download,"Descargar") }
        if(playlist!=null) {
            PlaylistActions(playlist,{ onRename(playlist) },{ onDelete(playlist) }) {
                val keep=!playlist.keepDownloaded
                if(keep && fullTracks.any(::isDownloadable)) requestNotifications()
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
    pendingDownload?.let { songs ->
        AlertDialog(
            onDismissRequest={ pendingDownload=null },
            title={ Text("Descargar ${songCount(songs.size)}") },
            confirmButton={
                TextButton(onClick={ pendingDownload=null; downloadSongs(songs) }) { Text("Descargar") }
            },
            dismissButton={ TextButton(onClick={ pendingDownload=null }) { Text("Cancelar") } }
        )
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
