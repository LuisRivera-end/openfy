@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package app.openfy.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.Song
import coil3.compose.AsyncImage
import kotlinx.serialization.json.*
import java.io.File

private fun Modifier.withGutter()=padding(horizontal=Gutter)

internal fun songCount(count: Int) = if(count==1) "1 canción" else "$count canciones"

internal fun LazyListScope.gutterItem(key: String? = null,content: @Composable ()->Unit) {
    item(key=key) { Column(Modifier.fillMaxWidth().withGutter()) { content() } }
}

internal fun <T> LazyListScope.gutterItems(values: List<T>,key: (T)->Any,content: @Composable (T)->Unit) {
    items(values,key=key) { value -> Column(Modifier.fillMaxWidth().withGutter()) { content(value) } }
}

@Composable internal fun CardRow(content: LazyListScope.()->Unit) {
    val state=rememberLazyListState()
    LazyRow(state=state,contentPadding=PaddingValues(horizontal=Gutter),horizontalArrangement=Arrangement.spacedBy(16.dp),
        flingBehavior=rememberSnapFlingBehavior(state,snapPosition=SnapPosition.Start),content=content)
}

@Composable internal fun SectionTitle(title: String) {
    Text(title,style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=SectionGap,bottom=12.dp))
}
@Composable internal fun Stat(value: String,label: String) {
    Column(verticalArrangement=Arrangement.spacedBy(2.dp)) {
        Text(value,style=MaterialTheme.typography.headlineMedium.copy(fontSize=28.sp,fontWeight=FontWeight.Bold))
        Text(label,color=Muted,style=MaterialTheme.typography.bodySmall)
    }
}
@Composable internal fun Periods(current: String,select: (String)->Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()).selectableGroup(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf("7d" to "7 días","30d" to "30 días","year" to "Este año","all" to "Todo").forEach { (id,label) ->
            PillChip(label,current==id) { select(id) }
        }
    }
}
@Composable internal fun Empty(title: String,body: String) {
    Column(Modifier.padding(vertical=SectionGap),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(title,style=MaterialTheme.typography.titleLarge)
        Text(body,color=Muted,style=MaterialTheme.typography.bodyMedium)
    }
}
@Composable internal fun Retry(message: String,retry: ()->Unit) {
    Column { Text(message,color=Muted,style=MaterialTheme.typography.bodyMedium); TextButton(onClick=retry) { Text("Reintentar") } }
}
internal fun LazyListScope.skeletons(keyPrefix: String = "loading") {
    repeat(7) { index ->
        gutterItem("$keyPrefix:$index") {
            Row(
                Modifier.fillMaxWidth().heightIn(min=64.dp),
                horizontalArrangement=Arrangement.spacedBy(12.dp),
                verticalAlignment=Alignment.CenterVertically
            ) {
                Box(Modifier.size(48.dp).clip(RoundedCornerShape(Radii.row)).background(Raised))
                Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.width(148.dp).height(14.dp).background(Raised,CircleShape))
                    Box(Modifier.width(88.dp).height(10.dp).background(Raised,CircleShape))
                }
            }
        }
    }
}

@Composable internal fun Cover(source: String?,modifier: Modifier,size: Dp,background: Color = Surface) {
    Cover(source,modifier,with(LocalDensity.current) { size.roundToPx() },background)
}

@Composable internal fun Cover(source: String?,modifier: Modifier,sizePx: Int,background: Color = Surface) {
    val url=remember(source,sizePx) { ArtworkUrls.sized(source,sizePx) }
    var fallback by remember(source,url) { mutableStateOf<String?>(null) }
    val request=fallback ?: url
    Box(modifier.background(background),contentAlignment=Alignment.Center) {
        Icon(Icons.Default.MusicNote,null,Modifier.size(28.dp),tint=Muted)
        if(request!=null) AsyncImage(model=if(request.startsWith("https:")) request else File(request),
            contentDescription=null,modifier=Modifier.matchParentSize(),contentScale=ContentScale.Crop,onError={
                if(request==url && fallback==null) fallback=ArtworkUrls.fallback(request)?.takeUnless { it==request }
            })
    }
}

@Composable internal fun ActionIcon(icon: ImageVector,label: String,tint: Color = TextColor,modifier: Modifier = Modifier,action: ()->Unit) {
    IconButton(onClick=action,modifier=modifier.sizeIn(minWidth=48.dp,minHeight=48.dp)) { Icon(icon,label,tint=tint) }
}
@Composable internal fun Confirm(title: String,body: String,dismiss: ()->Unit,confirm: ()->Unit) {
    AlertDialog(onDismissRequest=dismiss,title={ Text(title) },text={ Text(body) },
        confirmButton={ TextButton(onClick=confirm) { Text("Eliminar") } },dismissButton={ TextButton(onClick=dismiss) { Text("Cancelar") } })
}

private val PlayCountEndPadding=4.dp

@Composable internal fun PlayCountHeading() {
    Text("Reprod.",Modifier.padding(end=PlayCountEndPadding),color=Muted,style=MaterialTheme.typography.labelSmall)
}

internal fun formatTrackDuration(durationMs: Long): String {
    if (durationMs <= 0) return ""
    val totalSeconds = durationMs / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return String.format("%d:%02d", minutes, seconds)
}

@Composable internal fun SongRow(
    song: Song,
    current: String?,
    play: ()->Unit,
    more: ()->Unit,
    plays: Int? = null,
    trackNumber: Int? = null,
    showFavorite: Boolean = true,
    artworkSize: Dp = 48.dp,
    status: (@Composable ()->Unit)? = null,
    actions: (@Composable ()->Unit)? = null,
    menu: (@Composable ()->Unit)? = null,
    artistColors: ArtistPageColors? = null,
    albumTint: AlbumTintColors? = null,
    albumArtist: String? = null
) {
    val isCurrent=current==song.id
    val rowShape = RoundedCornerShape(Radii.row)
    var focused by remember { mutableStateOf(false) }
    val accent = when {
        artistColors != null -> Color.White
        else -> Green
    }
    val secondary = when {
        albumTint != null -> albumTint.mutedColor
        artistColors != null -> ArtistSecondaryText
        else -> Muted
    }
    val rowModifier = when {
        albumTint != null -> Modifier
            .background(if (isCurrent) albumTint.surfaceColor else Color.Transparent)
            .border(2.dp, if (focused) Color(0xFF6DED9A) else Color.Transparent, rowShape)
            .onFocusChanged { focused = it.isFocused }
        artistColors != null -> Modifier
            .background(if (isCurrent) artistColors.surface else Color.Transparent)
            .border(2.dp, if (focused) Color.White else Color.Transparent, rowShape)
            .onFocusChanged { focused = it.isFocused }
        else -> Modifier
    }
    Row(
        Modifier.fillMaxWidth().heightIn(min=56.dp).clip(rowShape).then(rowModifier)
            .combinedClickable(onClickLabel="Reproducir",onLongClickLabel="Abrir opciones",
                onClick=play,onLongClick=more)
            .semantics { if(isCurrent) stateDescription="Canción actual" },
        verticalAlignment=Alignment.CenterVertically
    ) {
        if(trackNumber==null) {
            Cover(song.artwork,Modifier.size(artworkSize).clip(RoundedCornerShape(Radii.row)),artworkSize,
                artistColors?.surface ?: Surface)
        } else {
            Text("$trackNumber",Modifier.width(24.dp),color=secondary,style=MaterialTheme.typography.bodySmall,
                textAlign=TextAlign.Center,maxLines=1)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).padding(vertical=6.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                if(isCurrent) Box(Modifier.size(5.dp).background(accent,CircleShape))
                Text(song.title,color=if(isCurrent) accent else TextColor,style=MaterialTheme.typography.titleSmall,
                    maxLines=1,overflow=TextOverflow.Ellipsis)
            }
            Row(verticalAlignment=Alignment.CenterVertically) {
                if(song.offlineReady) {
                    Icon(Icons.Default.Download,"Disponible sin conexión",Modifier.size(12.dp),tint=accent)
                    Spacer(Modifier.width(4.dp))
                }
                val showArtist = song.artist.isNotBlank() && (albumArtist.isNullOrBlank() || !song.artist.equals(albumArtist, ignoreCase = true))
                if(showArtist) {
                    Text(song.artist,color=secondary,style=MaterialTheme.typography.bodySmall,maxLines=1,
                        overflow=TextOverflow.Ellipsis)
                }
            }
            status?.invoke()
        }
        if(showFavorite && song.favorite) {
            Spacer(Modifier.width(8.dp))
            Icon(Icons.Default.Favorite,"Favorita",Modifier.size(14.dp),tint=accent)
        }
        if(song.duration > 0 && albumTint != null) {
            Text(
                formatTrackDuration(song.duration),
                color = secondary,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                modifier = Modifier.padding(end = 4.dp)
            )
        }
        actions?.invoke()
        Box {
            ActionIcon(Icons.Default.MoreVert,"Opciones de ${song.title}",action=more)
            menu?.invoke()
        }
        if(plays!=null) {
            Text(
                "$plays",
                Modifier.width(48.dp).padding(end=PlayCountEndPadding).clearAndSetSemantics {
                    contentDescription=if(plays==1) "1 reproducción" else "$plays reproducciones"
                },
                textAlign=TextAlign.End,color=secondary,style=MaterialTheme.typography.bodySmall,maxLines=1
            )
        }
    }
}
@Composable internal fun SongCard(song: Song,play: ()->Unit,more: ()->Unit) {
    val size=144.dp
    Column(Modifier.width(size).combinedClickable(onClick=play,onLongClick=more),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Cover(song.artwork,Modifier.size(size).clip(RoundedCornerShape(Radii.card)),size,background=Raised)
        Text(song.title,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleSmall)
        Text(song.artist,maxLines=1,overflow=TextOverflow.Ellipsis,color=Muted,style=MaterialTheme.typography.bodySmall)
    }
}
@Composable internal fun Cards(cards: List<JsonObject>,kind: String,open: (String,String,String)->Unit) {
    val size=144.dp
    val shape=if(kind=="artist") CircleShape else RoundedCornerShape(Radii.card)
    CardRow {
        items(cards,key={ it.getValue("id").jsonPrimitive.content }) { card ->
            val name=(card["title"] ?: card["name"])?.jsonPrimitive?.content.orEmpty()
            Column(Modifier.width(size).clickable { open(kind,card.getValue("id").jsonPrimitive.content,name) },verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Cover(card["artwork"]?.jsonPrimitive?.contentOrNull,Modifier.size(size).clip(shape),size,background=Raised)
                Text(name,maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleSmall)
            }
        }
    }
}

internal val FavoriteArtworkColor=Color(0xff1c3528)

@Composable internal fun FavoritesCover(modifier: Modifier,size: Dp) {
    Box(modifier.background(FavoriteArtworkColor),contentAlignment=Alignment.Center) {
        Icon(Icons.Default.Favorite,null,Modifier.size(size*0.42f),tint=Green)
    }
}

@Composable internal fun ArtworkMosaic(artwork: List<String>,modifier: Modifier,size: Dp) {
    if(artwork.isEmpty()) {
        Box(modifier.background(Raised),contentAlignment=Alignment.Center) {
            Icon(Icons.Default.BarChart,null,Modifier.size(size*0.55f),tint=Muted)
        }
        return
    }
    Column(modifier.background(Ink),verticalArrangement=Arrangement.spacedBy(1.dp)) {
        repeat(2) { row ->
            Row(Modifier.weight(1f),horizontalArrangement=Arrangement.spacedBy(1.dp)) {
                repeat(2) { column ->
                    val index=row*2+column
                    val source=artwork.getOrNull(index)
                    val tile=Modifier.weight(1f).fillMaxHeight()
                    if(source!=null) Cover(source,tile,size/2)
                    else Box(tile.background(Raised))
                }
            }
        }
    }
}

@Composable internal fun PillChip(label: String,selected: Boolean,greenSelection: Boolean = false,onClick: ()->Unit) {
    val background=when {
        !selected -> Raised
        greenSelection -> FavoriteArtworkColor
        else -> Color.White
    }
    val foreground=when {
        !selected -> TextColor
        greenSelection -> Green
        else -> Color.Black
    }
    Box(
        Modifier.heightIn(min=48.dp).widthIn(min=48.dp).clip(CircleShape)
            .selectable(selected=selected,onClick=onClick,role=Role.Tab),
        contentAlignment=Alignment.Center
    ) {
        Text(label,Modifier.heightIn(min=32.dp).background(background,CircleShape)
            .padding(horizontal=12.dp,vertical=7.dp),color=foreground,style=MaterialTheme.typography.labelMedium)
    }
}

@Composable internal fun SearchPill(
    query: String,
    onQuery: (String)->Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    height: Dp = 48.dp,
    clearLabel: String = "Borrar",
    artistColors: ArtistPageColors? = null,
    surfaceColor: Color? = null
) {
    val fieldStyle=MaterialTheme.typography.bodyLarge.copy(color=if (surfaceColor != null || artistColors != null) Color.White else TextColor,fontSize=16.sp)
    val keyboard=LocalSoftwareKeyboardController.current
    var focused by remember { mutableStateOf(false) }
    val accent = if (artistColors == null && surfaceColor == null) Green else Color.White
    val secondary = if (artistColors == null && surfaceColor == null) Muted else ArtistSecondaryText
    val focusBorder=if(focused) Modifier.border(2.dp,accent,CircleShape) else Modifier
    val pillBg = surfaceColor ?: artistColors?.deep ?: Raised
    BasicTextField(
        value=query,onValueChange=onQuery,
        modifier=modifier.heightIn(min=height).clip(CircleShape).background(pillBg).then(focusBorder)
            .onFocusChanged { focused=it.isFocused }.semantics { contentDescription=placeholder },
        textStyle=fieldStyle,singleLine=true,cursorBrush=SolidColor(accent),
        keyboardOptions=KeyboardOptions(autoCorrectEnabled=false,imeAction=ImeAction.Search),
        keyboardActions=KeyboardActions(onSearch={ keyboard?.hide() }),
        decorationBox={ input ->
            Row(Modifier.padding(start=14.dp,end=if(query.isEmpty()) 14.dp else 0.dp),
                verticalAlignment=Alignment.CenterVertically) {
                Icon(Icons.Default.Search,null,Modifier.size(20.dp),tint=secondary)
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f).padding(vertical=8.dp)) {
                    if(query.isEmpty()) Text(placeholder,style=fieldStyle,color=secondary,maxLines=1,
                        overflow=TextOverflow.Ellipsis)
                    input()
                }
                if(query.isNotEmpty()) ActionIcon(Icons.Default.Close,clearLabel,tint=secondary) { onQuery("") }
            }
        }
    )
}

internal fun LazyListScope.collectionFilterItem(
    key: String,query: String,onQuery: (String)->Unit,onFilters: ()->Unit,
    filtersActive: Boolean,filteredCount: Int? = null,placeholder: String = "Buscar en esta colección",
    artistColors: ArtistPageColors? = null,surfaceColor: Color? = null
) {
    gutterItem(key) {
        Row(verticalAlignment=Alignment.CenterVertically) {
            SearchPill(query,onQuery,placeholder,Modifier.weight(1f),artistColors=artistColors,surfaceColor=surfaceColor)
            Spacer(Modifier.width(4.dp))
            IconButton(onClick=onFilters,modifier=Modifier.size(48.dp)) {
                Box {
                    Icon(Icons.Default.Tune,if(filtersActive) "Filtros y orden, filtros activos" else "Filtros y orden",
                        tint = if (surfaceColor != null || artistColors != null) Color.White else LocalContentColor.current)
                    if(filtersActive) Box(Modifier.align(Alignment.TopEnd).size(7.dp)
                        .background(if (artistColors == null && surfaceColor == null) Green else Color.White,CircleShape))
                }
            }
        }
        if(filteredCount!=null) {
            Text(if(filteredCount==1) "1 coincidencia" else "$filteredCount coincidencias",
                Modifier.padding(start=14.dp,top=8.dp,bottom=4.dp),color=if (artistColors == null && surfaceColor == null) Muted else ArtistSecondaryText,
                style=MaterialTheme.typography.bodySmall)
        }
    }
}

internal fun LazyListScope.songItems(tracks: List<Song>,songMap: Map<String,Song>,currentId: String?,play: (Song)->Unit,
    onSongActions: (Song)->Unit,stats: Map<String,List<ListeningRow>> = emptyMap(),
    keyPrefix: String = "songs",trackNumbers: Map<String,Int> = emptyMap(),showFavorite: Boolean = true,
    artworkSize: Dp = 48.dp,artistColors: ArtistPageColors? = null,
    albumTint: AlbumTintColors? = null,albumArtist: String? = null) {
    val occurrences=mutableMapOf<String,Int>()
    val rows=tracks.map { song ->
        val occurrence=(occurrences[song.id] ?: 0)+1
        occurrences[song.id]=occurrence
        "$keyPrefix:${song.id}:$occurrence" to song
    }
    gutterItems(rows,key={ it.first }) { (_,song) ->
        val saved=songMap[song.id]
        SongRow(
            song.copy(favorite=saved?.favorite ?: song.favorite,offlineReady=saved?.offlineReady ?: song.offlineReady),
            currentId,{ play(song) },{ onSongActions(song) },stats[song.id]?.sumOf { it.plays },
            trackNumber=trackNumbers[song.id],showFavorite=showFavorite,artworkSize=artworkSize,artistColors=artistColors,
            albumTint=albumTint,albumArtist=albumArtist
        )
        if(albumTint != null) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(albumTint.surfaceColor))
        }
    }
}
