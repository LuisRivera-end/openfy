package app.openfy.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.openfy.android.data.CollectionRules
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song

internal fun LazyListScope.libraryItems(vm: OpenfyViewModel,librarySongs: List<Song>,playlists: List<PlaylistRow>,
    tracks: List<Song>,songMap: Map<String,Song>,currentId: String?,mode: String,onMode: (String)->Unit,
    query: String,onQuery: (String)->Unit,onFilters: ()->Unit,importFiles: ()->Unit,importFolder: ()->Unit,
    createPlaylist: ()->Unit,onSongActions: (Song)->Unit,filtersActive: Boolean,onClearFilters: ()->Unit,
    rankingArtwork: List<String>) {
    gutterItem("library:categories") {
        var showAdd by rememberSaveable { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).horizontalScroll(rememberScrollState()).selectableGroup(),
                horizontalArrangement=Arrangement.spacedBy(8.dp)
            ) {
                listOf("Canciones","Álbumes","Artistas","Playlists").forEach { label ->
                    PillChip(label,mode==label,greenSelection=true) { onMode(label) }
                }
            }
            Spacer(Modifier.width(4.dp))
            ActionIcon(Icons.Default.Add,"Añadir") { showAdd=true }
        }
        if(showAdd) {
            LibraryAddSheet(dismiss={ showAdd=false },importFiles=importFiles,importFolder=importFolder,
                createPlaylist=createPlaylist)
        }
    }
    val isFiltered=query.isNotEmpty() || filtersActive
    if(mode=="Playlists" || mode=="Canciones") {
        gutterItem("library:favorites") {
            LibraryCollectionRow("Tus favoritas","Playlist",{ vm.openLocal("favorites","favorites","Tus favoritas",emptyList()) }) {
                FavoritesCover(Modifier.size(44.dp).clip(RoundedCornerShape(Radii.row)),44.dp)
            }
        }
        gutterItem("library:ranking") {
            LibraryCollectionRow("Más reproducidas","Historial",{ vm.openLocal("top","top","Más reproducidas",emptyList()) }) {
                ArtworkMosaic(rankingArtwork,Modifier.size(44.dp).clip(RoundedCornerShape(Radii.row)),44.dp)
            }
        }
    }
    if(mode=="Canciones") {
        collectionFilterItem("library:filter",query,onQuery,onFilters,filtersActive,
            if(isFiltered) tracks.size else null,placeholder="Buscar en tu biblioteca")
    }
    if(mode=="Playlists") {
        gutterItems(playlists,key={ "library:playlist:${it.id}" }) { row ->
            val entries=CollectionRules.entries(row.entries)
            LibraryCollectionRow(row.name,"Playlist · ${songCount(entries.size)}",{
                vm.openLocal("playlist",row.id,row.name,emptyList())
            }) {
                Cover(entries.firstNotNullOfOrNull { songMap[it]?.artwork },
                    Modifier.size(44.dp).clip(RoundedCornerShape(Radii.row)),44.dp)
            }
        }
    }
    if(mode=="Álbumes" || mode=="Artistas") {
        val albums=mode=="Álbumes"
        val kind=if(albums) "localalbum" else "localartist"
        val shape=if(albums) RoundedCornerShape(Radii.row) else CircleShape
        val type=if(albums) "Álbum" else "Artista"
        val untitled=if(albums) "Sin álbum" else "Artista desconocido"
        val groups=librarySongs.groupBy {
            if(albums) {
                val albumArtist = it.albumArtist()
                if (albumArtist.isNotBlank()) "$albumArtist\u0000${it.album}" else it.album
            } else it.artist
        }.entries.sortedBy {
            val songs = it.value
            if (albums) songs.firstOrNull()?.album?.ifBlank { untitled } ?: untitled else it.key.ifBlank { untitled }
        }
        gutterItems(groups,key={ "library:$kind:${it.key}" }) { (id,songs) ->
            val artwork=songs.firstNotNullOfOrNull { it.artwork }
            val name=if(albums) songs.firstOrNull()?.album?.ifBlank { untitled } ?: untitled else id.ifBlank { untitled }
            val distinctArtists = songs.map { it.albumArtist() }.filter(String::isNotBlank).distinct()
            val albumArtist = if (distinctArtists.size == 1) distinctArtists.first() else null
            LibraryCollectionRow(name,"$type · ${songCount(songs.size)}",{
                vm.openLocal(kind,id,name,songs,artwork,artist=albumArtist)
            }) {
                Cover(artwork,Modifier.size(44.dp).clip(shape),44.dp)
            }
        }
    }
    if(librarySongs.isEmpty() && mode!="Playlists" && (mode!="Canciones" || !isFiltered)) {
        gutterItem("library:empty") { Empty("Tu biblioteca está vacía","Guarda canciones o importa tus archivos.") }
    }
    if(mode=="Canciones") {
        if(isFiltered && tracks.isEmpty()) noCollectionMatches("library:no-matches",onClearFilters)
        songItems(tracks,songMap,currentId,{ vm.play(it,tracks) },onSongActions,artworkSize=44.dp)
    }
}

@Composable private fun LibraryCollectionRow(title: String,subtitle: String,onClick: ()->Unit,artwork: @Composable ()->Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min=64.dp).clip(RoundedCornerShape(Radii.row))
            .clickable(role=Role.Button,onClick=onClick),
        verticalAlignment=Alignment.CenterVertically,
        horizontalArrangement=Arrangement.spacedBy(12.dp)
    ) {
        artwork()
        Column(verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(title,style=MaterialTheme.typography.titleSmall,maxLines=1,overflow=TextOverflow.Ellipsis)
            Text(subtitle,color=Muted,style=MaterialTheme.typography.bodySmall,maxLines=1,overflow=TextOverflow.Ellipsis)
        }
    }
}
