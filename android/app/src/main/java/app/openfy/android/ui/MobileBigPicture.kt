package app.openfy.android.ui

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.view.WindowManager
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.lerp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import app.openfy.android.data.Song
import app.openfy.android.lyrics.LyricsLine
import kotlinx.coroutines.delay

internal data class MobilePictureMode(
    val available: Boolean,
    val active: Boolean,
    val enter: () -> Unit,
    val leave: () -> Unit
)

@Composable
internal fun rememberMobilePicture(): MobilePictureMode {
    val activity = LocalActivity.current
    val configuration = LocalConfiguration.current
    val available = activity != null && !activity.isInMultiWindowMode && configuration.smallestScreenWidthDp in 1..599
    val landscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    var previousOrientation by rememberSaveable { mutableStateOf<Int?>(null) }
    var dismissed by rememberSaveable { mutableStateOf(false) }
    val active = available && (previousOrientation != null || landscape && !dismissed)

    fun restoreOrientation() {
        previousOrientation?.let { activity?.requestedOrientation = it }
        previousOrientation = null
    }
    LaunchedEffect(landscape) { if (!landscape) dismissed = false }
    LaunchedEffect(available) { if (!available) restoreOrientation() }
    DisposableEffect(activity) {
        onDispose { if (activity?.isChangingConfigurations == false) restoreOrientation() }
    }
    return MobilePictureMode(
        available, active,
        enter = {
            if (available && previousOrientation == null) {
                previousOrientation = activity.requestedOrientation
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            }
        },
        leave = {
            dismissed = landscape
            restoreOrientation()
        }
    )
}

@Composable
internal fun MobilePictureWindow(playing: Boolean) {
    val window = (LocalView.current.parent as? DialogWindowProvider)?.window ?: return
    val resumed = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value == Lifecycle.State.RESUMED
    DisposableEffect(window) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        val previousBehavior = controller.systemBarsBehavior
        val bars = WindowInsetsCompat.Type.systemBars()
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(bars)
        onDispose {
            controller.show(bars)
            controller.systemBarsBehavior = previousBehavior
        }
    }
    DisposableEffect(window, playing, resumed) {
        val flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        val alreadySet = window.attributes.flags and flag != 0
        if (playing && resumed) window.addFlags(flag)
        onDispose { if (!alreadySet) window.clearFlags(flag) }
    }
}

private const val IdleMillis = 4_000L
private const val PreviewMillis = 10_000L
private const val TransitionMillis = 1_200
private const val CompactMillis = 320

private data class Occurrence(val index: Int, val id: String)
private data class Preview(val occurrence: Occurrence, val song: Song)
private data class PictureReveal(val song: Song, val from: Rect, val to: Rect)

@Composable
internal fun MobileBigPicture(
    vm: OpenfyViewModel,
    song: Song,
    state: PlayerState,
    library: LibraryState,
    effects: Boolean,
    motion: Boolean,
    overlayOpen: Boolean,
    exit: () -> Unit,
    actions: () -> Unit,
    queue: () -> Unit
) {
    val reduced = rememberReducedMotion()
    val animate = effects && !reduced
    val resumed = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value == Lifecycle.State.RESUMED
    var idle by remember { mutableStateOf(false) }
    var pressed by remember { mutableStateOf(false) }
    var lastKey by remember { mutableIntStateOf(0) }
    LaunchedEffect(resumed, overlayOpen, pressed, lastKey) {
        idle = false
        if (resumed && !overlayOpen && !pressed) {
            delay(IdleMillis)
            idle = true
        }
    }
    val scale by animateFloatAsState(if (idle) 1.08f else 1f,
        if (animate) tween(CompactMillis) else snap(), label = "Big Picture artwork")

    val position by vm.position.collectAsStateWithLifecycle()
    val remaining = (state.duration - position).takeIf { state.duration > 0 && it in 0..PreviewMillis }
    val occurrence = Occurrence(state.index, song.id)
    val nextSong = remember(state.nextIndex, state.queue, library.songs) {
        val id = state.nextIndex?.let(state.queue::getOrNull)
        library.songs.firstOrNull { it.id == id }
    }
    val next = if (remaining != null && nextSong != null && !state.failed)
        Preview(Occurrence(state.nextIndex!!, nextSong.id), nextSong) else null
    var displayed by remember { mutableStateOf(song) }
    var displayedOccurrence by remember { mutableStateOf(occurrence) }
    var announced by remember { mutableStateOf<Preview?>(null) }
    var previewCover by remember { mutableStateOf<Rect?>(null) }
    var artwork by remember { mutableStateOf<Rect?>(null) }
    var reveal by remember { mutableStateOf<PictureReveal?>(null) }
    val progress = remember { Animatable(0f) }
    SideEffect {
        if (displayedOccurrence == occurrence) {
            displayed = song
            announced = next
        }
    }
    LaunchedEffect(occurrence, state.playing, state.buffering, state.failed, animate, resumed) {
        if (displayedOccurrence == occurrence) return@LaunchedEffect
        val match = announced?.takeIf { it.occurrence == occurrence }
        if (match != null && animate && resumed && state.buffering && !state.failed) return@LaunchedEffect
        val from = previewCover
        val to = artwork
        if (match != null && animate && resumed && state.playing && !state.failed && from != null && to != null) {
            progress.snapTo(0f)
            reveal = PictureReveal(match.song, from, to)
            progress.animateTo(1f, tween(TransitionMillis))
        }
        displayed = song
        displayedOccurrence = occurrence
        announced = null
        reveal = null
    }
    val card = if (displayedOccurrence == occurrence) next else announced

    val row by vm.lyrics.collectAsStateWithLifecycle()
    var lines by remember { mutableStateOf<List<LyricsLine>?>(null) }
    var lyricsSong by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(row, displayedOccurrence) {
        val lyrics = row?.takeIf { it.id == displayedOccurrence.id } ?: return@LaunchedEffect
        lines = if (lyrics.status == "synced") decodePlayerLyrics(lyrics.lines) else emptyList()
        lyricsSong = lyrics.id
    }

    Box(Modifier.fillMaxSize().background(Ink)
        .semantics { testTag = "mobile-big-picture" }
        .onPreviewKeyEvent { lastKey++; false }
        .pointerInput(Unit) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                pressed = true
                idle = false
                do { val event = awaitPointerEvent(PointerEventPass.Initial) } while (event.changes.any { it.pressed })
                pressed = false
            }
        }) {
        AmbientBackground(reveal?.song?.artwork ?: displayed.artwork, state.playing,
            Modifier.matchParentSize(), enabled = effects)
        val safe = WindowInsets.displayCutout.union(WindowInsets.mandatorySystemGestures)
        Column(Modifier.fillMaxSize().windowInsetsPadding(safe).padding(horizontal = 20.dp, vertical = 4.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                ActionIcon(Icons.Default.FullscreenExit, "Salir de Big Picture", action = exit)
                Row {
                    ActionIcon(Icons.AutoMirrored.Filled.QueueMusic, "Cola de reproducción", action = queue)
                    ActionIcon(Icons.Default.MoreVert, "Opciones de la canción", action = actions)
                }
            }
            val synced = lines
            val split = synced == null || synced.isNotEmpty()
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterHorizontally)) {
                Column(Modifier.weight(1f, fill = split).widthIn(max = 290.dp).fillMaxHeight(),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    PlayerArtwork(displayed, state.playing, animate && motion, dismiss = null,
                        Modifier.weight(1f).fillMaxWidth().graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            transformOrigin = TransformOrigin(.5f, 1f)
                            alpha = if (reveal == null) 1f else 0f
                        }, Alignment.Center, reduced, onArtworkPositioned = { artwork = it })
                    Spacer(Modifier.height(16.dp))
                    PlayerMetadata(vm, displayed, reduced, compact = true)
                    if (idle) PictureProgress(position, state.duration)
                }
                if (split) Box(Modifier.weight(1.2f).fillMaxHeight().padding(bottom = if (card != null && !idle) 76.dp else 0.dp)) {
                    if (synced != null && lyricsSong == displayedOccurrence.id) key(lyricsSong) {
                        TimedLyrics(vm, synced, reduced, compact = true)
                    }
                }
            }
            val dockHeight by animateDpAsState(
                if (!idle) 91.dp else if (card == null) 24.dp else 58.dp,
                if (animate) tween(CompactMillis) else snap(),
                label = "Big Picture controls"
            )
            Box(Modifier.fillMaxWidth().height(dockHeight).clipToBounds(), contentAlignment = Alignment.Center) {
                if (!idle) Box(Modifier.widthIn(max = 500.dp)) { PlayerTransport(vm, song, state, compact = true) }
            }
        }
        if (card != null && reveal == null) {
            val countdown = when {
                state.buffering || remaining == null || remaining == 0L -> "Preparando reproducción…"
                !state.playing -> "En pausa · ${(remaining + 999) / 1000} s"
                else -> "Empieza en ${(remaining + 999) / 1000} s"
            }
            val bottom by animateDpAsState(if (idle) 8.dp else 95.dp,
                if (animate) tween(CompactMillis) else snap(), label = "Big Picture next card")
            Box(Modifier.align(Alignment.BottomEnd).windowInsetsPadding(safe).padding(end = 20.dp, bottom = bottom)) {
                PictureNextCard(card.song, countdown, idle, animate) { previewCover = it }
            }
        }
        reveal?.let { transition ->
            val density = LocalDensity.current
            val bounds = lerp(transition.from, transition.to, progress.value)
            Cover(transition.song.artwork, with(density) {
                Modifier.offset(bounds.left.toDp(), bounds.top.toDp()).size(bounds.width.toDp(), bounds.height.toDp())
            }.clip(RoundedCornerShape(Radii.player)), sizePx = 1024)
        }
    }
}

@Composable
private fun PictureProgress(position: Long, duration: Long) {
    val fraction = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f
    Column(Modifier.fillMaxWidth().padding(top = 4.dp)) {
        Box(Modifier.fillMaxWidth().height(2.dp).background(Color.White.copy(alpha = .22f))) {
            Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(Color.White))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(playerTime(position), color = PlayerSecondaryText, fontSize = 11.sp)
            Text(playerTime(duration), color = PlayerSecondaryText, fontSize = 11.sp)
        }
    }
}

@Composable
private fun PictureNextCard(song: Song, countdown: String, idle: Boolean, animate: Boolean, position: (Rect) -> Unit) {
    val cardShape = RoundedCornerShape(12.dp)
    val width by animateDpAsState(if (idle) 220.dp else 194.dp,
        if (animate) tween(CompactMillis) else snap(), label = "Big Picture next card width")
    Box(Modifier.width(width).height(if (idle) 72.dp else 68.dp).clip(cardShape).background(Ink)) {
        AmbientBackground(song.artwork, playing = false, Modifier.matchParentSize(), enabled = false, playerBands = false)
        Row(Modifier.fillMaxSize().padding(8.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Cover(song.artwork, Modifier.size(if (idle) 48.dp else 42.dp).clip(RoundedCornerShape(6.dp))
                .onGloballyPositioned { position(it.boundsInRoot()) }, sizePx = 128)
            Column(Modifier.weight(1f)) {
                Text("A continuación", color = PlayerSecondaryText, fontSize = 10.sp, lineHeight = 12.sp)
                Text(song.title, Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    color = TextColor, fontSize = 13.sp, lineHeight = 15.sp,
                    fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(song.artist, color = PlayerSecondaryText, fontSize = 10.sp, lineHeight = 11.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(countdown, Modifier.weight(1f), color = PlayerSecondaryText, fontSize = 10.sp, lineHeight = 11.sp, maxLines = 1)
                    if (song.duration > 0) Text(playerTime(song.duration), color = PlayerSecondaryText, fontSize = 10.sp, lineHeight = 11.sp)
                }
            }
        }
    }
}
