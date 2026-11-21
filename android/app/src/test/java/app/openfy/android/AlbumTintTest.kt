package app.openfy.android

import app.openfy.android.ui.albumDominant
import app.openfy.android.ui.albumTint
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AlbumTintTest {
    @Test
    fun matchesTheSharedAlbumTintContract() {
        val fixture = javaClass.classLoader!!.getResourceAsStream("album-tint-contract.json")!!
            .bufferedReader().use { Json.parseToJsonElement(it.readText()).jsonObject }

        val tintCases = fixture.getValue("tint").jsonArray.map { it.jsonObject }
        for (example in tintCases) {
            val input = example.getValue("input").jsonPrimitive.content
            val expected = example.getValue("expected").jsonObject

            val actual = albumTint(input)
            assertEquals("background mismatch for $input", expected.getValue("background").jsonPrimitive.content, actual.background)
            assertEquals("surface mismatch for $input", expected.getValue("surface").jsonPrimitive.content, actual.surface)
            assertEquals("muted mismatch for $input", expected.getValue("muted").jsonPrimitive.content, actual.muted)
            assertEquals("edge mismatch for $input", expected.getValue("edge").jsonPrimitive.content, actual.edge)
        }

        val dominantCases = fixture.getValue("dominant").jsonArray.map { it.jsonObject }
        for (example in dominantCases) {
            val name = example.getValue("name").jsonPrimitive.content
            val width = example.getValue("width").jsonPrimitive.int
            val height = example.getValue("height").jsonPrimitive.int
            val channels = example.getValue("channels").jsonPrimitive.int
            val pixels = example.getValue("pixels").jsonArray.map { it.jsonPrimitive.int }.toIntArray()
            val expected = example.getValue("expected").jsonPrimitive.contentOrNull

            val actualInts = albumDominant(pixels, width, height, channels)
            assertEquals("Dominant (IntArray) mismatch for $name", expected, actualInts)

            val bytePixels = ByteArray(pixels.size) { pixels[it].toByte() }
            val actualBytes = albumDominant(bytePixels, width, height, channels)
            assertEquals("Dominant (ByteArray) mismatch for $name", expected, actualBytes)
        }
    }

    @Test
    fun handlesNullAndInvalidInputs() {
        val fallback = albumTint(null)
        assertEquals("#09090B", fallback.background)
        assertEquals("#1D1D1F", fallback.surface)
        assertEquals("#AAAAB1", fallback.muted)
        assertEquals("#060608", fallback.edge)

        val invalid = albumTint("invalid")
        assertEquals("#09090B", invalid.background)
        assertEquals("#1D1D1F", invalid.surface)
        assertEquals("#AAAAB1", invalid.muted)
        assertEquals("#060608", invalid.edge)

        val bomInput = albumTint("\uFEFF#FF0000")
        val expectedRed = albumTint("#FF0000")
        assertEquals(expectedRed.background, bomInput.background)
        assertEquals(expectedRed.surface, bomInput.surface)
        assertEquals(expectedRed.muted, bomInput.muted)
        assertEquals(expectedRed.edge, bomInput.edge)

        val bomSpace = albumTint(" \uFEFF  #00FF00 ")
        val expectedGreen = albumTint("#00FF00")
        assertEquals(expectedGreen.background, bomSpace.background)
        assertEquals(expectedGreen.surface, bomSpace.surface)
        assertEquals(expectedGreen.muted, bomSpace.muted)
        assertEquals(expectedGreen.edge, bomSpace.edge)

        assertNull(albumDominant(intArrayOf(), 0, 0, 4))
        assertNull(albumDominant(intArrayOf(255, 0, 0), 1, 1, 4)) // Insufficient bytes
    }
}
