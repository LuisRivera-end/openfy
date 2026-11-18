package app.openfy.android

import app.openfy.android.updates.AndroidRelease
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class AndroidReleaseTests {
    private val certificate="ab".repeat(32)
    private fun release()=AndroidRelease(1,"app.openfy.android","0.5.1",200,29,listOf("arm64-v8a","x86_64"),"Openfy-200.apk",3,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",certificate)
    @Test fun onlyACompatibleNewerBuildWithTheInstalledSignerIsOffered() {
        val candidate=release()
        assertTrue(candidate.compatible(199,29,listOf("arm64-v8a"),certificate.uppercase()))
        assertFalse(candidate.compatible(200,37,listOf("x86_64"),certificate))
        assertFalse(candidate.compatible(201,37,listOf("x86_64"),certificate))
        assertFalse(candidate.compatible(199,28,listOf("arm64-v8a"),certificate))
        assertFalse(candidate.compatible(199,37,listOf("armeabi-v7a"),certificate))
        assertFalse(candidate.compatible(199,37,listOf("x86_64"),"cd".repeat(32)))
        assertThrows(IllegalArgumentException::class.java) { candidate.copy(file="../other.apk").validate() }
        assertThrows(IllegalArgumentException::class.java) { candidate.copy(applicationId="app.openfy.android.debug").validate() }
    }
    @Test fun theWholeApkMustMatchSizeAndHash() {
        val file=File.createTempFile("openfy-update-",".apk")
        try {
            file.writeText("abc"); release().verify(file)
            file.writeText("abd"); assertThrows(IllegalArgumentException::class.java) { release().verify(file) }
            file.writeText("ab"); assertThrows(IllegalArgumentException::class.java) { release().verify(file) }
        } finally { file.delete() }
    }
    @Test fun assetsMustBelongToTheOfficialGithubRelease() {
        val url="https://github.com/LuisRivera-end/openfy/releases/download/v0.5.1/Openfy-200.apk"
        assertTrue(AndroidRelease.officialAsset(url,"Openfy-200.apk"))
        for(invalid in listOf(url.replace("https:","http:"),url.replace("github.com/","github.com.evil.test/"),url.replace("/openfy/","/other/"),"$url?redirect=elsewhere",url.replace("v0.5.1/","v0.5.1/nested/"),url.replace("github.com/","user@github.com/")))
            assertFalse(invalid,AndroidRelease.officialAsset(invalid,"Openfy-200.apk"))
    }
}
