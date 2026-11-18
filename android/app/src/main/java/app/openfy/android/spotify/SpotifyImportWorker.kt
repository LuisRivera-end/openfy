package app.openfy.android.spotify

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.room.withTransaction
import androidx.work.*
import app.openfy.android.OpenfyApplication
import app.openfy.android.R
import app.openfy.android.data.CollectionRules
import app.openfy.android.data.PlaylistRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val Session = "spotify-session"
private const val SearchSpacingMs = 700L
private const val MaxAttempts = 5
private val VideoId = Regex("[A-Za-z0-9_-]{11}")

class SpotifyImportWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val app = applicationContext as OpenfyApplication
    private val store = SpotifyImportStore(app)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val plan = store.plan()?.takeIf { it.id == inputData.getString(Session) }
                ?: return@withContext Result.failure()
            if (store.complete(plan)) return@withContext Result.success()
            process(plan)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Result.failure()
        }
    }

    private suspend fun process(plan: SpotifyImportPlan): Result {
        val total = plan.library.tracks.size
        val notifications = ImportNotifications(app)
        var foreground = true
        try {
            try {
                setForeground(ForegroundInfo(ImportNotifications.Id, notifications.progress(0, total),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC))
            } catch (_: IllegalStateException) {
                // A background start can be denied. WorkManager can still run and resume a regular worker.
                foreground = false
            }

            val results = store.results(plan)
            var processed = results.values.count { it.status != SpotifyTrackStatus.ACCEPTED }
            publishProgress(notifications, processed, total)
            var searched = false
            for ((index, track) in plan.library.tracks.withIndex()) {
                currentCoroutineContext().ensureActive()
                val existing = results[index]
                if (existing != null && existing.status != SpotifyTrackStatus.ACCEPTED) continue
                val decision = if (existing != null) existing else {
                    if (searched) delay(SearchSpacingMs)
                    searched = true
                    search(track) ?: return if (runAttemptCount + 1 < MaxAttempts) Result.retry() else Result.failure()
                }
                store.setResult(plan, index, decision)
                val outcome = if (decision.status == SpotifyTrackStatus.ACCEPTED) {
                    val songId = app.persistSpotifySong(track, decision.candidates.single())
                    SpotifyTrackResult(SpotifyTrackStatus.MATCHED, songId = songId).also {
                        store.setResult(plan, index, it)
                    }
                } else decision
                results[index] = outcome
                publishProgress(notifications, ++processed, total)
            }

            plan.library.playlists.forEachIndexed { index, playlist ->
                app.createSpotifyPlaylist(plan, index, playlist, results)
            }
            store.setComplete(plan)
            return Result.success()
        } finally {
            if (!foreground) notifications.clear()
        }
    }

    private suspend fun publishProgress(notifications: ImportNotifications, processed: Int, total: Int) {
        setProgress(workDataOf(SpotifyImportWork.Processed to processed))
        notifications.update(processed, total)
    }

    private suspend fun search(track: SpotifyTrack): SpotifyTrackResult? {
        val params = buildJsonObject {
            put("track", buildJsonObject {
                put("title", track.title)
                put("artists", JsonArray(track.artists.map(::JsonPrimitive)))
                track.album?.let { put("album", it) }
                track.durationMs?.let { put("durationMs", it) }
                track.isrc?.let { put("isrc", it) }
            })
        }
        return try {
            val result = app.provider.call("spotifyMatch", params)
            when ((result["status"] as? JsonPrimitive)?.content) {
                "matched" -> {
                    val song = (result["song"] as? JsonObject)?.takeIf { it.videoId() != null }
                        ?: return null
                    SpotifyTrackResult(SpotifyTrackStatus.ACCEPTED, listOf(song))
                }
                "review" -> {
                    val candidates = (result["candidates"] as? JsonArray).orEmpty().filterIsInstance<JsonObject>()
                        .filter { it.videoId() != null }.take(3)
                    if (candidates.isEmpty()) return null
                    SpotifyTrackResult(SpotifyTrackStatus.REVIEW, candidates)
                }
                "missing" -> SpotifyTrackResult(SpotifyTrackStatus.MISSING)
                else -> null
            }
        } catch (error: CancellationException) {
            currentCoroutineContext().ensureActive()
            if (error is TimeoutCancellationException) null else throw error
        } catch (_: Exception) {
            null
        }
    }
}

internal object SpotifyImportWork {
    private const val WorkName = "openfy-spotify-import"
    const val Processed = "processed"
    private val changes = Mutex()

    fun observe(app: OpenfyApplication) =
        WorkManager.getInstance(app).getWorkInfosForUniqueWorkFlow(WorkName)

    fun matches(plan: SpotifyImportPlan, work: WorkInfo) = plan.id in work.tags

    suspend fun plan(app: OpenfyApplication): SpotifyImportPlan? = withContext(Dispatchers.IO) {
        changes.withLock { SpotifyImportStore(app).plan() }
    }

    suspend fun start(app: OpenfyApplication, library: SpotifyLibrary): SpotifyImportPlan = withContext(Dispatchers.IO) {
        changes.withLock {
            check(observe(app).first().none { !it.state.isFinished })
            val store = SpotifyImportStore(app)
            val previous = store.plan()
            val plan = SpotifyImportPlan(UUID.randomUUID().toString(), library)
            store.setPlan(plan)
            previous?.let(store::discard)
            enqueue(app, plan)
            plan
        }
    }

    suspend fun resume(app: OpenfyApplication, plan: SpotifyImportPlan) = withContext(Dispatchers.IO) {
        changes.withLock {
            val store = SpotifyImportStore(app)
            if (store.plan()?.id == plan.id && !store.complete(plan)) enqueue(app, plan)
        }
    }

    private suspend fun enqueue(app: OpenfyApplication, plan: SpotifyImportPlan) {
        val request = OneTimeWorkRequestBuilder<SpotifyImportWorker>()
            .setInputData(workDataOf(Session to plan.id))
            .addTag(plan.id)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(app).enqueueUniqueWork(WorkName, ExistingWorkPolicy.KEEP, request).await()
    }

    suspend fun report(app: OpenfyApplication, plan: SpotifyImportPlan): SpotifyImportReport? =
        withContext(Dispatchers.IO) {
            changes.withLock {
                val store = SpotifyImportStore(app)
                if (store.plan()?.id != plan.id || observe(app).first().any { !it.state.isFinished }) return@withLock null
                if (!store.complete(plan)) return@withLock SpotifyImportReport(false, emptyMap())
                val results = store.results(plan)
                for ((index, decision) in results) {
                    if (decision.status == SpotifyTrackStatus.ACCEPTED) finishReview(app, store, plan, results, index, decision)
                }
                SpotifyImportReport(true, results)
            }
        }

    suspend fun review(app: OpenfyApplication, plan: SpotifyImportPlan, index: Int, candidate: JsonObject?): SpotifyTrackResult? =
        withContext(Dispatchers.IO) {
            changes.withLock {
                val store = SpotifyImportStore(app)
                if (store.plan()?.id != plan.id || !store.complete(plan)) return@withLock null
                val current = store.result(plan, index) ?: return@withLock null
                if (current.status == SpotifyTrackStatus.ACCEPTED) {
                    return@withLock finishReview(app, store, plan, store.results(plan), index, current)
                }
                if (current.status != SpotifyTrackStatus.REVIEW) return@withLock current
                if (candidate == null) {
                    return@withLock SpotifyTrackResult(SpotifyTrackStatus.OMITTED).also { store.setResult(plan, index, it) }
                }
                check(candidate in current.candidates)
                val decision = SpotifyTrackResult(SpotifyTrackStatus.ACCEPTED, listOf(candidate))
                store.setResult(plan, index, decision)
                finishReview(app, store, plan, store.results(plan), index, decision)
            }
        }

    private suspend fun finishReview(
        app: OpenfyApplication,
        store: SpotifyImportStore,
        plan: SpotifyImportPlan,
        results: MutableMap<Int, SpotifyTrackResult>,
        index: Int,
        decision: SpotifyTrackResult
    ): SpotifyTrackResult {
        val songId = app.persistSpotifySong(plan.library.tracks[index], decision.candidates.single())
        plan.library.playlists.forEachIndexed { playlistIndex, playlist ->
            val position = playlist.tracks.indexOf(index)
            if (position >= 0) app.insertReviewedSong(plan, playlistIndex, playlist, position, results, songId)
        }
        return SpotifyTrackResult(SpotifyTrackStatus.MATCHED, songId = songId).also {
            store.setResult(plan, index, it)
            results[index] = it
        }
    }
}

internal data class SpotifyImportReport(val complete: Boolean, val results: Map<Int, SpotifyTrackResult>)

private fun JsonObject.videoId() = (this["videoId"] as? JsonPrimitive)?.content?.takeIf(VideoId::matches)

private suspend fun OpenfyApplication.persistSpotifySong(track: SpotifyTrack, candidate: JsonObject): String =
    repository.db.withTransaction {
        val id = "youtube:${requireNotNull(candidate.videoId())}"
        val song = repository.dao.song(id) ?: repository.saveRemote(candidate)
        if (track.saved && !song.favorite) repository.favorite(song)
        id
    }

private fun SpotifyImportPlan.playlistId(index: Int) =
    UUID.nameUUIDFromBytes("spotify-import:$id:$index".toByteArray()).toString()

private suspend fun OpenfyApplication.createSpotifyPlaylist(
    plan: SpotifyImportPlan, index: Int, playlist: SpotifyPlaylist, results: Map<Int, SpotifyTrackResult>
) = repository.db.withTransaction {
    val id = plan.playlistId(index)
    if (repository.dao.playlist(id) != null) return@withTransaction
    val names = repository.dao.playlists().mapTo(mutableSetOf()) { it.name.lowercase() }
    var name = playlist.name
    var duplicate = 0
    while (name.lowercase() in names) {
        val suffix = if (++duplicate == 1) " (Spotify)" else " (Spotify $duplicate)"
        name = playlist.name.take(100 - suffix.length).trimEnd() + suffix
    }
    val entries = CollectionRules.portable(playlist.tracks.mapNotNull { results[it]?.songId })
    repository.savePlaylist(PlaylistRow(id, name, CollectionRules.encode(entries)))
}

private suspend fun OpenfyApplication.insertReviewedSong(
    plan: SpotifyImportPlan,
    index: Int,
    playlist: SpotifyPlaylist,
    position: Int,
    results: Map<Int, SpotifyTrackResult>,
    songId: String
) = repository.db.withTransaction {
    val row = repository.dao.playlist(plan.playlistId(index)) ?: return@withTransaction
    val entries = CollectionRules.entries(row.entries).toMutableList()
    if (songId in entries) return@withTransaction
    val following = playlist.tracks.asSequence().drop(position + 1)
        .mapNotNull { results[it]?.songId }.map(entries::indexOf).firstOrNull { it >= 0 }
    entries.add(following ?: entries.size, songId)
    repository.savePlaylist(row.copy(entries = CollectionRules.encode(entries)))
}

private class ImportNotifications(context: Context) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(NotificationChannel(Channel, context.getString(R.string.spotify_import_channel_name),
            NotificationManager.IMPORTANCE_LOW))
    }

    fun progress(processed: Int, total: Int): Notification =
        NotificationCompat.Builder(appContext, Channel)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(appContext.getString(R.string.spotify_import_channel_name))
            .setContentText(appContext.getString(R.string.spotify_import_notification_progress, processed, total))
            .setProgress(total, processed, total == 0 || processed == total)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .build()

    @SuppressLint("MissingPermission")
    fun update(processed: Int, total: Int) {
        if (!manager.areNotificationsEnabled()) return
        try {
            manager.notify(Id, progress(processed, total))
        } catch (_: SecurityException) {
            // Notification permission can be revoked while work is running.
        }
    }

    fun clear() = manager.cancel(Id)

    companion object {
        const val Id = 8301
        private const val Channel = "spotify-import"
    }
}
