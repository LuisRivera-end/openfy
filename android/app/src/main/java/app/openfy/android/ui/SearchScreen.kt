@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package app.openfy.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.coerceAtLeast
import androidx.compose.ui.unit.dp
import app.openfy.android.data.Song
import kotlinx.serialization.json.*

internal fun LazyListScope.searchItems(vm: OpenfyViewModel,search: SearchState,tracks: List<Song>,songMap: Map<String,Song>,
    currentId: String?,onSongActions: (Song)->Unit) {
    stickyHeader(key="search:controls") {
        Column(Modifier.fillMaxWidth().background(Ink).padding(horizontal=Gutter).padding(top=4.dp)) {
            SearchPill(search.query,{ vm.query(it) },"¿Qué quieres escuchar?",Modifier.fillMaxWidth(),
                height=52.dp,clearLabel="Borrar búsqueda")
            Row(
                Modifier.horizontalScroll(rememberScrollState()).selectableGroup(),
                horizontalArrangement=Arrangement.spacedBy(8.dp)
            ) {
                listOf("songs" to "Canciones","artists" to "Artistas","albums" to "Álbumes").forEach { (kind,label) ->
                    PillChip(label,search.kind==kind) { if(search.kind!=kind) vm.query(search.query,kind) }
                }
            }
        }
    }
    if(search.query.trim().length<2) {
        gutterItem("search:prompt") {
            Text(
                if(search.query.isBlank()) "Escribe el nombre de una canción, artista o álbum."
                else "Escribe al menos dos caracteres.",
                Modifier.padding(top=16.dp),color=Muted,style=MaterialTheme.typography.bodyMedium
            )
        }
        return
    }
    if(search.pending) {
        skeletons("search:loading")
        return
    }
    val isSongSearch=search.kind=="songs"
    val hasResults=if(isSongSearch) tracks.isNotEmpty() else search.cards.isNotEmpty()
    val error=search.error
    if(!hasResults) {
        when {
            error!=null -> gutterItem("search:error") { Retry(error,vm::retrySearch) }
            search.loading -> skeletons("search:loading")
            else -> gutterItem("search:no-results") {
                Empty("Sin resultados","Prueba con otro título o nombre.")
            }
        }
        return
    }

    if(isSongSearch) {
        songItems(tracks,songMap,currentId,{ vm.play(it,tracks) },onSongActions,keyPrefix="search:song")
    } else {
        val kind=if(search.kind=="artists") "artist" else "album"
        gutterItems(search.cards.chunked(2),key={ "search:$kind:${it.first().getValue("id").jsonPrimitive.content}" }) {
            SearchCardPair(it,kind,vm::openRemote)
        }
    }
    when {
        error!=null -> gutterItem("search:page-error") { Retry(error,vm::retrySearch) }
        search.loading -> gutterItem("search:page-loading") {
            Box(Modifier.fillMaxWidth().padding(16.dp),contentAlignment=Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp).semantics {
                    contentDescription="Cargando más resultados"
                },strokeWidth=2.dp)
            }
        }
    }
}

@Composable
private fun SearchCardPair(cards: List<JsonObject>,kind: String,open: (String,String,String)->Unit) {
    val shape=if(kind=="artist") CircleShape else RoundedCornerShape(Radii.card)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val gap=16.dp
        val size=((maxWidth-gap)/2).coerceAtLeast(1.dp)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(gap)) {
            cards.forEach { card ->
                val id=card.getValue("id").jsonPrimitive.content
                val name=(card["name"] ?: card["title"])?.jsonPrimitive?.content.orEmpty()
                Column(
                    Modifier.weight(1f).padding(bottom=16.dp).clickable { open(kind,id,name) },
                    verticalArrangement=Arrangement.spacedBy(8.dp)
                ) {
                    Cover(card["artwork"]?.jsonPrimitive?.contentOrNull,
                        Modifier.fillMaxWidth().aspectRatio(1f).clip(shape),size,background=Raised)
                    Text(name,maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleSmall)
                }
            }
            if(cards.size==1) Spacer(Modifier.weight(1f))
        }
    }
}
