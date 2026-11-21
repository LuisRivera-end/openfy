@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package app.openfy.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import app.openfy.android.data.CollectionRules
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song
import kotlinx.serialization.json.*
import java.util.Collections

@Composable internal fun SongActionsSheet(vm: OpenfyViewModel,song: Song,playlist: PlaylistRow?,dismiss: ()->Unit,
    onDownload: (Song)->Unit,onRemoveDownload: (Song)->Unit,onOpenRemote: (String,String,String)->Unit,onPlaylistPicker: (Song)->Unit) {
    ModalBottomSheet(onDismissRequest=dismiss,containerColor=Surface) {
        Text(song.title,style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(horizontal=24.dp,vertical=12.dp))
        SheetAction(if(song.favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,if(song.favorite) "Quitar de favoritas" else "Añadir a favoritas") { vm.favorite(song); dismiss() }
        SheetAction(Icons.Default.QueueMusic,"Añadir a la cola") { vm.queue(song); dismiss() }
        if(song.source=="youtube") SheetAction(Icons.Default.Download,if(song.offlineReady) "Eliminar descarga" else "Descargar") {
            if(song.offlineReady) onRemoveDownload(song) else onDownload(song)
            dismiss()
        }
        song.albumId?.let { id -> SheetAction(Icons.Default.Album,"Ir al álbum") { onOpenRemote("album",id,song.album); dismiss() } }
        song.artistId?.let { id -> SheetAction(Icons.Default.Person,"Ir al artista") { onOpenRemote("artist",id,song.artist); dismiss() } }
        SheetAction(Icons.Default.PlaylistAdd,"Añadir a playlist") { onPlaylistPicker(song); dismiss() }
        playlist?.let { row ->
            val ids=CollectionRules.entries(row.entries)
            val index=ids.indexOf(song.id)
            if(index>=0) {
                SheetAction(Icons.Default.RemoveCircleOutline,"Quitar de esta playlist") { vm.run { vm.app.repository.savePlaylist(row.copy(entries=CollectionRules.encode(ids.filterNot { it==song.id }))) }; dismiss() }
                if(index>0) SheetAction(Icons.Default.ArrowUpward,"Subir en la playlist") { val next=ids.toMutableList(); Collections.swap(next,index,index-1); vm.run { vm.app.repository.savePlaylist(row.copy(entries=CollectionRules.encode(next))) }; dismiss() }
                if(index<ids.lastIndex) SheetAction(Icons.Default.ArrowDownward,"Bajar en la playlist") { val next=ids.toMutableList(); Collections.swap(next,index,index+1); vm.run { vm.app.repository.savePlaylist(row.copy(entries=CollectionRules.encode(next))) }; dismiss() }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable private fun SheetAction(icon: ImageVector,label: String,action: ()->Unit) {
    ListItem(headlineContent={ Text(label,style=MaterialTheme.typography.bodyMedium) },leadingContent={ Icon(icon,null) },
        modifier=Modifier.fillMaxWidth().heightIn(min=52.dp).clickable(onClick=action),colors=ListItemDefaults.colors(containerColor=Surface))
}

@Composable internal fun LibraryAddSheet(
    dismiss: ()->Unit,importFiles: ()->Unit,importFolder: ()->Unit,createPlaylist: ()->Unit
) {
    ModalBottomSheet(onDismissRequest=dismiss,containerColor=Surface, sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Text("Añadir a tu biblioteca",style=MaterialTheme.typography.titleLarge,
            modifier=Modifier.padding(start=Gutter,end=Gutter,bottom=8.dp))
        SheetAction(Icons.Default.UploadFile,"Importar archivos") { dismiss(); importFiles() }
        SheetAction(Icons.Default.FolderOpen,"Importar carpeta") { dismiss(); importFolder() }
        SheetAction(Icons.Default.PlaylistAdd,"Crear playlist") { dismiss(); createPlaylist() }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable internal fun PlaylistPickerSheet(playlists: List<PlaylistRow>,dismiss: ()->Unit,onSelect: (PlaylistRow)->Unit,onCreate: ()->Unit) {
    ModalBottomSheet(onDismissRequest=dismiss) {
        Text("Añadir a playlist",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(24.dp))
        LazyColumn(Modifier.heightIn(max=440.dp)) {
            items(playlists,key={ it.id }) { row ->
                TextButton(onClick={ onSelect(row) },modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text(row.name,Modifier.fillMaxWidth()) }
            }
            item { TextButton(onClick=onCreate) { Text("Crear playlist") } }
        }
    }
}

@Composable internal fun PlaylistNameDialog(playlist: PlaylistRow?,dismiss: ()->Unit,save: (String)->Unit) {
    var name by rememberSaveable(playlist?.id) { mutableStateOf(playlist?.name.orEmpty()) }
    AlertDialog(onDismissRequest=dismiss,title={ Text(if(playlist==null) "Crear playlist" else "Cambiar nombre") },
        text={ OutlinedTextField(name,{ name=it.take(100) },label={ Text("Nombre") },singleLine=true) },
        confirmButton={ TextButton(enabled=name.isNotBlank(),onClick={ save(name) }) { Text("Guardar") } },
        dismissButton={ TextButton(onClick=dismiss) { Text("Cancelar") } })
}

private data class SongMetadataKey(val id: String, val metadata: String)
private val genreCache = object : LinkedHashMap<SongMetadataKey, List<String>>(128, 0.75f, true) {
    override fun removeEldestEntry(eldest: Map.Entry<SongMetadataKey, List<String>>?) = size > 2000
}
private fun songGenres(song: Song): List<String> = synchronized(genreCache) {
    genreCache.getOrPut(SongMetadataKey(song.id, song.metadata)) {
        runCatching {
            Json.parseToJsonElement(song.metadata).jsonObject["genres"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }
        }.getOrNull().orEmpty()
    }
}

@kotlinx.serialization.Serializable
internal data class Filters(val source: String = "all",val downloaded: Boolean = false,val favorite: Boolean = false,
    val artist: String = "",val album: String = "",val genre: String = "",val sort: String = "default",val descending: Boolean = false) {
    val hasActiveFilters: Boolean
        get()=source!="all" || downloaded || favorite || artist.isNotEmpty() || album.isNotEmpty() || genre.isNotBlank()

    fun clearFilters() = Filters(sort=sort,descending=descending)

    fun apply(songs: List<Song>,query: String,stats: Map<String,List<ListeningRow>>): List<Song> {
        val filtered=songs.filter { song ->
            (source=="all" || song.source==source) && (!downloaded || song.offlineReady) && (!favorite || song.favorite) &&
                song.artist.contains(artist,true) && song.album.contains(album,true) &&
                (genre.isBlank() || songGenres(song).any { it.contains(genre,true) }) && "${song.title} ${song.artist} ${song.album}".contains(query,true)
        }
        val comparator: Comparator<Song>?=when(sort) { "title" -> compareBy { it.title.lowercase() }; "artist" -> compareBy { it.artist.lowercase() }; "album" -> compareBy { it.album.lowercase() }
            "duration" -> compareBy { it.duration }; "plays" -> compareBy { stats[it.id]?.sumOf { row -> row.plays } ?: 0 }
            "minutes" -> compareBy { stats[it.id]?.sumOf { row -> row.listenedMs } ?: 0 }; "added" -> compareBy { it.addedAt }; else -> null }
        return if(comparator==null) filtered else filtered.sortedWith(if(descending) comparator.reversed() else comparator)
    }
}

@Composable internal fun FilterDialog(initial: Filters,save: (Filters)->Unit,dismiss: ()->Unit) {
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
                labels.forEach { (id,label) -> DropdownMenuItem(text={ Text(label) },onClick={ value=value.copy(sort=id); menu=false }) }
            } }
            Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(value.descending,{ value=value.copy(descending=it) }); Text("Orden descendente") }
        }
    },confirmButton={ TextButton(onClick={ save(value) }) { Text("Aplicar") } },dismissButton={ TextButton(onClick={ save(Filters()) }) { Text("Restablecer") } })
}
