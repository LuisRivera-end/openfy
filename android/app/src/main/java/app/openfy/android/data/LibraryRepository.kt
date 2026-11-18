package app.openfy.android.data

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import androidx.room.withTransaction
import app.openfy.android.provider.YouTubeRuntime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.io.File
import java.security.MessageDigest
import java.util.UUID

class LibraryRepository(val context: Context, val db: LibraryDatabase, val provider: YouTubeRuntime) {
    val dao = db.library()
    val importing = MutableStateFlow(false)
    var onChanged: () -> Unit = {}

    suspend fun saveRemote(value: JsonObject): Song {
        val videoId = value.getValue("videoId").jsonPrimitive.content
        require(videoId.matches(Regex("[A-Za-z0-9_-]{11}")))
        val id = "youtube:$videoId"
        val previous = dao.song(id)
        val song = Song(id=id,title=value.getValue("title").jsonPrimitive.content,
            artist=value["artists"]?.jsonArray?.joinToString(", ") { it.jsonPrimitive.content }.orEmpty(),
            album=value["album"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            duration=((value["duration"]?.jsonPrimitive?.doubleOrNull ?: 0.0)*1000).toLong(),
            artwork=previous?.artwork?.takeIf { !it.startsWith("https:") && File(it).exists() } ?: value["artwork"]?.jsonPrimitive?.contentOrNull,
            metadata=value.toString(),favorite=previous?.favorite ?: false,addedAt=previous?.addedAt ?: System.currentTimeMillis(),
            offlineReady=previous?.offlineReady ?: false,
            artistId=value["artistRefs"]?.jsonArray?.firstOrNull()?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull,
            albumId=value["albumId"]?.jsonPrimitive?.contentOrNull,saved=previous?.saved ?: false)
        dao.putSong(song)
        return song
    }

    private suspend fun enqueue(kind: String, id: String, revision: Long, payload: JsonObject) {
        val sequence = (dao.meta("sequence")?.toLongOrNull() ?: 0) + 1
        dao.putMeta(SyncMeta("sequence",sequence.toString()))
        dao.coalesce(id)
        dao.enqueue(OutboxRow(UUID.randomUUID().toString(),sequence,kind,id,revision,payload.toString()))
    }

    suspend fun favorite(song: Song) {
        db.withTransaction {
            val current = dao.song(song.id) ?: return@withTransaction
            dao.favorite(song.id,!current.favorite)
            dao.save(song.id)
            if(song.source == "youtube") enqueue("favorite",song.id,0,buildJsonObject {
                put("song",Json.parseToJsonElement(current.metadata)); put("favorite",!current.favorite)
            })
        }
        onChanged()
    }

    suspend fun createPlaylist(name: String): PlaylistRow {
        require(name.trim().length in 1..100)
        val row = PlaylistRow(UUID.randomUUID().toString(),name.trim())
        savePlaylist(row); return row
    }
    suspend fun savePlaylist(row: PlaylistRow) {
        db.withTransaction {
            val prior = dao.playlist(row.id)
            val next = row.copy(revision=(prior?.revision ?: 0)+1)
            dao.putPlaylist(next)
            if(!row.localOnly) enqueue("playlist",row.id,row.syncRevision,playlistPayload(next))
        }
        onChanged()
    }
    suspend fun playlistPayload(row: PlaylistRow): JsonObject = buildJsonObject {
        put("name",row.name)
        put("trackIds",JsonArray(CollectionRules.portable(CollectionRules.entries(row.entries)).map(::JsonPrimitive)))
        put("songs",JsonArray(CollectionRules.portable(CollectionRules.entries(row.entries)).mapNotNull { dao.song(it)?.metadata?.let(Json::parseToJsonElement) }))
    }
    suspend fun addToPlaylist(row: PlaylistRow, song: Song) {
        if(song.source=="youtube") saveRemote(Json.parseToJsonElement(song.metadata).jsonObject)
        dao.save(song.id)
        val latest = dao.playlist(row.id) ?: return
        savePlaylist(latest.copy(entries=CollectionRules.encode((CollectionRules.entries(latest.entries)+song.id).distinct())))
    }
    suspend fun deletePlaylist(row: PlaylistRow) {
        db.withTransaction {
            val locals = CollectionRules.entries(row.entries).filterNot { it.startsWith("youtube:") }
            if(locals.isNotEmpty()) dao.putPlaylist(PlaylistRow(UUID.randomUUID().toString(),"${row.name} (local)",CollectionRules.encode(locals),localOnly=true))
            dao.deletePlaylist(row.id)
            if(!row.localOnly) enqueue("deletePlaylist",row.id,row.syncRevision,buildJsonObject {})
        }
        onChanged()
    }

    suspend fun importUris(uris: List<Uri>) = withContext(Dispatchers.IO) {
        importing.value = true
        try {
            suspend fun visit(uri: Uri) {
                val doc = DocumentFile.fromSingleUri(context,uri)
                importFile(uri,doc?.name ?: "Canción")
            }
            for(uri in uris) visit(uri)
        } finally { importing.value = false }
    }
    suspend fun importFolder(uri: Uri) = withContext(Dispatchers.IO) {
        importing.value = true
        try {
            suspend fun visit(file: DocumentFile) {
                if(file.isDirectory) file.listFiles().forEach { visit(it) }
                else if(file.name?.substringAfterLast('.',"")?.lowercase() in setOf("mp3","m4a","aac","flac")) importFile(file.uri,file.name ?: "Canción")
            }
            DocumentFile.fromTreeUri(context,uri)?.let { visit(it) }
        } finally { importing.value = false }
    }

    internal suspend fun importFile(uri: Uri, name: String) {
        val extension = name.substringAfterLast('.',"").lowercase()
        require(extension in setOf("mp3","m4a","aac","flac")) { "Formato no compatible: $name" }
        val directory = File(context.filesDir,"originals").apply { mkdirs() }
        val id = UUID.randomUUID().toString()
        val temporary = File(directory,"$id.partial")
        val digest = MessageDigest.getInstance("SHA-256")
        var destination: File? = null
        try {
            context.contentResolver.openInputStream(uri)!!.use { input -> temporary.outputStream().use { output ->
                val buffer = ByteArray(64*1024)
                while(true) { val count=input.read(buffer); if(count<0) break; output.write(buffer,0,count); digest.update(buffer,0,count) }
            } }
            require(temporary.length()>0) { "El archivo está vacío" }
            val hash = digest.digest().joinToString("") { "%02x".format(it) }
            if(dao.songByHash(hash) != null) return
            val retriever = MediaMetadataRetriever()
            val song = try {
                retriever.setDataSource(temporary.absolutePath)
                fun tag(key: Int) = retriever.extractMetadata(key)
                val artwork = retriever.embeddedPicture?.let { bytes ->
                    File(context.filesDir,"artwork").mkdirs()
                    File(context.filesDir,"artwork/$hash.jpg").also { it.writeBytes(bytes) }.absolutePath
                }
                destination = File(directory,"$id.$extension")
                Song(id=id,title=tag(MediaMetadataRetriever.METADATA_KEY_TITLE) ?: name.substringBeforeLast('.'),
                    artist=tag(MediaMetadataRetriever.METADATA_KEY_ARTIST).orEmpty(),album=tag(MediaMetadataRetriever.METADATA_KEY_ALBUM).orEmpty(),
                    duration=tag(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0,
                    artwork=artwork,source="local",path=destination!!.absolutePath,hash=hash,offlineReady=true,saved=true,
                    metadata=buildJsonObject { put("genres",JsonArray(tag(MediaMetadataRetriever.METADATA_KEY_GENRE).orEmpty().split(';',',').filter { it.isNotBlank() }.map { JsonPrimitive(it.trim()) })) }.toString())
            } finally { retriever.release() }
            check(temporary.renameTo(destination!!)) { "No se pudo completar la importación" }
            try { dao.putSong(song) } catch(error: Throwable) { destination?.delete(); throw error }
        } finally { temporary.delete() }
    }
}
