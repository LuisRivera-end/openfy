package app.openfy.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.openfy.android.data.Song

@Composable internal fun MiniPlayer(song: Song,state: PlayerState,toggle: ()->Unit,next: ()->Unit,expand: ()->Unit) {
    val size=44.dp
    Column(Modifier.padding(horizontal=12.dp,vertical=4.dp).clip(RoundedCornerShape(Radii.player)).background(Surface)) {
        Row(Modifier.fillMaxWidth().semantics { contentDescription="Abrir reproductor" }.clickable(onClick=expand).padding(start=8.dp),verticalAlignment=Alignment.CenterVertically) {
            Cover(song.artwork,Modifier.size(size).clip(RoundedCornerShape(Radii.tile)),size)
            Column(Modifier.weight(1f).padding(horizontal=12.dp)) {
                Text(song.title,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleSmall)
                Text(song.artist,color=Muted,style=MaterialTheme.typography.labelSmall,maxLines=1,overflow=TextOverflow.Ellipsis)
            }
            ActionIcon(if(state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,if(state.playing) "Pausar" else "Reproducir",action=toggle)
            ActionIcon(Icons.Default.SkipNext,"Siguiente",action=next)
        }
        LinearProgressIndicator(progress={ if(state.duration>0) state.position.toFloat()/state.duration else 0f },Modifier.fillMaxWidth().height(2.dp),color=Green,trackColor=Surface)
    }
}
