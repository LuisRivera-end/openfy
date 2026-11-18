package app.openfy.android.spotify

import android.content.Context
import android.util.AtomicFile
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.io.FileNotFoundException

@Serializable
internal data class SpotifyImportPlan(val id: String, val library: SpotifyLibrary)

@Serializable
internal enum class SpotifyTrackStatus { ACCEPTED, MATCHED, REVIEW, MISSING, OMITTED }

@Serializable
internal data class SpotifyTrackResult(
    val status: SpotifyTrackStatus,
    val candidates: List<JsonObject> = emptyList(),
    val songId: String? = null
)

/** One immutable export and an atomic checkpoint per track. All access is off the main thread. */
internal class SpotifyImportStore(context: Context) {
    private val root = File(context.filesDir, "spotify-import")
    private val planFile = File(root, "plan.json")

    fun plan(): SpotifyImportPlan? = load(planFile)

    fun setPlan(plan: SpotifyImportPlan) = save(planFile, plan)

    fun results(plan: SpotifyImportPlan): MutableMap<Int, SpotifyTrackResult> =
        directory(plan).listFiles().orEmpty().asSequence()
            .mapNotNull { file -> file.name.removeSuffix(".bak").removeSuffix(".json").toIntOrNull() }
            .filter { it in plan.library.tracks.indices }.distinct()
            .mapNotNull { index -> result(plan, index)?.let { index to it } }
            .toMap(mutableMapOf())

    fun result(plan: SpotifyImportPlan, index: Int): SpotifyTrackResult? = load(trackFile(plan, index))

    fun setResult(plan: SpotifyImportPlan, index: Int, result: SpotifyTrackResult) =
        save(trackFile(plan, index), result)

    fun complete(plan: SpotifyImportPlan): Boolean = load<Boolean>(completionFile(plan)) == true

    fun setComplete(plan: SpotifyImportPlan) = save(completionFile(plan), true)

    fun discard(plan: SpotifyImportPlan) {
        directory(plan).deleteRecursively()
    }

    private fun trackFile(plan: SpotifyImportPlan, index: Int) = File(directory(plan), "$index.json")
    private fun completionFile(plan: SpotifyImportPlan) = File(directory(plan), "complete.json")
    private fun directory(plan: SpotifyImportPlan) = File(root, java.util.UUID.fromString(plan.id).toString())

    private inline fun <reified T> load(file: File): T? {
        val stream = try {
            AtomicFile(file).openRead()
        } catch (_: FileNotFoundException) {
            return null
        }
        return stream.bufferedReader().use { Json.decodeFromString<T>(it.readText()) }
    }

    private inline fun <reified T> save(file: File, value: T) {
        val bytes = Json.encodeToString(value).toByteArray()
        val atomic = AtomicFile(file)
        val stream = atomic.startWrite()
        try {
            stream.write(bytes)
            atomic.finishWrite(stream)
        } catch (error: Exception) {
            atomic.failWrite(stream)
            throw error
        }
    }
}
