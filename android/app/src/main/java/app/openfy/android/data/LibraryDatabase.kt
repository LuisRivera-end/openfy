package app.openfy.android.data

import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable

@Serializable
@Entity(tableName = "songs", indices = [Index(value=["hash"], unique=true)])
data class Song(
    @PrimaryKey val id: String, val title: String, val artist: String = "", val album: String = "",
    val duration: Long = 0, val artwork: String? = null, val source: String = "youtube",
    val path: String? = null, val hash: String? = null, val metadata: String = "{}",
    val favorite: Boolean = false, val addedAt: Long = System.currentTimeMillis(),
    val offlineReady: Boolean = false, val artistId: String? = null, val albumId: String? = null,
    @ColumnInfo(defaultValue="0") val saved: Boolean = false,
)
@Serializable
@Entity(tableName = "playlists")
data class PlaylistRow(@PrimaryKey val id: String, val name: String, val entries: String = "[]",
    val revision: Long = 0, val syncRevision: Long = 0, val keepDownloaded: Boolean = false, val localOnly: Boolean = false)
@Entity(tableName = "downloads")
data class DownloadRow(@PrimaryKey val id: String, val state: String = "queued", val bytes: Long = 0,
    val total: Long = 0, val hash: String? = null, val error: String? = null)
@Entity(tableName = "lyrics")
data class LyricsRow(@PrimaryKey val id: String, val status: String, val plainText: String = "",
    val lines: String = "[]", val source: String = "", val fetchedAt: Long = System.currentTimeMillis(), val expiresAt: Long = 0)
@Entity(tableName = "listening", indices = [Index("songId")])
data class ListeningRow(@PrimaryKey val id: String, val songId: String, val day: String,
    val listenedMs: Long = 0, val plays: Int = 0, val lastPlayedAt: Long = 0)
@Entity(tableName = "outbox")
data class OutboxRow(@PrimaryKey val operationId: String, val sequence: Long, val kind: String,
    val entityId: String, val baseRevision: Long, val payload: String)
@Entity(tableName = "sync_meta")
data class SyncMeta(@PrimaryKey val key: String, val value: String)
@Serializable data class RecentContext(val kind: String,val id: String,val title: String,val subtitle: String = "",val artwork: String? = null,val lastPlayedAt: Long = 0)

@Dao
interface LibraryDao {
    @Query("SELECT * FROM songs ORDER BY addedAt DESC") fun observeSongs(): Flow<List<Song>>
    @Query("SELECT * FROM playlists ORDER BY name COLLATE NOCASE") fun observePlaylists(): Flow<List<PlaylistRow>>
    @Query("SELECT * FROM downloads") fun observeDownloads(): Flow<List<DownloadRow>>
    @Query("SELECT * FROM listening") fun observeListening(): Flow<List<ListeningRow>>
    @Query("SELECT value FROM sync_meta WHERE `key` LIKE 'recent:%'") fun observeRecents(): Flow<List<String>>
    @Query("SELECT value FROM sync_meta WHERE `key` LIKE 'recent:%'") suspend fun recents(): List<String>
    @Query("DELETE FROM sync_meta WHERE `key`=:key") suspend fun deleteMeta(key: String)
    @Query("DELETE FROM sync_meta WHERE `key` LIKE 'revision:%'") suspend fun resetSyncRevisions()
    @Query("SELECT * FROM songs") suspend fun songs(): List<Song>
    @Query("SELECT * FROM songs WHERE id=:id") suspend fun song(id: String): Song?
    @Query("SELECT * FROM songs WHERE hash=:hash") suspend fun songByHash(hash: String): Song?
    @Upsert suspend fun putSong(song: Song)
    @Query("UPDATE songs SET favorite=:favorite WHERE id=:id") suspend fun favorite(id: String, favorite: Boolean)
    @Query("UPDATE songs SET saved=1 WHERE id=:id") suspend fun save(id: String)
    @Query("UPDATE songs SET offlineReady=:ready WHERE id=:id") suspend fun offlineReady(id: String, ready: Boolean)
    @Query("SELECT * FROM playlists") suspend fun playlists(): List<PlaylistRow>
    @Query("SELECT * FROM playlists WHERE id=:id") suspend fun playlist(id: String): PlaylistRow?
    @Upsert suspend fun putPlaylist(playlist: PlaylistRow)
    @Query("DELETE FROM playlists WHERE id=:id") suspend fun deletePlaylist(id: String)
    @Upsert suspend fun putDownload(row: DownloadRow)
    @Query("SELECT * FROM downloads WHERE id=:id") suspend fun download(id: String): DownloadRow?
    @Query("DELETE FROM downloads WHERE id=:id") suspend fun deleteDownload(id: String)
    @Query("SELECT * FROM lyrics WHERE id=:id") suspend fun lyrics(id: String): LyricsRow?
    @Upsert suspend fun putLyrics(row: LyricsRow)
    @Query("SELECT * FROM listening WHERE id=:id") suspend fun listening(id: String): ListeningRow?
    @Upsert suspend fun putListening(row: ListeningRow)
    @Query("SELECT * FROM outbox ORDER BY sequence LIMIT 100") suspend fun pending(): List<OutboxRow>
    @Query("SELECT * FROM outbox WHERE entityId=:id ORDER BY sequence") suspend fun pendingFor(id: String): List<OutboxRow>
    @Query("DELETE FROM outbox WHERE entityId=:id") suspend fun coalesce(id: String)
    @Query("UPDATE outbox SET baseRevision=:revision WHERE entityId=:id AND sequence>:sequence") suspend fun rebase(id: String, revision: Long, sequence: Long)
    @Query("SELECT COALESCE(MAX(sequence),0) FROM outbox") suspend fun lastSequence(): Long
    @Insert suspend fun enqueue(row: OutboxRow)
    @Query("DELETE FROM outbox WHERE operationId=:id") suspend fun acknowledge(id: String)
    @Query("SELECT value FROM sync_meta WHERE `key`=:key") suspend fun meta(key: String): String?
    @Upsert suspend fun putMeta(row: SyncMeta)
}

@Database(entities=[Song::class,PlaylistRow::class,DownloadRow::class,LyricsRow::class,ListeningRow::class,OutboxRow::class,SyncMeta::class], version=2, exportSchema=true)
abstract class LibraryDatabase : RoomDatabase() {
    abstract fun library(): LibraryDao
    companion object {
        val MIGRATION_1_2=object : Migration(1,2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE songs ADD COLUMN saved INTEGER NOT NULL DEFAULT 0")
                db.execSQL("UPDATE songs SET saved=1 WHERE source='local' OR favorite=1 OR id IN (SELECT id FROM downloads)")
                db.query("SELECT entries FROM playlists").use { cursor -> while(cursor.moveToNext()) {
                    val ids=org.json.JSONArray(cursor.getString(0))
                    for(i in 0 until ids.length()) db.execSQL("UPDATE songs SET saved=1 WHERE id=?",arrayOf(ids.getString(i)))
                } }
            }
        }
    }
}
