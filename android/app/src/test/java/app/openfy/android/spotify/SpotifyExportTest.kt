package app.openfy.android.spotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class SpotifyExportTest {
    @Test
    fun zipFindsNestedFilesAndKeepsPlaylistOrderAfterDeduplication() {
        val archive = zip {
            entry("other/YourLibrary.json", """
                {"tracks":[null,7,
                  {"track":"Tití Me Preguntó","artist":"Bad Bunny","album":"Un Verano Sin Ti","uri":"spotify:track:abc"},
                  {"track":"Titi Me Pregunto","artist":"Bad Bunny"},
                  {"track":"Local recording","artist":"Artist","uri":"spotify:local:artist:album:recording"}
                ]}
            """.trimIndent())
            entry("Spotify Account Data/Playlist2.json", """
                {"playlists":[{"name":"Mezcla","items":[
                  {"track":{"trackName":"Get Lucky","artistName":"Daft Punk","trackUri":"spotify:track:def"}},
                  {"track":null,"episode":{"name":"Podcast"}},
                  {"track":{"trackName":"Local recording"},"localTrack":{"name":"Local recording"}},
                  {"track":{"trackName":"Titi Me Pregunto","artistName":"Bad Bunny","trackUri":"spotify:track:abc"}},
                  {"track":{"trackName":"Get Lucky","artistName":"Daft Punk","trackUri":"spotify:track:def"}},
                  {"track":{"trackName":null}},null
                ]},{"name":"Vacía"}]}
            """.trimIndent())
            entry("Spotify Account Data/Playlist3.json", "{broken")
            entry("history/StreamingHistory_music_0.json", "{}")
        }
        val library = SpotifyExport.read(archive.inputStream())
        assertEquals(listOf("Tití Me Preguntó", "Get Lucky"), library.tracks.map { it.title })
        assertEquals(1, library.tracks.count { it.saved })
        assertEquals(listOf(SpotifyPlaylist("Mezcla", listOf(1, 0)), SpotifyPlaylist("Vacía", emptyList())), library.playlists)
    }

    @Test
    fun readsStandaloneJsonWithBomAndMissingArtist() {
        val bytes = """{"name":"Favoritas","items":[{"track":{"trackName":"MÍA","artists":[null,{}]}}]}"""
        val library = SpotifyExport.read(("\uFEFF" + bytes).byteInputStream())
        val track = library.tracks.single()
        assertEquals("MÍA", track.title)
        assertTrue(track.artists.isEmpty())
        assertFalse(track.saved)
        assertEquals(listOf(0), library.playlists.single().tracks)
    }

    @Test
    fun deduplicatesAnExportWithPlaylistFilesBeforeTheLibrary() {
        val archive = zip {
            entry("Playlist1.json", """
                {"playlists":[{"name":"Mezcla","items":[{"track":{"trackName":"Linger","artistName":"The Cranberries"}}]}]}
            """.trimIndent())
            entry("YourLibrary.json", """
                {"tracks":[{"track":"Linger","artist":"The Cranberries","album":"Everybody Else Is Doing It, So Why Can't We?",
                    "uri":"spotify:track:linger"}]}
            """.trimIndent())
        }
        val library = SpotifyExport.read(archive.inputStream())
        assertTrue(library.tracks.single().saved)
        assertEquals("spotify:track:linger", library.tracks.single().uri)
        assertEquals(listOf(0), library.playlists.single().tracks)
    }

    @Test
    fun rejectsOversizeEntriesEvenWhenZipProvidesNoInitialSize() {
        val archive = zip {
            entry("YourLibrary.json", """{"tracks":[]}""")
            putNextEntry(ZipEntry("ignored/data.txt"))
            val bytes = ByteArray(1024 * 1024)
            repeat(51) { write(bytes) }
            closeEntry()
        }
        val error = org.junit.Assert.assertThrows(SpotifyExportException::class.java) {
            SpotifyExport.read(archive.inputStream())
        }
        assertEquals(SpotifyExportError.TOO_LARGE, error.reason)
    }

    private fun zip(body: ZipOutputStream.() -> Unit): ByteArray {
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use(body)
        return bytes.toByteArray()
    }

    private fun ZipOutputStream.entry(path: String, text: String) {
        putNextEntry(ZipEntry(path))
        write(text.toByteArray())
        closeEntry()
    }
}
