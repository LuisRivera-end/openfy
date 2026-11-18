package app.openfy.android

import app.openfy.android.data.RecentContext
import app.openfy.android.ui.currentYearReleases
import app.openfy.android.ui.homeAlbumId
import app.openfy.android.ui.homeGreeting
import app.openfy.android.ui.homeKey
import app.openfy.android.ui.quickAccess
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class HomeModelTest {
    @Test fun quickAccessPrioritizesFavoritesThenRecentContextsThenPlaylists() {
        val recents = listOf(
            context("song", "song"),
            context("favorites", "favorites"),
            context("playlist", "same"),
            context("album", "same"),
            context("artist", "artist"),
            context("album", "same"),
        )
        val playlists = listOf(context("playlist", "same")) + (1..8).map { context("playlist", "$it") }

        assertEquals(
            listOf("favorites:favorites", "playlist:same", "album:same", "artist:artist", "playlist:1", "playlist:2", "playlist:3", "playlist:4"),
            quickAccess(true, recents, playlists).map { it.homeKey },
        )
    }

    @Test fun quickAccessStaysHiddenWhenOnlyOneUniqueTileIsAvailable() {
        val playlist = context("playlist", "playlist")
        assertTrue(quickAccess(false, listOf(playlist, context("song", "song")), listOf(playlist)).isEmpty())
        assertTrue(quickAccess(true, emptyList(), emptyList()).isEmpty())
        assertEquals(listOf("favorites:favorites", "playlist:playlist"),
            quickAccess(true, emptyList(), listOf(playlist)).map { it.homeKey })
    }

    @Test fun currentYearReleasesAppliesTheYearAndIdFiltersBeforeTheLimit() {
        val releases = (1..15).map { release("old-$it", 2025) } + listOf(
            release("future", 2027), release("undated", null), release("", 2026), release("one", 2026), release("one", 2026),
        ) + (1..14).map { release("new-$it", 2026) }

        assertEquals(listOf("one") + (1..11).map { "new-$it" }, currentYearReleases(releases, 2026).map { it.homeAlbumId })
        assertTrue(currentYearReleases(releases, 2024).isEmpty())
    }

    @Test fun greetingUsesMexicoCityAndChangesAtTheExactHours() {
        val zone = ZoneId.of("America/Mexico_City")
        val date = ZonedDateTime.of(2026, 11, 17, 0, 0, 0, 0, zone)
        assertEquals("Buenas noches", homeGreeting(date.withHour(4).withMinute(59)))
        assertEquals("Buenos días", homeGreeting(date.withHour(5)))
        assertEquals("Buenos días", homeGreeting(date.withHour(11).withMinute(59)))
        assertEquals("Buenas tardes", homeGreeting(date.withHour(12)))
        assertEquals("Buenas tardes", homeGreeting(date.withHour(19).withMinute(59)))
        assertEquals("Buenas noches", homeGreeting(date.withHour(20)))
        assertEquals("Buenas noches", homeGreeting(date.withHour(23).withZoneSameInstant(ZoneId.of("UTC"))))
    }

    private fun context(kind: String, id: String) = RecentContext(kind, id, id)

    private fun release(id: String, year: Int?) = buildJsonObject {
        put("id", id)
        if (year == null) put("year", JsonNull) else put("year", year)
    }
}
