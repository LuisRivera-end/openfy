package app.openfy.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.openfy.android.data.Song

@Composable
internal fun MiniPlayer(
    song: Song,
    state: PlayerState,
    toggle: () -> Unit,
    next: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(16.dp),
    startPadding: Dp = 6.dp,
    glassColor: Color? = null,
    expand: () -> Unit
) {
    val context = LocalContext.current
    val reduced = rememberReducedMotion()
    val dominant by produceState<Int?>(null, song.artwork) { value = CoverPalette.dominant(context, song.artwork) }
    val surface by animateColorAsState(Color(CoverPalette.surface(dominant)),
        if (reduced) snap() else tween(300), label = "miniplayer cover tint")
    val size = 44.dp
    val playerBg = glassColor ?: surface
    Box(
        modifier
            .shadow(10.dp, shape)
            .clip(shape)
            // Glass edge, matching the web and Windows pill: a hairline over the cover or page tint.
            .border(0.5.dp, Color.White.copy(alpha = 0.16f), shape)
            .semantics { contentDescription = "Abrir reproductor" }.clickable(role = Role.Button, onClick = expand)
            .playerSwipe(down = false, onSwipe = expand), contentAlignment = Alignment.CenterStart
    ) {
        Box(Modifier.matchParentSize().background(playerBg))
        Row(Modifier.fillMaxWidth().padding(start = startPadding, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Cover(song.artwork, Modifier.size(size).clip(RoundedCornerShape(Radii.tile)), size)
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(song.title, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White,
                    fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
                Text(song.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.7f),
                    fontSize = 12.sp, lineHeight = 16.sp)
            }
            ActionIcon(if (state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                if (state.playing) "Pausar" else "Reproducir", action = toggle)
            ActionIcon(Icons.Default.SkipNext, "Siguiente", action = next)
        }
        MiniProgress(state.duration, Modifier.align(Alignment.BottomCenter).padding(horizontal = 14.dp).fillMaxWidth().height(2.dp).clip(RoundedCornerShape(1.dp)))
    }
}

@Composable
private fun MiniProgress(duration: Long, modifier: Modifier) {
    val vm: OpenfyViewModel = viewModel()
    val position = vm.position.collectAsStateWithLifecycle()
    Canvas(modifier) {
        val fraction = if (duration > 0) (position.value.toFloat() / duration).coerceIn(0f, 1f) else 0f
        val progress = size.width * fraction
        val from = if (layoutDirection == LayoutDirection.Rtl) size.width - progress else 0f
        drawRect(Color.White.copy(alpha = 0.2f))
        drawRect(Color.White, topLeft = Offset(from, 0f), size = Size(progress, size.height))
    }
}
