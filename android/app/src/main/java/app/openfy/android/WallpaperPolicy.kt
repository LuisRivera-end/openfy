package app.openfy.android

/** Destination the user chose in the system picker, persisted on Android 16+ in the wallpaper description. */
internal enum class WallpaperTarget(val id: String) {
    LOCK("lock"), HOME("home"), BOTH("both");

    companion object {
        // WallpaperManager.FLAG_SYSTEM and FLAG_LOCK, kept here so the policy runs in JVM tests.
        const val FlagSystem = 1
        const val FlagLock = 2

        fun of(id: String?): WallpaperTarget? = entries.firstOrNull { it.id == id }

        fun fromFlags(which: Int): WallpaperTarget? = when (which and (FlagSystem or FlagLock)) {
            FlagSystem -> HOME
            FlagLock -> LOCK
            FlagSystem or FlagLock -> BOTH
            else -> null
        }

        /** Live flags (API 34+) win over the persisted description, which only records the original choice. */
        fun resolve(flags: Int?, described: WallpaperTarget?): WallpaperTarget =
            flags?.let(::fromFlags) ?: described ?: BOTH
    }
}

/** What one engine paints right now: the full cover on the lock screen, a dimmed version at home. */
internal enum class WallpaperScreen { LOCK, HOME }

internal fun WallpaperTarget.screen(keyguardLocked: Boolean): WallpaperScreen = when (this) {
    WallpaperTarget.LOCK -> WallpaperScreen.LOCK
    WallpaperTarget.HOME -> WallpaperScreen.HOME
    WallpaperTarget.BOTH -> if (keyguardLocked) WallpaperScreen.LOCK else WallpaperScreen.HOME
}

/** How the engine spends frames. Only [AMBIENT] runs a draw loop; [VIDEO] hands the surface to a decoder. */
internal enum class WallpaperMode { IDLE, STILL, AMBIENT, VIDEO }

internal data class WallpaperInputs(
    val visible: Boolean,
    val playing: Boolean,
    val screen: WallpaperScreen,
    /** «Movimiento ambiental» on and animations not reduced. */
    val ambientAllowed: Boolean,
    /** «Portadas animadas» also on. */
    val motionAllowed: Boolean,
    val hasCover: Boolean,
    val hasVideo: Boolean,
    /** A decoder already owns the surface for this song (it keeps its last frame while paused). */
    val videoAttached: Boolean
)

internal fun wallpaperMode(input: WallpaperInputs): WallpaperMode = with(input) {
    when {
        !visible -> WallpaperMode.IDLE
        screen == WallpaperScreen.LOCK && motionAllowed && hasVideo && (playing || videoAttached) -> WallpaperMode.VIDEO
        playing && ambientAllowed && hasCover -> WallpaperMode.AMBIENT
        else -> WallpaperMode.STILL
    }
}
