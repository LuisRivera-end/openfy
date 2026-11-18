package app.openfy.android

import android.content.pm.PackageManager
import androidx.test.platform.app.InstrumentationRegistry
import app.openfy.android.updates.AndroidRelease
import app.openfy.android.updates.ApkIdentity
import app.openfy.android.provider.readBounded
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class GitHubUpdateSmokeTest {
    @Test @Suppress("DEPRECATION") fun publishedApkMatchesTheInstalledProductionIdentity(): Unit = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("githubUpdate")=="true")
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as OpenfyApplication
        val tag=InstrumentationRegistry.getArguments().getString("githubTag") ?: "v0.5.1-build.1794906885"
        val base="https://github.com/${AndroidRelease.REPOSITORY}/releases/download/$tag"
        fun fetch(name: String)=app.http.newCall(Request.Builder().url("$base/$name").header("Accept","application/vnd.github+json").header("User-Agent","Openfy-Android/0.5.1").build()).execute().use {
            assertTrue("GitHub status ${it.code}",it.isSuccessful)
            println("GITHUB_RESPONSE host=${it.request.url.host} bytes=${it.body!!.contentLength()}")
            it.body!!.byteStream().use { input -> input.readBounded(32*1024*1024) }
        }
        val release=Json { ignoreUnknownKeys=true }.decodeFromString<AndroidRelease>(fetch(AndroidRelease.DESCRIPTOR).decodeToString())
        val file=File(app.cacheDir,release.file+".part")
        try {
            file.writeBytes(fetch(release.file)); release.verify(file)
            val parsed=ApkIdentity.read(app.packageManager,file.absolutePath)
            assertNotNull("Downloaded APK could not be parsed",parsed)
            assertEquals(release.applicationId,parsed!!.packageName)
            assertEquals(release.build,parsed.longVersionCode)
            assertEquals(release.version,parsed.versionName)
            assertEquals(release.minSdk,parsed.applicationInfo!!.minSdkVersion)
            val certificate=AndroidRelease.hex(MessageDigest.getInstance("SHA-256").digest(parsed.signingInfo!!.apkContentsSigners.single().toByteArray()))
            assertEquals(release.certificateSha256,certificate)
            val installed=app.packageManager.getPackageInfo(release.applicationId,PackageManager.GET_SIGNING_CERTIFICATES)
            assertArrayEquals(installed.signingInfo!!.apkContentsSigners.single().toByteArray(),parsed.signingInfo!!.apkContentsSigners.single().toByteArray())
        } finally { file.delete() }
    }
}
