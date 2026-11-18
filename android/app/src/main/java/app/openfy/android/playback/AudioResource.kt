package app.openfy.android.playback

import java.io.IOException

object AudioResource {
    /** An unidentified resource is playable from the start, but never safe to append to cached bytes. */
    fun requireSame(cached: String?,resolved: String?,hasCachedBytes: Boolean) {
        if(hasCachedBytes && (cached.isNullOrEmpty() || resolved.isNullOrEmpty() || cached!=resolved))
            throw IOException("El recurso de audio cambió. Elimina la descarga incompleta y vuelve a descargarla.")
    }
}
