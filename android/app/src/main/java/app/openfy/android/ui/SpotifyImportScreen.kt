package app.openfy.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.work.WorkInfo
import app.openfy.android.spotify.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

private const val SpotifyPrivacyUrl = "https://www.spotify.com/account/privacy/"

@Composable
fun SpotifyImportScreen(vm: OpenfyViewModel, onClose: () -> Unit) {
    val app = vm.app
    val context = LocalContext.current
    val browser = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    val workInfos by remember(app) { SpotifyImportWork.observe(app) }.collectAsStateWithLifecycle(initialValue = emptyList())
    var plan by remember { mutableStateOf<SpotifyImportPlan?>(null) }
    var report by remember { mutableStateOf<SpotifyImportReport?>(null) }
    var preview by remember { mutableStateOf<SpotifyLibrary?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val currentPlan = plan
    val currentReport = report
    val selectedFile = preview
    val importWork = currentPlan?.let { current -> workInfos.filter { SpotifyImportWork.matches(current, it) } }.orEmpty()
    val activeWork = importWork.firstOrNull { !it.state.isFinished }
    val groups = remember(currentReport) { currentReport?.takeIf { it.complete }?.let { ImportGroups(it.results) } }
    val disabled = !loaded || busy || activeWork != null

    fun runAction(failure: String, action: suspend () -> Unit) {
        scope.launch {
            error = null
            busy = true
            try {
                action()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                error = failure
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(app) {
        try {
            plan = SpotifyImportWork.plan(app)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            error = "No se pudo recuperar la importación anterior."
        } finally {
            loaded = true
        }
    }
    LaunchedEffect(currentPlan?.id, importWork.map { it.id to it.state }) {
        if (currentPlan == null || activeWork != null) return@LaunchedEffect
        try {
            report = SpotifyImportWork.report(app, currentPlan)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            error = "No se pudo recuperar el resultado. Vuelve a abrir esta pantalla para reintentar."
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runAction("No se pudo leer el archivo. Elígelo de nuevo.") {
            preview = null
            try {
                preview = SpotifyExport.read(context, uri)
            } catch (failure: SpotifyExportException) {
                error = when (failure.reason) {
                    SpotifyExportError.UNSUPPORTED -> "El archivo no contiene canciones guardadas ni playlists de Spotify."
                    SpotifyExportError.TOO_LARGE -> "El archivo supera el límite de tamaño de la importación."
                }
            }
        }
    }

    fun importFile() {
        val library = preview ?: return
        runAction("No se pudo iniciar la importación. Reintenta.") {
            try {
                plan = SpotifyImportWork.start(app, library)
                report = null
                preview = null
                tab = 0
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                val recovered = SpotifyImportWork.plan(app)
                if (recovered?.id != plan?.id) {
                    plan = recovered
                    report = null
                    preview = null
                }
                throw failure
            }
        }
    }

    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { importFile() }
    fun startImport() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            importFile()
        }
    }

    fun review(index: Int, candidate: JsonObject?) {
        val current = plan ?: return
        runAction("No se pudo guardar la decisión. Reintenta.") {
            val decision = SpotifyImportWork.review(app, current, index, candidate)
            if (decision != null) report = report?.let { it.copy(results = it.results + (index to decision)) }
        }
    }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = Ink) {
            Column(Modifier.safeDrawingPadding()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Gutter, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    ActionIcon(Icons.AutoMirrored.Filled.ArrowBack, "Volver", action = onClose)
                    Text("Importar desde Spotify", style = MaterialTheme.typography.headlineMedium)
                }
                LazyColumn(
                    Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(start = Gutter, end = Gutter, top = 12.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    item {
                        ImportInstructions(enabled = !disabled, onPrivacy = {
                            try {
                                browser.openUri(SpotifyPrivacyUrl)
                            } catch (_: IllegalArgumentException) {
                                error = "No se pudo abrir la página de Spotify."
                            }
                        }, onPick = { picker.launch(arrayOf("application/zip", "application/json")) })
                    }
                    if (selectedFile != null) item { ImportPreview(selectedFile, !disabled, ::startImport) }
                    if (busy || !loaded) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                    error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
                    if (selectedFile == null && currentPlan != null) {
                        when {
                            activeWork != null -> item { ImportProgress(activeWork, currentPlan.library.tracks.size) }
                            currentReport?.complete == false -> item {
                                Text("La importación está en pausa. Se conservaron las coincidencias.")
                                OutlinedButton(enabled = !disabled, onClick = {
                                    runAction("No se pudo reanudar la importación. Reintenta.") {
                                        SpotifyImportWork.resume(app, currentPlan)
                                    }
                                }) { Text("Reanudar") }
                            }
                            groups != null -> {
                                item {
                                    Text(currentPlan.library.summary(), color = Muted)
                                    ImportResultTabs(groups, tab, onSelect = { tab = it })
                                    if (groups.omitted > 0) {
                                        Text("Omitidas: ${groups.omitted}", color = Muted, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                                val rows = groups.sections[tab]
                                if (rows.isEmpty()) item { Text(groups.emptyMessage(tab), color = Muted) }
                                items(rows, key = { it.key }) { (index, outcome) ->
                                    val track = currentPlan.library.tracks[index]
                                    ImportResultRow(track, outcome, enabled = !disabled,
                                        onReview = { review(index, it) }, onSearch = {
                                            vm.selectTab(1)
                                            vm.query((listOf(track.title) + track.artists).joinToString(" "), "songs")
                                            onClose()
                                        })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ImportInstructions(enabled: Boolean, onPrivacy: () -> Unit, onPick: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("1. Abre la página de privacidad de Spotify.")
        Text("2. En «Descargar tus datos», solicita «Datos de la cuenta».")
        Text("3. Cuando llegue el correo, descarga el ZIP y elígelo aquí.")
        TextButton(onClick = onPrivacy) { Text("Abrir privacidad de Spotify") }
        OutlinedButton(onClick = onPick, enabled = enabled) { Text("Elegir archivo de Spotify") }
    }
}

@Composable
private fun ImportPreview(library: SpotifyLibrary, enabled: Boolean, onImport: () -> Unit) {
    Surface(color = Raised, shape = RoundedCornerShape(Radii.card)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(library.summary(), style = MaterialTheme.typography.titleSmall)
            if (library.tracks.isEmpty() && library.playlists.isEmpty()) {
                Text("El archivo no contiene canciones ni playlists para importar.", color = Muted)
            } else {
                Button(onClick = onImport, enabled = enabled) { Text("Importar") }
            }
        }
    }
}

@Composable
private fun ImportProgress(work: WorkInfo, total: Int) {
    val processed = work.progress.getInt(SpotifyImportWork.Processed, 0).coerceIn(0, total)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(when {
            work.state == WorkInfo.State.RUNNING -> "Importando canciones"
            work.runAttemptCount > 0 -> "Esperando para reintentar"
            else -> "Esperando para iniciar"
        }, style = MaterialTheme.typography.titleSmall)
        if (total == 0) LinearProgressIndicator(Modifier.fillMaxWidth())
        else LinearProgressIndicator(progress = { processed.toFloat() / total }, modifier = Modifier.fillMaxWidth())
        Text("$processed de $total canciones procesadas", color = Muted)
    }
}

private class ImportGroups(results: Map<Int, SpotifyTrackResult>) {
    private val sorted = results.toSortedMap().entries.toList()
    val sections = listOf(SpotifyTrackStatus.MATCHED, SpotifyTrackStatus.REVIEW, SpotifyTrackStatus.MISSING)
        .map { status -> sorted.filter { it.value.status == status } }
    val omitted = sorted.count { it.value.status == SpotifyTrackStatus.OMITTED }
    fun emptyMessage(tab: Int) = listOf("Aún no hay canciones importadas.", "No hay coincidencias por revisar.", "No quedan canciones sin encontrar.")[tab]
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ImportResultTabs(groups: ImportGroups, selected: Int, onSelect: (Int) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("Importadas", "Por revisar", "No encontradas").forEachIndexed { index, label ->
            FilterChip(selected == index, onClick = { onSelect(index) }, label = { Text("$label · ${groups.sections[index].size}") })
        }
    }
}

@Composable
private fun ImportResultRow(
    track: SpotifyTrack,
    result: SpotifyTrackResult,
    enabled: Boolean,
    onReview: (JsonObject?) -> Unit,
    onSearch: () -> Unit
) {
    Surface(color = Raised, shape = RoundedCornerShape(Radii.row)) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(listOf(track.title, track.artists.joinToString(", ")).filter(String::isNotBlank).joinToString(" – "),
                style = MaterialTheme.typography.titleSmall)
            if (result.status == SpotifyTrackStatus.REVIEW) {
                track.album?.let { Text(it, color = Muted, style = MaterialTheme.typography.bodySmall) }
                result.candidates.forEach { candidate ->
                    OutlinedButton(onClick = { onReview(candidate) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) {
                            Text((candidate["title"] as? JsonPrimitive)?.contentOrNull ?: "Canción de YouTube Music")
                            val artists = (candidate["artists"] as? JsonArray).orEmpty()
                                .mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(", ")
                            val album = (candidate["album"] as? JsonPrimitive)?.contentOrNull
                            val duration = (candidate["duration"] as? JsonPrimitive)?.intOrNull?.takeIf { it > 0 }?.let {
                                "${it / 60}:${(it % 60).toString().padStart(2, '0')}"
                            }
                            val details = listOfNotNull(artists.takeIf(String::isNotBlank), album, duration).joinToString(" · ")
                            if (details.isNotEmpty()) Text(details, color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                TextButton(onClick = { onReview(null) }, enabled = enabled) { Text("Omitir") }
            } else if (result.status == SpotifyTrackStatus.MISSING) {
                TextButton(onClick = onSearch, enabled = enabled) { Text("Buscar manualmente") }
            }
        }
    }
}

private fun SpotifyLibrary.summary(): String {
    val saved = tracks.count { it.saved }
    val songsLabel = if (saved == 1) "canción guardada" else "canciones guardadas"
    val playlistsLabel = if (playlists.size == 1) "playlist" else "playlists"
    return "$saved $songsLabel · ${playlists.size} $playlistsLabel"
}
