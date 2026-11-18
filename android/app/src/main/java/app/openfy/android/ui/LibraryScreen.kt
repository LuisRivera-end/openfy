package app.openfy.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import app.openfy.android.data.CollectionRules
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song

internal fun LazyListScope.libraryItems(vm: OpenfyViewModel,librarySongs: List<Song>,playlists: List<PlaylistRow>,
    tracks: List<Song>,songMap: Map<String,Song>,currentId: String?,mode: String,onMode: (String)->Unit,
    query: String,onQuery: (String)->Unit,onFilters: ()->Unit,importFiles: ()->Unit,importFolder: ()->Unit,
    createPlaylist: ()->Unit,onSongActions: (Song)->Unit) {
    gutterItem {
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            AssistChip({ vm.openLocal("favorites","favorites","Tus favoritas",emptyList()) },label={ Text("Favoritas") },leadingIcon={ Icon(Icons.Default.Favorite,null,Modifier.size(18.dp),tint=Green) })
            AssistChip({ vm.openLocal("top","top","Más reproducidas",emptyList()) },label={ Text("Más reproducidas") })
        }
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf("Canciones","Álbumes","Artistas","Playlists").forEach { label -> FilterChip(mode==label,{ onMode(label) },label={ Text(label) }) }
        }
        Row {
            TextButton(onClick=importFiles) { Icon(Icons.Default.Add,null); Text("Importar") }
            TextButton(onClick=importFolder) { Icon(Icons.Default.FolderOpen,null); Text("Carpeta") }
            if(mode=="Playlists") TextButton(onClick=createPlaylist) { Text("Crear playlist") }
        }
    }
    if(mode=="Playlists") {
        gutterItems(playlists,key={ it.id }) { row ->
            val entries=CollectionRules.entries(row.entries)
            val size=56.dp
            ListItem(headlineContent={ Text(row.name,style=MaterialTheme.typography.titleSmall) },
                supportingContent={ Text("${entries.size} canciones",style=MaterialTheme.typography.bodySmall) },
                leadingContent={ Cover(entries.firstNotNullOfOrNull { songMap[it]?.artwork },Modifier.size(size).clip(RoundedCornerShape(Radii.row)),size) },
                modifier=Modifier.clickable { vm.openLocal("playlist",row.id,row.name,emptyList()) },colors=ListItemDefaults.colors(containerColor=Ink))
        }
    }
    if(mode=="Álbumes" || mode=="Artistas") {
        val albums=mode=="Álbumes"
        val shape=if(albums) RoundedCornerShape(Radii.card) else CircleShape
        val groups=librarySongs.groupBy { if(albums) it.album.ifBlank { "Sin álbum" } else it.artist.ifBlank { "Artista desconocido" } }.toSortedMap()
        gutterItems(groups.entries.toList(),key={ it.key }) { (name,songs) ->
            val size=64.dp
            val artwork=songs.firstOrNull()?.artwork
            ListItem(headlineContent={ Text(name,style=MaterialTheme.typography.titleSmall) },
                supportingContent={ Text("${songs.size} canciones",style=MaterialTheme.typography.bodySmall) },
                leadingContent={ Cover(artwork,Modifier.size(size).clip(shape),size) },
                modifier=Modifier.clickable { vm.openLocal(if(albums) "localalbum" else "localartist",if(name in setOf("Sin álbum","Artista desconocido")) "" else name,name,songs,artwork) },
                colors=ListItemDefaults.colors(containerColor=Ink))
        }
    }
    if(librarySongs.isEmpty() && mode!="Playlists") gutterItem { Empty("Tu biblioteca está lista para empezar.","Marca favoritas, crea una playlist o importa tus archivos.") }
    if(mode=="Canciones") {
        collectionFilterItem(query,onQuery,onFilters)
        songItems(tracks,songMap,currentId,{ vm.play(it,tracks) },onSongActions)
    }
}
