package app.openfy.android

import android.app.Application
import androidx.datastore.preferences.preferencesDataStore
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.room.Room
import app.openfy.android.data.*
import app.openfy.android.provider.YouTubeRuntime
import app.openfy.android.playback.YouTubeDataSource
import app.openfy.android.downloads.Downloads
import app.openfy.android.lyrics.LyricsRepository
import app.openfy.android.sync.SyncClient
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import java.io.File

val android.content.Context.preferences by preferencesDataStore("openfy")

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class OpenfyApplication : Application() {
    val scope = CoroutineScope(SupervisorJob()+Dispatchers.IO)
    val database by lazy { Room.databaseBuilder(this,LibraryDatabase::class.java,"openfy.db").addMigrations(LibraryDatabase.MIGRATION_1_2).build() }
    // Read lazily on the runtime's own thread: the bundle is ~2 MB and first access happens on Main.
    private fun providerSources() = assets.open("provider/polyfills.js").bufferedReader().use { it.readText() } to
        assets.open("provider/openfy-provider.js").bufferedReader().use { it.readText() }
    val provider by lazy { YouTubeRuntime(::providerSources) }
    val repository by lazy { LibraryRepository(this,database,provider) }
    // A long catalog request must never hold up audio URL renewal or the next track.
    val audioProvider by lazy { YouTubeRuntime(::providerSources) }
    val http by lazy { OkHttpClient.Builder().connectTimeout(15,java.util.concurrent.TimeUnit.SECONDS).readTimeout(15,java.util.concurrent.TimeUnit.SECONDS).build() }
    val cache by lazy { SimpleCache(File(filesDir,"downloads/audio"),NoOpCacheEvictor(),StandaloneDatabaseProvider(this)) }
    val upstreamFactory by lazy { DefaultDataSource.Factory(this,YouTubeDataSource.Factory(audioProvider,http,cache)) }
    // Playback may read explicit downloads, but streaming must never create persistent downloads.
    val audioFactory by lazy { CacheDataSource.Factory().setCache(cache).setCacheWriteDataSinkFactory(null).setUpstreamDataSourceFactory(upstreamFactory) }
    val downloads by lazy { Downloads(this) }
    val lyrics by lazy { LyricsRepository(this) }
    val sync by lazy { SyncClient(this) }
    val updates by lazy { app.openfy.android.updates.GitHubUpdates(this) }
    override fun onCreate() {
        super.onCreate()
        repository.onChanged = { sync.schedule() }
        scope.launch { downloads.reconcile(); sync.schedule() }
        scope.launch { downloads.upgradeArtwork() }
    }
}
