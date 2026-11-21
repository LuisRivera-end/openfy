package app.openfy.android

import app.openfy.android.ui.DetailState
import app.openfy.android.ui.forHistory
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DetailHistoryTest {
    private val album = buildJsonObject { put("id", "album-1"); put("title", "Álbum") }

    @Test fun interruptedPaginationIsDroppedSoTheRestoredPageCanPaginateAgain() {
        val paginating = DetailState("artist", "artist-1", "Artista", albums = listOf(album), moreSongs = true, loading = true)
        val kept = paginating.forHistory()
        assertFalse(kept.loading)
        assertEquals(paginating.copy(loading = false), kept)
    }

    @Test fun interruptedFirstLoadStaysLoadingSoBackFetchesItAgain() {
        val first = DetailState("album", "album-1", "Álbum", loading = true)
        assertTrue(first.forHistory().loading)
    }

    @Test fun settledPagesAreKeptAsTheyAre() {
        val settled = DetailState("artist", "artist-1", "Artista", singles = listOf(album), error = "No se pudieron cargar más canciones.")
        assertEquals(settled, settled.forHistory())
    }
}
