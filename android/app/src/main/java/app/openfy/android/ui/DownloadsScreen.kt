package app.openfy.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.openfy.android.data.DownloadRow
import app.openfy.android.data.Song
import java.util.Locale

internal fun LazyListScope.downloadsItems(vm: OpenfyViewModel,downloads: List<DownloadRow>,songMap: Map<String,Song>,currentId: String?,
    download: (Song)->Unit,onRemove: (Song)->Unit,onSongActions: (Song)->Unit) {
    gutterItem {
        Text("${downloads.count { it.state=="ready" }} canciones disponibles sin conexión",style=MaterialTheme.typography.bodyMedium,fontWeight=FontWeight.SemiBold)
        Text("${String.format(Locale.US,"%.1f",downloads.sumOf { it.bytes }.toDouble()/1024/1024)} MB descargados",
            color=Muted,style=MaterialTheme.typography.bodyMedium,modifier=Modifier.padding(vertical=8.dp))
    }
    val visible=downloads.filter { it.state!="removed" }
    gutterItems(visible,key={ it.id }) { row ->
        songMap[row.id]?.let { song ->
            SongRow(song,currentId,{ vm.play(song) },{ onSongActions(song) })
            Text(when(row.state) { "ready" -> "Disponible sin conexión"; "verifying" -> "Verificando audio"; "paused" -> "En pausa"; "error" -> row.error ?: "Descarga interrumpida"; "downloading" -> "Descargando"; else -> "En cola" },
                color=Muted,style=MaterialTheme.typography.bodySmall)
            if(row.state=="downloading" && row.total>0) LinearProgressIndicator(progress={ (row.bytes.toFloat()/row.total).coerceIn(0f,1f) },modifier=Modifier.fillMaxWidth().padding(vertical=8.dp))
            Row {
                if(row.state in setOf("error","paused")) TextButton(onClick={ if(row.state=="error") download(song) else vm.app.downloads.pause(row.id,false) }) { Text("Reintentar / reanudar") }
                if(row.state in setOf("downloading","queued")) TextButton(onClick={ vm.app.downloads.pause(row.id,true) }) { Text("Pausar") }
                TextButton(onClick={ onRemove(song) }) { Text(if(row.state=="ready") "Eliminar descarga" else "Cancelar") }
            }
        }
    }
    if(visible.isEmpty()) gutterItem { Empty("Lleva tu música sin conexión.","Abre las opciones de una canción, álbum o playlist y elige Descargar.") }
}
