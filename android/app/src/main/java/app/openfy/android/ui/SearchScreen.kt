package app.openfy.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.coerceAtLeast
import androidx.compose.ui.unit.dp
import app.openfy.android.data.Song
import kotlinx.serialization.json.*

internal fun LazyListScope.searchItems(vm: OpenfyViewModel,search: SearchState,tracks: List<Song>,songMap: Map<String,Song>,
    currentId: String?,onSongActions: (Song)->Unit) {
    gutterItem {
        OutlinedTextField(search.query,{ vm.query(it) },Modifier.fillMaxWidth(),singleLine=true,label={ Text("¿Qué quieres escuchar?") },leadingIcon={ Icon(Icons.Default.Search,null) })
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical=8.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf("songs" to "Canciones","artists" to "Artistas","albums" to "Álbumes").forEach { (kind,label) ->
                FilterChip(search.kind==kind,{ vm.query(search.query,kind) },label={ Text(label) })
            }
        }
    }
    search.error?.let { gutterItem { Retry(it,vm::retrySearch) } }
    if(search.loading && search.songs.isEmpty() && search.cards.isEmpty()) skeletons()
    val kind=if(search.kind=="artists") "artist" else "album"
    val shape=if(kind=="artist") CircleShape else RoundedCornerShape(Radii.card)
    gutterItems(search.cards.chunked(2),key={ it.first().getValue("id").jsonPrimitive.content }) { pair ->
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val gap=16.dp
            val size=((maxWidth-gap)/2).coerceAtLeast(1.dp)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(gap)) {
                pair.forEach { card ->
                    val name=(card["name"] ?: card["title"])?.jsonPrimitive?.content.orEmpty()
                    Column(Modifier.weight(1f).padding(bottom=16.dp).clickable { vm.openRemote(kind,card.getValue("id").jsonPrimitive.content,name) },verticalArrangement=Arrangement.spacedBy(8.dp)) {
                        Cover(card["artwork"]?.jsonPrimitive?.contentOrNull,Modifier.fillMaxWidth().aspectRatio(1f).clip(shape),size,background=Raised)
                        Text(name,maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleSmall)
                    }
                }
                if(pair.size==1) Spacer(Modifier.weight(1f))
            }
        }
    }
    if(search.query.length<2) gutterItem { Empty("Busca canciones, artistas y álbumes.","El catálogo se consulta directamente desde tu teléfono.") }
    else if(!search.loading && search.error==null && search.songs.isEmpty() && search.cards.isEmpty()) gutterItem { Empty("No encontramos resultados.","Prueba con otro nombre o artista.") }
    if(search.kind=="songs") songItems(tracks,songMap,currentId,{ vm.play(it,tracks) },onSongActions)
    if(search.loading && search.songs.isNotEmpty()) gutterItem { CircularProgressIndicator(Modifier.padding(16.dp)) }
}
