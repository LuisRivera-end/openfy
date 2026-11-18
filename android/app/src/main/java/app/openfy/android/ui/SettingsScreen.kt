package app.openfy.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import app.openfy.android.BuildConfig
import app.openfy.android.preferences
import app.openfy.android.updates.UpdateState

internal val Effects=booleanPreferencesKey("effects")
internal val Motion=booleanPreferencesKey("motionArt")

@Composable internal fun SettingsScreen(vm: OpenfyViewModel,update: UpdateState,status: String,linked: Boolean,origin: String,
    effects: Boolean,motion: Boolean,dismiss: ()->Unit,importFiles: ()->Unit,importFolder: ()->Unit,notice: String?) {
    val context=LocalContext.current
    var address by rememberSaveable { mutableStateOf(origin) }
    var code by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var licenses by remember { mutableStateOf(false) }
    val typography=MaterialTheme.typography
    Dialog(onDismissRequest=dismiss,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxSize(),color=Ink) {
            Column(Modifier.safeDrawingPadding().padding(Gutter).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) { ActionIcon(Icons.Default.ArrowBack,"Volver",action=dismiss); Text("Ajustes",style=typography.headlineMedium) }
                Text("Openfy ${BuildConfig.VERSION_NAME} · ${BuildConfig.VERSION_CODE}",color=Muted,style=typography.bodyMedium)
                SectionTitle("Actualizaciones de GitHub")
                Text(update.message,color=Muted,style=typography.bodyMedium)
                update.progress?.let { LinearProgressIndicator(progress={ it/100f },modifier=Modifier.fillMaxWidth()); Text("$it %",color=Muted,style=typography.bodySmall) }
                OutlinedButton(onClick={ vm.run { vm.app.updates.check() } },enabled=!update.busy) { Text("Buscar actualizaciones") }
                if(update.release!=null) {
                    if(update.ready) Button(onClick={ vm.run { vm.app.updates.install(context) } },enabled=!update.busy) { Text("Instalar actualización") }
                    else Button(onClick={ vm.run { vm.app.updates.download() } },enabled=!update.busy) { Text("Descargar APK") }
                    Text("Android pedirá confirmar la instalación. Se conservan tu biblioteca y descargas.",color=Muted,style=typography.bodySmall)
                }
                SectionTitle("Tu música")
                Text("El teléfono mantiene su biblioteca, descargas e historial.",color=Muted,style=typography.bodyMedium)
                OutlinedButton(onClick=importFiles) { Text("Importar archivos") }
                OutlinedButton(onClick=importFolder) { Text("Importar carpeta") }
                SectionTitle("Apariencia")
                Row(verticalAlignment=Alignment.CenterVertically) { Text("Movimiento ambiental",Modifier.weight(1f),style=typography.bodyMedium); Switch(effects,{ vm.run { vm.app.preferences.edit { prefs -> prefs[Effects]=it } } }) }
                Row(verticalAlignment=Alignment.CenterVertically) { Text("Portadas animadas con Wi-Fi",Modifier.weight(1f),style=typography.bodyMedium); Switch(motion,{ vm.run { vm.app.preferences.edit { prefs -> prefs[Motion]=it } } }) }
                SectionTitle("Vincular con Windows")
                Text("Comparte favoritos y playlists de YouTube. Abre Ajustes → Android en el PC para obtener un código.",color=Muted,style=typography.bodyMedium)
                Text(status,color=Green,style=typography.bodyMedium)
                if(linked) {
                    Text(origin,color=Muted,style=typography.bodyMedium)
                    Button(onClick={ vm.run { busy=true; try { vm.app.sync.exchange() } finally { busy=false } } },enabled=!busy) { Text("Sincronizar ahora") }
                    TextButton(onClick={ vm.app.sync.unlink() }) { Text("Desvincular este teléfono") }
                } else {
                    OutlinedTextField(address,{ address=it },Modifier.fillMaxWidth(),label={ Text("https://tu-pc.tu-red.ts.net") },singleLine=true)
                    OutlinedTextField(code,{ code=it },Modifier.fillMaxWidth(),label={ Text("Código de Windows") },singleLine=true)
                    Button(onClick={ vm.run { busy=true; try { vm.app.sync.pair(address,code); code="" } finally { busy=false } } },enabled=!busy && address.isNotBlank() && code.isNotBlank()) { Text(if(busy) "Vinculando…" else "Vincular") }
                }
                notice?.let { Text(it,color=Muted,style=typography.bodyMedium) }
                SectionTitle("Almacenamiento")
                Text("Las descargas se conservan hasta que las elimines. Android puede pausar los trabajos en segundo plano; se reanudan al permitirlo el sistema.",color=Muted,style=typography.bodyMedium)
                Text("YouTube.js · QuickJS-KT · AndroidX Media3",style=typography.bodySmall,color=Muted)
                TextButton(onClick={ licenses=true }) { Text("Licencias de código abierto") }
            }
        }
    }
    if(licenses) AlertDialog(onDismissRequest={ licenses=false },title={ Text("Licencias") },text={
        val text=remember { vm.app.assets.open("provider/NOTICE.txt").bufferedReader().use { it.readText() } }
        Text(text,Modifier.heightIn(max=440.dp).verticalScroll(rememberScrollState()),style=typography.bodySmall)
    },confirmButton={ TextButton(onClick={ licenses=false }) { Text("Cerrar") } })
}
