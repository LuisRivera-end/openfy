package app.openfy.android

import app.openfy.android.ui.NEUTRAL
import app.openfy.android.ui.artistTheme
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.pow

class ArtistThemeContractTest {
    @Test fun matchesTheSharedArtistThemeContract() {
        val fixture = javaClass.classLoader!!.getResourceAsStream("artist-theme-contract.json")!!
            .bufferedReader().use { Json.parseToJsonElement(it.readText()).jsonArray }
        for (example in fixture.map { it.jsonObject }) {
            val name = example.getValue("name").jsonPrimitive.content
            val pixels = example.getValue("pixels").jsonArray.map { it.jsonPrimitive.int }
            assertEquals(16 * 16 * 3, pixels.size)
            val argb = IntArray(pixels.size / 3) { i ->
                (255 shl 24) or (pixels[i * 3] shl 16) or (pixels[i * 3 + 1] shl 8) or pixels[i * 3 + 2]
            }
            val actual = artistTheme(argb)
            val expected = example.getValue("expected").jsonObject
            assertEquals(name, expected.getValue("neutral").jsonPrimitive.boolean, actual.neutral)

            for ((key, hex) in mapOf("base" to actual.base, "secondary" to actual.secondary, "deep" to actual.deep, "surface" to actual.surface)) {
                assertTrue(hex.matches(Regex("^#[0-9a-f]{6}$")))
                val channels = rgb(expected.getValue(key).jsonPrimitive.content)
                rgb(hex).forEachIndexed { i, value -> assertTrue("$name / $key: $hex", abs(value - channels[i]) <= 2) }
            }

            for (background in listOf(actual.base, actual.secondary, actual.deep)) {
                assertTrue("$name: $background", luminance(background) <= 0.18 + 0.002) // Allow 8-bit rounding.
            }
        }
    }

    @Test fun usesTheSameNeutralThemeWithoutASample() {
        assertEquals(NEUTRAL, artistTheme(null))
    }

    private fun rgb(hex: String) = listOf(1, 3, 5).map { hex.substring(it, it + 2).toInt(16) }

    private fun luminance(hex: String): Double {
        val (r, g, b) = rgb(hex).map { byte ->
            val c = byte / 255.0
            if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
}
