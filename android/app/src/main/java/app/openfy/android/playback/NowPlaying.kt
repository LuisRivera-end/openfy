package app.openfy.android.playback

/**
 * Process-wide summary of the session, for surfaces that run outside the UI (the live wallpaper).
 * [PlaybackService] publishes it; readers never connect a controller, so they never start the service.
 */
internal data class NowPlaying(val songId: String? = null, val playing: Boolean = false)
