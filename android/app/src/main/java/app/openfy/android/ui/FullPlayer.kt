@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package app.openfy.android.ui

import android.content.Context
import android.net.ConnectivityManager
import android.provider.Settings
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.*
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.*
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import app.openfy.android.data.Song
import app.openfy.android.lyrics.LyricsLine
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlin.math.sin

@Composable internal fun FullPlayer(vm: OpenfyViewModel,song: Song,state: PlayerState,library: LibraryState,effects: Boolean,motion: Boolean,dismiss: ()->Unit,actions: ()->Unit) {
    var mode by rememberSaveable { mutableStateOf("Portada") }
    val lyrics by vm.lyrics.collectAsStateWithLifecycle()
    val context=LocalContext.current
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val reduced=Settings.Global.getFloat(context.contentResolver,Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f
    Dialog(onDismissRequest=dismiss,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        Box(Modifier.fillMaxSize().background(Ink)) {
            Ambient(effects && state.playing && !reduced && lifecycleState.isAtLeast(Lifecycle.State.STARTED))
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal=24.dp)) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    ActionIcon(Icons.Default.KeyboardArrowDown,"Cerrar reproductor",action=dismiss)
                    Text("Sonando ahora",Modifier.weight(1f),color=Muted,fontSize=12.sp)
                    ActionIcon(Icons.Default.MoreVert,"Opciones de la canción",action=actions)
                }
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.Center) {
                    listOf("Portada","Letras","Cola").forEach { label -> TextButton(onClick={ mode=label }) { Text(label,color=if(mode==label) Green else Muted) } }
                }
                val content: @Composable ()->Unit = {
                Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) {
                    when(mode) {
                        "Portada" -> MotionCover(vm,song,state.playing,motion && !reduced)
                        "Letras" -> {
                            val row=lyrics
                            if(row==null) CircularProgressIndicator()
                            else {
                                val lines=remember(row.lines) { runCatching { Json { ignoreUnknownKeys=true }.decodeFromString<List<LyricsLine>>(row.lines) }.getOrDefault(emptyList()) }
                                if(lines.isNotEmpty()) TimedLyrics(lines,state.position,vm::seek)
                                else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical=16.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                                    Text(when(row.status) { "instrumental" -> "Instrumental"; "not_found" -> "No encontramos letras para esta canción."; else -> row.plainText },color=TextColor,fontSize=24.sp,lineHeight=34.sp)
                                    if(row.status in setOf("error","not_found")) TextButton(onClick={ vm.loadLyrics(true) }) { Text("Reintentar") }
                                    if(row.source.isNotEmpty()) Text("Fuente: ${row.source}",color=Muted,fontSize=12.sp)
                                }
                            }
                        }
                        "Cola" -> LazyColumn(Modifier.fillMaxSize()) {
                            itemsIndexed(state.queue,key={ index,id -> "$index:$id" }) { index,id ->
                                val row=library.songs.find { it.id==id }
                                Row(Modifier.fillMaxWidth().clickable { vm.jump(index) },verticalAlignment=Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f).padding(vertical=12.dp)) {
                                        Text(row?.title ?: "Canción",color=if(index==state.index) Green else TextColor,maxLines=2)
                                        Text(row?.artist.orEmpty(),color=Muted,fontSize=12.sp)
                                    }
                                    if(index>0) ActionIcon(Icons.Default.ArrowUpward,"Subir en la cola") { vm.moveQueue(index,index-1) }
                                    ActionIcon(Icons.Default.Close,"Quitar de la cola") { vm.removeQueue(index) }
                                }
                            }
                        }
                    }
                }
                }
                val transport: @Composable ()->Unit = {
                Column {
                Row(Modifier.padding(top=16.dp),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(song.title,color=TextColor,fontSize=23.sp,fontWeight=FontWeight.Bold,maxLines=2)
                        Text(song.artist,color=Muted,fontSize=14.sp,maxLines=1)
                    }
                    ActionIcon(if(song.favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,"Favorita",if(song.favorite) Green else TextColor) { vm.favorite(song) }
                }
                var dragging by remember(song.id) { mutableStateOf<Float?>(null) }
                Slider(value=dragging ?: state.position.toFloat().coerceIn(0f,state.duration.toFloat().coerceAtLeast(1f)),
                    onValueChange={ dragging=it },onValueChangeFinished={ dragging?.let { vm.seek(it.toLong()) }; dragging=null },
                    valueRange=0f..state.duration.toFloat().coerceAtLeast(1f))
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) { Text(time(state.position),color=Muted,fontSize=12.sp); Text(time(state.duration),color=Muted,fontSize=12.sp) }
                Row(Modifier.fillMaxWidth().padding(vertical=12.dp),horizontalArrangement=Arrangement.SpaceEvenly,verticalAlignment=Alignment.CenterVertically) {
                    ActionIcon(Icons.Default.Shuffle,"Aleatorio",if(state.shuffle) Green else Muted,vm::shuffle)
                    ActionIcon(Icons.Default.SkipPrevious,"Anterior",action=vm::previous)
                    FilledIconButton(onClick=vm::toggle,modifier=Modifier.size(64.dp)) { Icon(if(state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,if(state.playing) "Pausar" else "Reproducir",Modifier.size(36.dp)) }
                    ActionIcon(Icons.Default.SkipNext,"Siguiente",action=vm::next)
                    ActionIcon(if(state.repeat==Player.REPEAT_MODE_ONE) Icons.Default.RepeatOne else Icons.Default.Repeat,"Repetición",if(state.repeat!=Player.REPEAT_MODE_OFF) Green else Muted,vm::repeat)
                }
                }
                }
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    if(maxWidth>maxHeight*1.2f) Row(Modifier.fillMaxSize(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(24.dp)) {
                        Box(Modifier.weight(1f).fillMaxHeight()) { content() }
                        Box(Modifier.weight(1f)) { transport() }
                    } else Column(Modifier.fillMaxSize()) {
                        Box(Modifier.weight(1f).fillMaxWidth()) { content() }
                        transport()
                    }
                }
            }
        }
    }
}
private fun time(ms: Long)="${ms.coerceAtLeast(0)/60000}:${(ms.coerceAtLeast(0)/1000%60).toString().padStart(2,'0')}"

@Composable private fun TimedLyrics(lines: List<LyricsLine>,position: Long,seek: (Long)->Unit) {
    val list=rememberLazyListState()
    var follow by remember { mutableStateOf(true) }
    val dragged by list.interactionSource.collectIsDraggedAsState()
    val index=lines.indexOfLast { it.time*1000<=position }
    LaunchedEffect(dragged) { if(dragged) follow=false }
    LaunchedEffect(index,follow) { if(follow && index>=0) list.animateScrollToItem((index-1).coerceAtLeast(0)) }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(state=list,contentPadding=PaddingValues(vertical=40.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            itemsIndexed(lines) { at,line ->
                val active=at==index
                val text=if(active && line.words.isNotEmpty()) buildAnnotatedString {
                    line.words.forEach { word -> withStyle(SpanStyle(color=if(word.time*1000<=position) TextColor else Muted)) { append(word.text) } }
                } else AnnotatedString(line.text)
                Text(text,fontSize=28.sp,lineHeight=38.sp,fontWeight=FontWeight.Bold,color=if(active) TextColor else Muted,
                    modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).clickable { seek((line.time*1000).toLong()) })
            }
        }
        if(!follow) FilledTonalButton(onClick={ follow=true },modifier=Modifier.align(Alignment.BottomCenter)) { Text("Seguir reproducción") }
    }
}

@Composable private fun Ambient(animated: Boolean) {
    var phase by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(animated) { if(animated) while(isActive) { delay(34); phase+=.006f } }
    Canvas(Modifier.fillMaxSize()) {
        val x=size.width*(.4f+.2f*sin(phase))
        val y=size.height*(.3f+.15f*sin(phase*.7f))
        drawRect(Brush.radialGradient(listOf(Color(0xff17392c),Ink),center=androidx.compose.ui.geometry.Offset(x,y),radius=size.maxDimension*.8f))
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable private fun MotionCover(vm: OpenfyViewModel,song: Song,playing: Boolean,enabled: Boolean) {
    val context=LocalContext.current
    val lifecycle=LocalLifecycleOwner.current
    val latestPlaying by rememberUpdatedState(playing)
    val repository=remember { MotionRepository(vm.app) }
    var uri by remember(song.id) { mutableStateOf<String?>(null) }
    val unmetered=!(context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered
    LaunchedEffect(song.id,enabled,unmetered) { uri=if(enabled && unmetered) repository.resolve(song) else null }
    Box(Modifier.fillMaxWidth(.9f).aspectRatio(1f,matchHeightConstraintsFirst=true).clip(RoundedCornerShape(18.dp))) {
        Cover(song.artwork,Modifier.matchParentSize())
        uri?.let { address ->
            val video=remember(address) {
                ExoPlayer.Builder(context).build().apply {
                    volume=0f; repeatMode=Player.REPEAT_MODE_ONE
                    setAudioAttributes(AudioAttributes.DEFAULT,false)
                    trackSelectionParameters=trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO,true).setMaxVideoSize(720,720).setMaxVideoFrameRate(30).build()
                    setMediaItem(MediaItem.fromUri(address)); prepare()
                }
            }
            var visible by remember { mutableStateOf(false) }
            DisposableEffect(video,lifecycle) {
                val listener=object : Player.Listener {
                    override fun onRenderedFirstFrame() { visible=true }
                    override fun onPlayerError(error: PlaybackException) { visible=false; video.pause() }
                }
                video.addListener(listener)
                val observer=LifecycleEventObserver { _,event ->
                    if(event==Lifecycle.Event.ON_STOP) video.pause()
                    if(event==Lifecycle.Event.ON_START && latestPlaying) video.play()
                }
                lifecycle.lifecycle.addObserver(observer)
                onDispose { lifecycle.lifecycle.removeObserver(observer); video.removeListener(listener); video.release() }
            }
            LaunchedEffect(video,playing) { video.playWhenReady=playing && lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) }
            AndroidView(factory={ PlayerView(it).apply { useController=false; player=video; setShutterBackgroundColor(android.graphics.Color.TRANSPARENT) } },
                modifier=Modifier.matchParentSize().then(if(visible) Modifier else Modifier.graphicsLayer { alpha=0f }))
        }
    }
}
