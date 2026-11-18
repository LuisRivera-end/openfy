@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.openfy.android.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
import app.openfy.android.data.Song
import app.openfy.android.lyrics.LyricsLine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.roundToLong

private val playerModes = listOf("Portada", "Letras", "Cola")
private val secondaryPlayerText = Color.White.copy(alpha = 0.7f)
private val activeLyricsColor = Color(0xfff4f4f5)
private val lyricsJson = Json { ignoreUnknownKeys = true }

@Composable
internal fun FullPlayer(
    vm: OpenfyViewModel,
    song: Song,
    state: PlayerState,
    library: LibraryState,
    effects: Boolean,
    motion: Boolean,
    dismiss: () -> Unit,
    actions: () -> Unit,
    contextTitle: String? = null,
    upcomingIndices: List<Int>? = null,
    queueOccurrenceKeys: List<String>? = null
) {
    var mode by rememberSaveable { mutableStateOf("Portada") }
    Dialog(dismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        ExpandedMotionArtworkScope {
            Box(Modifier.fillMaxSize().background(Ink)) {
                AmbientBackground(song.artwork, state.playing, Modifier.matchParentSize(), enabled = effects)
                if (mode == "Letras") {
                    Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = AMBIENT.lyricsScrim.toFloat())))
                }
                Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 24.dp)) {
                    PlayerHeader(contextTitle, dismiss, actions)
                    ModeSelector(mode, onSelect = { mode = it }, Modifier.align(Alignment.CenterHorizontally))
                    Spacer(Modifier.height(12.dp))
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                        val wide = maxWidth > maxHeight * 1.2f
                        val content: @Composable (Modifier) -> Unit = { modifier ->
                            when (mode) {
                                "Portada" -> PlayerArtwork(song, state.playing, effects && motion, dismiss, modifier,
                                    if (wide) Alignment.Center else Alignment.BottomCenter)
                                "Letras" -> PlayerLyrics(vm, song.id, modifier)
                                "Cola" -> PlayerQueue(vm, song, state, library, upcomingIndices, queueOccurrenceKeys, modifier)
                            }
                        }
                        if (wide) {
                            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                                content(Modifier.weight(1f).fillMaxHeight())
                                PlayerControls(vm, song, state, Modifier.weight(1f))
                            }
                        } else {
                            Column(Modifier.fillMaxSize()) {
                                content(Modifier.weight(1f).fillMaxWidth())
                                Spacer(Modifier.height(if (mode == "Portada") 24.dp else 10.dp))
                                PlayerControls(vm, song, state)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayerHeader(context: String?, dismiss: () -> Unit, actions: () -> Unit) {
    Row(Modifier.fillMaxWidth().playerSwipe(down = true, onSwipe = dismiss), verticalAlignment = Alignment.CenterVertically) {
        ActionIcon(Icons.Default.KeyboardArrowDown, "Cerrar reproductor", action = dismiss)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Sonando ahora", color = Muted, fontSize = 11.sp, lineHeight = 14.sp)
            if (!context.isNullOrBlank()) {
                Text(context, color = TextColor, fontSize = 13.sp, lineHeight = 17.sp,
                    fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        ActionIcon(Icons.Default.MoreVert, "Opciones de la canción", action = actions)
    }
}

@Composable
private fun ModeSelector(mode: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.selectableGroup().clip(CircleShape).background(Color.White.copy(alpha = 0.12f)).padding(3.dp),
        verticalAlignment = Alignment.CenterVertically) {
        for (label in playerModes) {
            val selected = mode == label
            Box(
                Modifier.widthIn(min = 70.dp).heightIn(min = 36.dp).clip(CircleShape)
                    .background(if (selected) Color.White.copy(alpha = 0.2f) else Color.Transparent)
                    .selectable(selected = selected, role = Role.Tab, onClick = { onSelect(label) })
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(label, color = if (selected) Color.White else secondaryPlayerText,
                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun PlayerArtwork(song: Song, playing: Boolean, motion: Boolean, dismiss: () -> Unit, modifier: Modifier, alignment: Alignment) {
    val reduced = rememberReducedMotion()
    val scale by animateFloatAsState(if (playing || reduced) 1f else 0.92f,
        if (reduced) snap() else tween(300), label = "player artwork scale")
    val shape = RoundedCornerShape(Radii.player)
    val shadow = Color.Black.copy(alpha = 0.5f)
    val mainArtist = remember(song.metadata, song.artist) {
        runCatching {
            Json.parseToJsonElement(song.metadata).jsonObject["artists"]?.jsonArray?.firstOrNull()
                ?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)
        }.getOrNull() ?: song.artist
    }
    BoxWithConstraints(modifier, contentAlignment = alignment) {
        val side = minOf(maxWidth, maxHeight)
        val artwork = Modifier.size(side).playerSwipe(down = true, onSwipe = dismiss)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                if (alignment == Alignment.BottomCenter) translationY = size.height * (1f - scale) / 2f
            }
            .shadow(24.dp, shape, ambientColor = shadow, spotColor = shadow)
        if (motion && !reduced) MotionArtwork(mainArtist, song.album, song.artwork, playing, artwork, shape)
        else Cover(song.artwork, artwork.clip(shape), sizePx = 1024)
    }
}

@Composable
private fun PlayerControls(vm: OpenfyViewModel, song: Song, state: PlayerState, modifier: Modifier = Modifier) {
    val reduced = rememberReducedMotion()
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                val marquee = if (reduced) Modifier else Modifier.basicMarquee()
                Text(song.title, Modifier.fillMaxWidth().then(marquee), color = TextColor, fontSize = 22.sp,
                    lineHeight = 27.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(song.artist, color = secondaryPlayerText, fontSize = 15.sp, lineHeight = 21.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            ActionIcon(if (song.favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder, "Favorita",
                if (song.favorite) Green else TextColor) { vm.favorite(song) }
        }
        PlayerProgress(vm, song.id, state.duration)
        Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 12.dp), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            TransportMode(Icons.Default.Shuffle, "Aleatorio", state.shuffle, vm::shuffle)
            TransportSkip(Icons.Default.SkipPrevious, "Anterior", vm::previous)
            FilledIconButton(onClick = vm::toggle, modifier = Modifier.size(72.dp), shape = CircleShape,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White, contentColor = Color.Black)) {
                Icon(if (state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                    if (state.playing) "Pausar" else "Reproducir", Modifier.size(38.dp))
            }
            TransportSkip(Icons.Default.SkipNext, "Siguiente", vm::next)
            TransportMode(if (state.repeat == Player.REPEAT_MODE_ONE) Icons.Default.RepeatOne else Icons.Default.Repeat,
                "Repetición", state.repeat != Player.REPEAT_MODE_OFF, vm::repeat)
        }
    }
}

@Composable
private fun TransportSkip(icon: ImageVector, label: String, action: () -> Unit) {
    IconButton(onClick = action, modifier = Modifier.size(48.dp)) {
        Icon(icon, label, Modifier.size(40.dp), tint = Color.White)
    }
}

@Composable
private fun TransportMode(icon: ImageVector, label: String, active: Boolean, action: () -> Unit) {
    IconButton(onClick = action, modifier = Modifier.size(48.dp).semantics {
        stateDescription = if (active) "Activado" else "Desactivado"
    }) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Icon(icon, label, Modifier.size(24.dp), tint = if (active) Green else Color.White)
            if (active) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp).size(4.dp).background(Green, CircleShape))
        }
    }
}

@Composable
private fun PlayerProgress(vm: OpenfyViewModel, songId: String, duration: Long) {
    val position by vm.position.collectAsStateWithLifecycle()
    val end = duration.coerceAtLeast(1L).toFloat()
    var provisional by remember(songId) { mutableStateOf<Float?>(null) }
    val shown = (provisional ?: position.toFloat()).coerceIn(0f, end)
    val interaction = remember { MutableInteractionSource() }
    val dragged by interaction.collectIsDraggedAsState()
    var focused by remember { mutableStateOf(false) }
    val engaged = duration > 0 && (dragged || focused)
    Column {
        Slider(value = shown, onValueChange = { provisional = it }, onValueChangeFinished = {
            provisional?.let { vm.seek(it.roundToLong()) }
            provisional = null
        }, valueRange = 0f..end, enabled = duration > 0, interactionSource = interaction,
            modifier = Modifier.fillMaxWidth().height(48.dp).onFocusChanged { focused = it.isFocused }
                .semantics { contentDescription = "Posición de reproducción" },
            thumb = {
                Box(Modifier.size(12.dp).then(if (engaged) Modifier.background(Color.White, CircleShape) else Modifier))
            },
            track = {
                Canvas(Modifier.fillMaxWidth().height(8.dp)) {
                    val thickness = (if (dragged) 8.dp else 3.dp).toPx()
                    val top = (size.height - thickness) / 2f
                    val corner = CornerRadius(thickness / 2f)
                    val marker = size.width * (shown / end)
                    val from = if (layoutDirection == LayoutDirection.Rtl) size.width - marker else 0f
                    drawRoundRect(Color.White.copy(alpha = 0.22f), Offset(0f, top), Size(size.width, thickness), corner)
                    if (marker > 0f) drawRoundRect(Color.White, Offset(from, top), Size(marker, thickness), corner)
                }
            })
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            val color = Color.White.copy(alpha = 0.6f)
            Text(playerTime(shown.roundToLong()), color = color, fontSize = 11.sp, lineHeight = 14.sp)
            Text(playerTime(duration), color = color, fontSize = 11.sp, lineHeight = 14.sp)
        }
    }
}

private fun playerTime(ms: Long): String {
    val seconds = ms.coerceAtLeast(0) / 1000
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}

@Composable
private fun PlayerLyrics(vm: OpenfyViewModel, songId: String, modifier: Modifier) {
    val row by vm.lyrics.collectAsStateWithLifecycle()
    Box(modifier, contentAlignment = Alignment.Center) {
        val lyrics = row
        if (lyrics == null) {
            CircularProgressIndicator()
        } else {
            val lines = remember(lyrics.lines) {
                runCatching { lyricsJson.decodeFromString<List<LyricsLine>>(lyrics.lines) }.getOrDefault(emptyList())
            }
            if (lines.isNotEmpty()) {
                key(songId) { TimedLyrics(vm, lines) }
            } else {
                Column(Modifier.fillMaxSize().lyricEdges().verticalScroll(rememberScrollState()).padding(vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    val text = when (lyrics.status) {
                        "instrumental" -> "Instrumental"
                        "not_found" -> "No encontramos letras para esta canción."
                        else -> lyrics.plainText
                    }
                    Text(text, color = activeLyricsColor, fontSize = 26.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold)
                    if (lyrics.status == "error" || lyrics.status == "not_found") {
                        TextButton(onClick = { vm.loadLyrics(true) }) { Text("Reintentar") }
                    }
                    if (lyrics.source.isNotEmpty()) Text("Fuente: ${lyrics.source}", color = Muted, fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
private fun TimedLyrics(vm: OpenfyViewModel, lines: List<LyricsLine>) {
    val position = vm.position.collectAsStateWithLifecycle()
    val active by remember(lines) {
        derivedStateOf { lines.indexOfLast { it.time * 1000 <= position.value } }
    }
    val list = rememberLazyListState()
    var follow by remember { mutableStateOf(true) }
    val dragged by list.interactionSource.collectIsDraggedAsState()
    val reduced = rememberReducedMotion()
    LaunchedEffect(dragged) { if (dragged) follow = false }
    LaunchedEffect(active, follow, reduced) {
        if (follow && active >= 0) {
            if (reduced) list.scrollToItem(active) else list.animateScrollToItem(active)
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val anchor = maxHeight / 3f
        LazyColumn(
            Modifier.fillMaxSize().lyricEdges(),
            state = list,
            contentPadding = PaddingValues(top = anchor, bottom = (maxHeight - anchor - 34.dp).coerceAtLeast(16.dp)),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            itemsIndexed(lines) { index, line -> LyricVerse(line, index == active, position, vm::seek) }
        }
        if (!follow) {
            FilledTonalButton(onClick = { follow = true }, modifier = Modifier.align(Alignment.BottomCenter)) {
                Text("Seguir reproducción")
            }
        }
    }
}

@Composable
private fun LyricVerse(line: LyricsLine, active: Boolean, position: State<Long>, seek: (Long) -> Unit) {
    val modifier = Modifier.fillMaxWidth().clickable { seek((line.time * 1000).toLong()) }
    val style = LocalTextStyle.current.copy(fontSize = 26.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold)
    if (active && line.words.isNotEmpty()) {
        val at = position.value
        val text = buildAnnotatedString {
            for (word in line.words) {
                withStyle(SpanStyle(color = if (word.time * 1000 <= at) activeLyricsColor else Muted)) { append(word.text) }
            }
        }
        Text(text, modifier, style = style)
    } else {
        Text(line.text, modifier, color = if (active) activeLyricsColor else Muted, style = style)
    }
}

private fun Modifier.lyricEdges(): Modifier = graphicsLayer {
    compositingStrategy = CompositingStrategy.Offscreen
}.drawWithContent {
    drawContent()
    if (size.height > 0f) {
        val fade = (16.dp.toPx() / size.height).coerceAtMost(0.5f)
        drawRect(Brush.verticalGradient(0f to Color.Transparent, fade to Color.White,
            1f - fade to Color.White, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
    }
}

private data class QueueOccurrence(val index: Int, val id: String, val key: String)

@Composable
private fun PlayerQueue(
    vm: OpenfyViewModel,
    song: Song,
    state: PlayerState,
    library: LibraryState,
    upcomingIndices: List<Int>?,
    occurrenceKeys: List<String>?,
    modifier: Modifier
) {
    val rows = remember(state.queue, occurrenceKeys) {
        val counts = mutableMapOf<String, Int>()
        state.queue.mapIndexed { index, id ->
            val occurrence = counts.getOrDefault(id, 0)
            counts[id] = occurrence + 1
            QueueOccurrence(index, id, occurrenceKeys?.getOrNull(index) ?: "$id#$occurrence")
        }
    }
    val upcoming = remember(rows, state.index, state.shuffle, upcomingIndices) {
        val indices = upcomingIndices.takeIf { state.shuffle } ?: ((state.index + 1) until rows.size).toList()
        indices.distinct().filter { it != state.index }.mapNotNull { rows.getOrNull(it) }
    }
    val songs = remember(library.songs) { library.songs.associateBy { it.id } }
    val current = rows.getOrNull(state.index)
    val displayed = listOfNotNull(current) + upcoming
    LazyColumn(modifier.fillMaxWidth()) {
        if (current != null) {
            item("now-heading") { QueueHeading("Ahora suena") }
            item(current.key, contentType = "track") { QueueRow(vm, current, song, displayed, active = true) }
        }
        item("next-heading") { QueueHeading("A continuación") }
        items(upcoming, key = { it.key }, contentType = { "track" }) { row ->
            QueueRow(vm, row, songs[row.id], displayed, active = false)
        }
    }
}

@Composable
private fun QueueHeading(text: String) {
    Text(text, Modifier.padding(top = 12.dp, bottom = 4.dp),
        color = Muted, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun QueueRow(vm: OpenfyViewModel, row: QueueOccurrence, song: Song?, displayed: List<QueueOccurrence>, active: Boolean) {
    var menu by remember { mutableStateOf(false) }
    val at = displayed.indexOf(row)
    val previous = displayed.getOrNull(at - 1)
    val next = displayed.getOrNull(at + 1)
    Row(Modifier.fillMaxWidth().height(56.dp).clickable { vm.jump(row.index) }, verticalAlignment = Alignment.CenterVertically) {
        Cover(song?.artwork, Modifier.size(36.dp).clip(RoundedCornerShape(Radii.tile)), 36.dp)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(song?.title ?: "Canción", color = if (active) Green else TextColor, fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(song?.artist.orEmpty(), color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box {
            ActionIcon(Icons.Default.MoreVert, "Opciones de la pista") { menu = true }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Subir") }, enabled = previous != null, onClick = {
                    menu = false
                    previous?.let { vm.moveQueue(row.index, it.index) }
                })
                DropdownMenuItem(text = { Text("Bajar") }, enabled = next != null, onClick = {
                    menu = false
                    next?.let { vm.moveQueue(row.index, it.index) }
                })
                DropdownMenuItem(text = { Text("Quitar de la cola") }, onClick = {
                    menu = false
                    vm.removeQueue(row.index)
                })
            }
        }
    }
}

@Composable
internal fun Modifier.playerSwipe(down: Boolean, onSwipe: () -> Unit): Modifier {
    val latestSwipe by rememberUpdatedState(onSwipe)
    return pointerInput(down) {
        var distance = 0f
        detectVerticalDragGestures(
            onDragStart = { distance = 0f },
            onVerticalDrag = { change, amount ->
                change.consume()
                distance += amount
            },
            onDragEnd = {
                val signed = if (down) distance else -distance
                if (signed >= 60.dp.toPx()) latestSwipe()
            }
        )
    }
}
