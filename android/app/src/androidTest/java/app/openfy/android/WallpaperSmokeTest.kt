package app.openfy.android

import android.app.WallpaperInfo
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.service.wallpaper.WallpaperService
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class WallpaperSmokeTest {
    @Test fun serviceIsAPickableLiveWallpaper() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val services = context.packageManager.queryIntentServices(
            Intent(WallpaperService.SERVICE_INTERFACE).setPackage(context.packageName), PackageManager.GET_META_DATA)
        // WallpaperInfo parses the same metadata the system picker reads.
        val info = WallpaperInfo(context, services.single())
        assertEquals(ComponentName(context, OpenfyWallpaperService::class.java), info.component)
        assertEquals("Fondo animado de Openfy", info.loadLabel(context.packageManager).toString())
        assertNotNull(info.loadThumbnail(context.packageManager))
        assertEquals(android.Manifest.permission.BIND_WALLPAPER, services.single().serviceInfo.permission)
    }
}
