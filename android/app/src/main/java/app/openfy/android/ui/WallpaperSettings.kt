package app.openfy.android.ui

import android.app.WallpaperManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.openfy.android.OpenfyWallpaperService
import app.openfy.android.WallpaperScene

/** Ajustes → «Fondo animado de Openfy»: a preview of the wallpaper and the way into the system picker. */
@Composable
internal fun LiveWallpaperSettings(vm: OpenfyViewModel, effects: Boolean) {
    val context = LocalContext.current
    val typography = MaterialTheme.typography
    val player by vm.player.collectAsStateWithLifecycle()
    val library by vm.library.collectAsStateWithLifecycle()
    val song = remember(player.id, library.songs) { library.songs.find { it.id == player.id } }
    val supported = remember(context) { context.packageManager.hasSystemFeature(PackageManager.FEATURE_LIVE_WALLPAPER) }
    var status by remember { mutableStateOf(LiveWallpaperStatus.INACTIVE) }
    var failed by remember { mutableStateOf(false) }
    // The picker is another app; read the state again whenever Settings comes back.
    LifecycleResumeEffect(context) {
        status = liveWallpaperStatus(context)
        onPauseOrDispose {}
    }

    SectionTitle("Fondo animado de Openfy")
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        WallpaperPreview(song?.artwork, player.playing, effects)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("En el bloqueo, la portada de lo que suena con la iluminación del reproductor y, si ya está guardada, su portada animada. En el inicio se ve atenuada.",
                color = Muted, style = typography.bodyMedium)
            Text("Solo se mueve con música sonando. En pausa queda una imagen fija y no descarga nada por su cuenta.",
                color = Muted, style = typography.bodySmall)
            Text(status.label, color = if (status == LiveWallpaperStatus.INACTIVE) Muted else Green, style = typography.bodyMedium)
            if (!supported) {
                Text("Este teléfono no admite fondos animados.", color = Muted, style = typography.bodySmall)
            } else {
                val open = { failed = !openWallpaperPicker(context) }
                if (status == LiveWallpaperStatus.INACTIVE) Button(onClick = open) { Text("Elegir como fondo") }
                else OutlinedButton(onClick = open) { Text("Cambiar en el sistema") }
                if (failed) Text("No se pudo abrir el selector de fondos del sistema.", color = Muted, style = typography.bodySmall)
            }
        }
    }
}

internal enum class LiveWallpaperStatus(val label: String) {
    INACTIVE("No está activo"),
    LOCK("Activo en el bloqueo"),
    HOME("Activo en el inicio"),
    BOTH("Activo en el bloqueo y el inicio")
}

internal fun liveWallpaperStatus(context: Context): LiveWallpaperStatus {
    val manager = WallpaperManager.getInstance(context)
    val ours = ComponentName(context, OpenfyWallpaperService::class.java)
    return runCatching {
        val home = manager.wallpaperInfo?.component == ours
        val lock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // A lock screen without its own wallpaper shows the home one.
            manager.getWallpaperInfo(WallpaperManager.FLAG_LOCK)?.component == ours ||
                (home && manager.getWallpaperId(WallpaperManager.FLAG_LOCK) < 0)
        } else home
        when {
            home && lock -> LiveWallpaperStatus.BOTH
            lock -> LiveWallpaperStatus.LOCK
            home -> LiveWallpaperStatus.HOME
            else -> LiveWallpaperStatus.INACTIVE
        }
    }.getOrDefault(LiveWallpaperStatus.INACTIVE)
}

/** Opens the system preview with Openfy's wallpaper selected; the user confirms and picks the screens there. */
internal fun openWallpaperPicker(context: Context): Boolean {
    val component = ComponentName(context, OpenfyWallpaperService::class.java)
    val intents = listOf(
        Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component),
        Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER)
    )
    return intents.any { intent ->
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }
    }
}

/** Phone-shaped twin of the wallpaper's lock screen: the same light, veil and cover proportions. */
@Composable
private fun WallpaperPreview(artwork: String?, playing: Boolean, effects: Boolean) {
    val shape = RoundedCornerShape(18.dp)
    BoxWithConstraints(Modifier.size(PreviewWidth, PreviewHeight).clip(shape)
        .semantics { contentDescription = "Vista previa del fondo animado" }) {
        AmbientBackground(artwork, playing, Modifier.fillMaxSize(), enabled = effects, playerBands = false)
        // Same geometry as WallpaperScene.coverBounds, scaled from a 412 × 892 dp phone.
        val scale = maxWidth.value / 412f
        val bounds = WallpaperScene.coverBounds((maxWidth.value / scale).toInt(), (maxHeight.value / scale).toInt(), 1f)
        val cover = RoundedCornerShape((16 * scale).dp)
        Box(Modifier.offset((bounds.left * scale).dp, (bounds.top * scale).dp)
            .size((bounds.width() * scale).dp)
            .shadow((24 * scale).dp, cover, ambientColor = Color.Black, spotColor = Color.Black)) {
            Cover(artwork, Modifier.fillMaxSize().clip(cover), sizePx = 256)
        }
    }
}

private val PreviewWidth = 108.dp
private val PreviewHeight = 234.dp
