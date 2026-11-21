package app.openfy.android

import org.junit.Assert.assertEquals
import org.junit.Test

class WallpaperPolicyTest {
    private val playingOnLock = WallpaperInputs(visible = true, playing = true, screen = WallpaperScreen.LOCK,
        ambientAllowed = true, motionAllowed = true, hasCover = true, hasVideo = false, videoAttached = false)

    @Test fun liveFlagsWinOverTheStoredDescription() {
        assertEquals(WallpaperTarget.LOCK, WallpaperTarget.resolve(WallpaperTarget.FlagLock, WallpaperTarget.HOME))
        assertEquals(WallpaperTarget.HOME, WallpaperTarget.resolve(WallpaperTarget.FlagSystem, null))
        assertEquals(WallpaperTarget.BOTH, WallpaperTarget.resolve(3, WallpaperTarget.LOCK))
        assertEquals(WallpaperTarget.LOCK, WallpaperTarget.resolve(null, WallpaperTarget.LOCK))
        assertEquals(WallpaperTarget.LOCK, WallpaperTarget.resolve(0, WallpaperTarget.LOCK))
        assertEquals(WallpaperTarget.BOTH, WallpaperTarget.resolve(null, null))
        assertEquals(WallpaperTarget.HOME, WallpaperTarget.of("home"))
        assertEquals(null, WallpaperTarget.of("other"))
    }

    @Test fun sharedWallpaperFollowsTheKeyguard() {
        assertEquals(WallpaperScreen.LOCK, WallpaperTarget.BOTH.screen(keyguardLocked = true))
        assertEquals(WallpaperScreen.HOME, WallpaperTarget.BOTH.screen(keyguardLocked = false))
        assertEquals(WallpaperScreen.LOCK, WallpaperTarget.LOCK.screen(keyguardLocked = false))
        assertEquals(WallpaperScreen.HOME, WallpaperTarget.HOME.screen(keyguardLocked = true))
    }

    @Test fun drawsFramesOnlyWhileVisibleAndPlaying() {
        assertEquals(WallpaperMode.AMBIENT, wallpaperMode(playingOnLock))
        assertEquals(WallpaperMode.IDLE, wallpaperMode(playingOnLock.copy(visible = false)))
        assertEquals(WallpaperMode.STILL, wallpaperMode(playingOnLock.copy(playing = false)))
        assertEquals(WallpaperMode.STILL, wallpaperMode(playingOnLock.copy(ambientAllowed = false)))
        assertEquals(WallpaperMode.STILL, wallpaperMode(playingOnLock.copy(hasCover = false)))
    }

    @Test fun motionCoverPlaysOnlyOnTheLockScreen() {
        val withVideo = playingOnLock.copy(hasVideo = true)
        assertEquals(WallpaperMode.VIDEO, wallpaperMode(withVideo))
        assertEquals(WallpaperMode.AMBIENT, wallpaperMode(withVideo.copy(screen = WallpaperScreen.HOME)))
        assertEquals(WallpaperMode.AMBIENT, wallpaperMode(withVideo.copy(motionAllowed = false)))
        // Paused keeps an attached decoder on its last frame, but never starts one.
        assertEquals(WallpaperMode.VIDEO, wallpaperMode(withVideo.copy(playing = false, videoAttached = true)))
        assertEquals(WallpaperMode.STILL, wallpaperMode(withVideo.copy(playing = false)))
        assertEquals(WallpaperMode.IDLE, wallpaperMode(withVideo.copy(visible = false, videoAttached = true)))
    }
}
