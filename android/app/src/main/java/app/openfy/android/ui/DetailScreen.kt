package app.openfy.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song

internal fun LazyListScope.detailItems(vm: OpenfyViewModel,detail: DetailState,playlist: PlaylistRow?,tracks: List<Song>,
    songMap: Map<String,Song>,currentId: String?,stats: Map<String,List<ListeningRow>>,period: String,onPeriod: (String)->Unit,
    query: String,onQuery: (String)->Unit,onFilters: ()->Unit,requestNotifications: ()->Unit,
    onRename: (PlaylistRow)->Unit,onDelete: (PlaylistRow)->Unit,onSongActions: (Song)->Unit) {
    gutterItem {
        Column(Modifier.fillMaxWidth().padding(vertical=Gutter),horizontalAlignment=Alignment.CenterHorizontally) {
            val size=192.dp
            val shape=if(detail.kind=="artist" || detail.kind=="localartist") CircleShape else RoundedCornerShape(Radii.feature)
            Cover(detail.artwork ?: tracks.firstOrNull()?.artwork,Modifier.size(size).clip(shape),size)
            Text(playlist?.name ?: detail.title,style=MaterialTheme.typography.headlineMedium,modifier=Modifier.padding(top=Gutter,bottom=8.dp))
            if(detail.subtitle.isNotBlank()) Text(detail.subtitle,color=Muted,style=MaterialTheme.typography.bodyMedium,maxLines=5,overflow=TextOverflow.Ellipsis)
            Text("${tracks.size} canciones",color=Muted,style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(8.dp))
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically) {
                ActionIcon(Icons.Default.Shuffle,"Reproducir aleatoriamente") { tracks.firstOrNull()?.let { vm.play(it,tracks,true) } }
                Button(onClick={ tracks.firstOrNull()?.let { vm.play(it,tracks) } },enabled=tracks.isNotEmpty()) { Icon(Icons.Default.PlayArrow,null); Text("Reproducir") }
                ActionIcon(Icons.Default.Download,"Descargar colección") {
                    requestNotifications()
                    tracks.filter { it.source=="youtube" }.forEach { vm.download(it) }
                    playlist?.let { vm.run { vm.app.repository.savePlaylist(it.copy(keepDownloaded=true)) } }
                }
            }
            playlist?.let { row ->
                Row {
                    TextButton(onClick={ onRename(row) }) { Text("Cambiar nombre") }
                    TextButton(onClick={ onDelete(row) }) { Text("Eliminar") }
                }
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Text("Mantener descargada",Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
                    Switch(checked=row.keepDownloaded,onCheckedChange={ vm.run { vm.app.repository.savePlaylist(row.copy(keepDownloaded=it)) } })
                }
            }
        }
    }
    detail.error?.let { message -> gutterItem { Retry(message) { vm.back(); vm.openRemote(detail.kind,detail.id,detail.title) } } }
    if(detail.loading && tracks.isEmpty()) skeletons()
    if(detail.kind=="top") gutterItem { Periods(period,onPeriod) }
    collectionFilterItem(query,onQuery,onFilters)
    songItems(tracks,songMap,currentId,{ vm.play(it,tracks) },onSongActions,if(detail.kind=="top") stats else emptyMap())
    if(detail.moreSongs) gutterItem { TextButton(onClick=vm::artistSongs,enabled=!detail.loading) { Text("Ver más canciones") } }
    if(detail.albums.isNotEmpty()) {
        gutterItem { SectionTitle("Álbumes y lanzamientos") }
        item { Cards(detail.albums,"album",vm::openRemote) }
    }
    if(detail.moreAlbums) gutterItem { TextButton(onClick={ vm.artistReleases("albums") }) { Text("Ver más álbumes") } }
    if(detail.moreSingles) gutterItem { TextButton(onClick={ vm.artistReleases("singles") }) { Text("Ver más singles y EPs") } }
    if(detail.artists.isNotEmpty()) {
        gutterItem { SectionTitle("Artistas similares") }
        item { Cards(detail.artists,"artist",vm::openRemote) }
    }
}
