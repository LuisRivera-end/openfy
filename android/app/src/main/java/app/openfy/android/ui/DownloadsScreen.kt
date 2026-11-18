package app.openfy.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.openfy.android.data.DownloadRow
import app.openfy.android.data.Song
import java.util.Locale

internal fun LazyListScope.downloadsItems(vm: OpenfyViewModel,downloads: List<DownloadRow>,songMap: Map<String,Song>,currentId: String?,
    download: (Song)->Unit,onRemove: (Song)->Unit,onSongActions: (Song)->Unit) {
    val visible=downloads.filter { it.state!="removed" && it.id in songMap }
    if(visible.isEmpty()) {
        gutterItem("downloads:empty") {
            Column(Modifier.padding(top=SectionGap),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text("Aún no tienes descargas",style=MaterialTheme.typography.titleLarge)
                Text("Descarga canciones para escucharlas sin conexión.",color=Muted,style=MaterialTheme.typography.bodyMedium)
                Button(onClick={ vm.selectTab(2) },modifier=Modifier.heightIn(min=48.dp)) { Text("Ir a biblioteca") }
            }
        }
        return
    }
    val count=songCount(visible.count { it.state=="ready" })
    val megabytes=String.format(Locale.US,"%.1f",visible.sumOf { it.bytes }.toDouble()/1_048_576)
    gutterItem("downloads:summary") {
        Text("$count · $megabytes MB",color=Muted,style=MaterialTheme.typography.bodySmall,
            modifier=Modifier.padding(top=8.dp,bottom=6.dp))
    }
    gutterItems(visible,key={ "downloads:song:${it.id}" }) { row ->
        val song=songMap.getValue(row.id)
        var menuOpen by remember { mutableStateOf(false) }
        SongRow(
            song,currentId,{ vm.play(song) },{ menuOpen=true },
            status={ if(row.state!="ready") DownloadStatus(row) },
            actions={
                when(row.state) {
                    "error" -> ActionIcon(Icons.Default.Refresh,"Reintentar descarga",action={ download(song) })
                    "paused" -> ActionIcon(Icons.Default.PlayArrow,"Reanudar descarga") { vm.app.downloads.pause(row.id,false) }
                    "downloading","queued" -> ActionIcon(Icons.Default.Pause,"Pausar descarga") { vm.app.downloads.pause(row.id,true) }
                }
            },
            menu={
                DropdownMenu(expanded=menuOpen,onDismissRequest={ menuOpen=false }) {
                    DropdownMenuItem(text={ Text(if(row.state=="ready") "Eliminar descarga" else "Cancelar descarga") },
                        onClick={ menuOpen=false; onRemove(song) })
                    DropdownMenuItem(text={ Text("Opciones de la canción") },
                        onClick={ menuOpen=false; onSongActions(song) })
                }
            }
        )
    }
}

@Composable
private fun DownloadStatus(row: DownloadRow) {
    val status=when(row.state) {
        "verifying" -> "Verificando audio"
        "paused" -> "En pausa"
        "error" -> row.error ?: "Descarga interrumpida"
        "downloading" -> "Descargando"
        else -> "En cola"
    }
    Text(status,color=Muted,style=MaterialTheme.typography.bodySmall,maxLines=2,overflow=TextOverflow.Ellipsis)
    val progressModifier=Modifier.fillMaxWidth().padding(top=4.dp,end=8.dp).height(3.dp)
    if(row.total>0 && (row.state=="downloading" || row.state=="paused")) {
        LinearProgressIndicator(
            progress={ (row.bytes.toFloat()/row.total).coerceIn(0f,1f) },modifier=progressModifier,
            color=Green,trackColor=Raised,strokeCap=StrokeCap.Round,gapSize=0.dp,drawStopIndicator={}
        )
    } else if(row.state=="downloading" || row.state=="verifying") {
        LinearProgressIndicator(modifier=progressModifier,color=Green,trackColor=Raised,strokeCap=StrokeCap.Round)
    }
}
