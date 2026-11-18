package app.openfy.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.RecentContext
import app.openfy.android.data.Song
import kotlinx.serialization.json.JsonObject
import java.time.ZoneId
import java.time.ZonedDateTime

internal fun homeGreeting(now: ZonedDateTime = ZonedDateTime.now(ZoneId.of("America/Mexico_City"))): String =
    when(now.hour) { in 5..11 -> "Buenos días"; in 12..19 -> "Buenas tardes"; else -> "Buenas noches" }

internal fun LazyListScope.homeItems(vm: OpenfyViewModel,listening: List<ListeningRow>,recents: List<RecentContext>,
    songMap: Map<String,Song>,currentId: String?,stats: Map<String,List<ListeningRow>>,period: String,onPeriod: (String)->Unit,
    suggestions: List<Song>,releases: List<JsonObject>,importFiles: ()->Unit,onSongActions: (Song)->Unit) {
    gutterItem {
        Row(Modifier.fillMaxWidth().padding(vertical=16.dp),horizontalArrangement=Arrangement.spacedBy(24.dp)) {
            Stat("${stats.values.flatten().sumOf { it.listenedMs }/60000}","minutos escuchados")
            Stat("${stats.values.flatten().sumOf { it.plays }}","reproducciones")
        }
        Periods(period,onPeriod)
    }
    val recentSongs=listening.groupBy { it.songId }.toList().sortedByDescending { it.second.maxOf { s -> s.lastPlayedAt } }
        .take(10).mapNotNull { songMap[it.first] }
    if(recents.isNotEmpty()) {
        gutterItem { SectionTitle("Escuchadas recientemente") }
        item { CardRow { items(recents,key={ "${it.kind}:${it.id}" }) { card ->
            val size=144.dp
            val shape=if(card.kind=="artist") CircleShape else RoundedCornerShape(Radii.card)
            Column(Modifier.width(size).clickable { vm.openRecent(card) },verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Cover(card.artwork,Modifier.size(size).clip(shape),size,background=Raised)
                Text(card.title,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleSmall)
                Text(when(card.kind) { "playlist" -> "Playlist"; "favorites" -> "Tus favoritas"; "album" -> "Álbum"; "artist" -> "Artista"; else -> card.subtitle },
                    color=Muted,style=MaterialTheme.typography.bodySmall,maxLines=1)
            }
        } } }
    } else if(recentSongs.isNotEmpty()) {
        gutterItem { SectionTitle("Escuchadas recientemente") }
        item { CardRow { items(recentSongs,key={ it.id }) { song -> SongCard(song,{ vm.play(song,recentSongs) },{ onSongActions(song) }) } } }
    } else gutterItem {
        Column(Modifier.padding(vertical=SectionGap),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text("Tu próxima canción empieza aquí.",style=MaterialTheme.typography.headlineMedium)
            Text("Busca música o añade tus archivos. Tus descargas te acompañan sin conexión.",color=Muted,style=MaterialTheme.typography.bodyMedium)
            Button(onClick={ vm.selectTab(1) }) { Text("Buscar música") }
            OutlinedButton(onClick=importFiles) { Text("Importar archivos") }
        }
    }
    if(stats.isNotEmpty()) {
        gutterItem { TextButton(onClick={ vm.openLocal("top","top","Más reproducidas",emptyList()) }) { Text("Más reproducidas"); Icon(Icons.Default.ArrowForward,null) } }
        gutterItems(stats.keys.mapNotNull(songMap::get).sortedByDescending { stats[it.id]?.sumOf { row -> row.plays } }.take(5),key={ "top:${it.id}" }) { song ->
            SongRow(song.copy(favorite=songMap[song.id]?.favorite ?: false),currentId,{ vm.play(song) },{ onSongActions(song) },stats[song.id]?.sumOf { it.plays })
        }
    }
    if(suggestions.isNotEmpty()) {
        gutterItem { SectionTitle("Para descubrir") }
        item { CardRow { items(suggestions,key={ it.id }) { song -> SongCard(song,{ vm.play(song,suggestions) },{ onSongActions(song) }) } } }
    }
    if(releases.isNotEmpty()) {
        gutterItem { SectionTitle("Nuevos lanzamientos") }
        item { Cards(releases,"album",vm::openRemote) }
    }
}
