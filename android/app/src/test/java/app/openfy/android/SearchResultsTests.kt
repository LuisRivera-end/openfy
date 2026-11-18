package app.openfy.android

import app.openfy.android.ui.searchCards
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class SearchResultsTests {
    private val songs = Json.parseToJsonElement("""{"songs":[{"videoId":"abc","title":"Get Lucky","artists":["Daft Punk"]}],"nextCursor":"next"}""").jsonObject

    @Test fun songSearchProducesNoCards() {
        // Song results have videoId, not id: rendering them as cards crashed the search screen.
        assertTrue(searchCards("songs",songs).isEmpty())
    }
    @Test fun artistAndAlbumCardsKeepOnlyItemsWithAnId() {
        val artists = Json.parseToJsonElement("""{"artists":[{"id":"UC1","name":"Daft Punk"},{"name":"Sin id"},{"id":null,"name":"Nulo"},"texto"]}""").jsonObject
        assertEquals(listOf("UC1"),searchCards("artists",artists).map { it.getValue("id").jsonPrimitive.content })
        val albums = Json.parseToJsonElement("""{"albums":[{"id":"MPRE1","title":"Discovery"}]}""").jsonObject
        assertEquals(1,searchCards("albums",albums).size)
        assertTrue(searchCards("albums",songs).isEmpty())
    }
}
