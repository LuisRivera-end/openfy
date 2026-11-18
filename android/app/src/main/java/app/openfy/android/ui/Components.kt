@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package app.openfy.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.Song
import coil3.compose.AsyncImage
import kotlinx.serialization.json.*
import java.io.File

private fun Modifier.withGutter()=padding(horizontal=Gutter)

internal fun LazyListScope.gutterItem(content: @Composable ()->Unit) {
    item { Column(Modifier.fillMaxWidth().withGutter()) { content() } }
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
    Column { Text(value,style=MaterialTheme.typography.headlineMedium); Text(label,color=Muted,style=MaterialTheme.typography.bodySmall) }
}
@Composable internal fun Periods(current: String,select: (String)->Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf("7d" to "7 días","30d" to "30 días","year" to "Este año","all" to "Todo").forEach { (id,label) ->
            FilterChip(current==id,{ select(id) },label={ Text(label) })
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
internal fun LazyListScope.skeletons() {
    repeat(7) { gutterItem {
        Row(Modifier.padding(vertical=10.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(Radii.row)).background(Surface))
            Column {
                Box(Modifier.padding(top=5.dp).width(180.dp).height(16.dp).background(Surface))
                Box(Modifier.padding(top=10.dp).width(110.dp).height(12.dp).background(Surface))
            }
        }
    } }
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

@Composable internal fun ActionIcon(icon: ImageVector,label: String,tint: Color = TextColor,action: ()->Unit) {
    IconButton(onClick=action,modifier=Modifier.sizeIn(minWidth=48.dp,minHeight=48.dp)) { Icon(icon,label,tint=tint) }
}
@Composable internal fun Confirm(title: String,body: String,dismiss: ()->Unit,confirm: ()->Unit) {
    AlertDialog(onDismissRequest=dismiss,title={ Text(title) },text={ Text(body) },
        confirmButton={ TextButton(onClick=confirm) { Text("Eliminar") } },dismissButton={ TextButton(onClick=dismiss) { Text("Cancelar") } })
}
@Composable internal fun SongRow(song: Song,current: String?,play: ()->Unit,more: ()->Unit,plays: Int? = null) {
    val size=52.dp
    Row(Modifier.fillMaxWidth().heightIn(min=76.dp).combinedClickable(onClick=play,onLongClick=more),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Cover(song.artwork,Modifier.size(size).clip(RoundedCornerShape(Radii.row)),size)
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(song.title,color=if(current==song.id) Green else TextColor,style=MaterialTheme.typography.titleSmall,maxLines=1,overflow=TextOverflow.Ellipsis)
            Row(verticalAlignment=Alignment.CenterVertically) {
                if(song.offlineReady) { Icon(Icons.Default.Download,"Disponible sin conexión",Modifier.size(13.dp),tint=Green); Spacer(Modifier.width(4.dp)) }
                Text(if(plays!=null) "${song.artist} · $plays reproducciones" else song.artist,color=Muted,style=MaterialTheme.typography.bodySmall,maxLines=1,overflow=TextOverflow.Ellipsis)
            }
        }
        if(song.favorite) Icon(Icons.Default.Favorite,"Favorita",Modifier.size(16.dp),tint=Green)
        ActionIcon(Icons.Default.MoreVert,"Opciones de ${song.title}",action=more)
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

internal fun LazyListScope.collectionFilterItem(query: String,onQuery: (String)->Unit,onFilters: ()->Unit) {
    gutterItem {
        Row(verticalAlignment=Alignment.CenterVertically) {
            OutlinedTextField(query,onQuery,Modifier.weight(1f),singleLine=true,label={ Text("Buscar en esta colección") })
            ActionIcon(Icons.Default.Tune,"Filtros y orden",action=onFilters)
        }
    }
}

internal fun LazyListScope.songItems(tracks: List<Song>,songMap: Map<String,Song>,currentId: String?,play: (Song)->Unit,
    onSongActions: (Song)->Unit,stats: Map<String,List<ListeningRow>> = emptyMap()) {
    gutterItems(tracks,key={ it.id }) { song ->
        val saved=songMap[song.id]
        SongRow(song.copy(favorite=saved?.favorite ?: song.favorite,offlineReady=saved?.offlineReady ?: song.offlineReady),currentId,
            { play(song) },{ onSongActions(song) },stats[song.id]?.sumOf { it.plays })
    }
}
