package app.openfy.android

import app.openfy.android.data.CollectionRules
import app.openfy.android.lyrics.Lrc
import app.openfy.android.playback.ListeningClock
import app.openfy.android.ui.ArtworkUrls
import app.openfy.android.ui.CoverPalette
import app.openfy.android.ui.AMBIENT
import app.openfy.android.ui.ambientFade
import app.openfy.android.ui.ambientMeanLuma
import app.openfy.android.ui.ambientPaletteTexture
import app.openfy.android.ui.ambientScrim
import app.openfy.android.ui.gradeAmbient
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.pow

class ContractTests {
    @Test fun partialAudioRequiresTheSameEncodedResource() {
        val original="abcdefghijk:140:1700000:123456:audio/mp4"
        app.openfy.android.playback.AudioResource.requireSame(original,original,true)
        app.openfy.android.playback.AudioResource.requireSame(null,null,false)
        for(replacement in listOf(null,"abcdefghijk:140:1700001:123456:audio/mp4","abcdefghijk:141:1700000:123456:audio/mp4")) {
            assertThrows(java.io.IOException::class.java) { app.openfy.android.playback.AudioResource.requireSame(original,replacement,true) }
        }
        assertThrows(java.io.IOException::class.java) { app.openfy.android.playback.AudioResource.requireSame(null,original,true) }
    }
    private fun fixture(name: String)=Json.parseToJsonElement(javaClass.classLoader!!.getResourceAsStream(name)!!.bufferedReader().readText()).jsonObject
    @Test fun ambientLightingUsesTheSameContractAsWindowsAndWeb() {
        val contract = fixture("ambient-contract.json")
        val parameters = buildJsonObject {
            put("textureSize", AMBIENT.textureSize)
            put("lumaFloor", AMBIENT.lumaFloor)
            put("lumaCeiling", AMBIENT.lumaCeiling)
            put("saturation", AMBIENT.saturation)
            put("scrimMin", AMBIENT.scrimMin)
            put("scrimMax", AMBIENT.scrimMax)
            put("scrimPivot", AMBIENT.scrimPivot)
            put("scrimSlope", AMBIENT.scrimSlope)
            put("lyricsScrim", AMBIENT.lyricsScrim)
            put("motionSpeed", AMBIENT.motionSpeed)
            put("fadeSeconds", AMBIENT.fadeSeconds)
        }
        assertEquals(contract.getValue("parameters"), parameters)
        fun JsonObject.number(key: String) = getValue(key).jsonPrimitive.double
        for (example in contract.getValue("grade").jsonArray.map { it.jsonObject }) {
            val (r, g, b) = example.getValue("rgb").jsonArray.map { it.jsonPrimitive.double }
            val expected = example.getValue("expected").jsonArray.map { it.jsonPrimitive.double }
            gradeAmbient(r, g, b).forEachIndexed { index, value ->
                assertEquals(expected[index], value, 0.00005)
            }
        }
        for (example in contract.getValue("scrim").jsonArray.map { it.jsonObject }) {
            assertEquals(example.number("expected"), ambientScrim(example.number("luma")), 0.0000005)
        }
        for (example in contract.getValue("fade").jsonArray.map { it.jsonObject }) {
            assertEquals(example.number("expected"), ambientFade(example.number("elapsed")), 0.0000005)
        }
        val palette = contract.getValue("palette").jsonObject
        val pixels = ambientPaletteTexture(palette.getValue("colors").jsonArray.map { it.jsonPrimitive.content })
        assertEquals(AMBIENT.textureSize * AMBIENT.textureSize * 4, pixels.size)
        for (sample in palette.getValue("samples").jsonArray.map { it.jsonObject }) {
            val offset = (sample.number("y").toInt() * AMBIENT.textureSize + sample.number("x").toInt()) * 4
            assertEquals(sample.getValue("rgb").jsonArray.map { it.jsonPrimitive.int }, pixels.drop(offset).take(3).map { it.toInt() and 255 })
        }
        assertEquals(0.5, ambientMeanLuma(byteArrayOf(-1, -1, -1, -1, 0, 0, 0, -1)), 0.0000005)
        assertEquals(listOf(0x28, 0x48, 0x3e),
            ambientPaletteTexture(listOf("nope", "", "#zzzzzz"), 2).take(3).map { it.toInt() and 255 })
    }
    @Test fun artworkUsesTheSameContractAsWeb() {
        for(item in fixture("artwork-contract.json").getValue("cases").jsonArray.map { it.jsonObject }) {
            val input=item.getValue("input").jsonPrimitive.content
            assertEquals(input,item.getValue("large").jsonPrimitive.content,ArtworkUrls.large(input))
            assertEquals(input,item.getValue("identity").jsonPrimitive.content,ArtworkUrls.identity(input))
            for((size,expected) in item.getValue("sized").jsonObject) {
                assertEquals("$input at $size px",expected.jsonPrimitive.content,ArtworkUrls.sized(input,size.toInt()))
            }
        }
        assertNull(ArtworkUrls.sized(null,128))
        assertEquals("https://i.ytimg.com/vi/RGXHqQR9XrQ/hqdefault.jpg",
            ArtworkUrls.fallback("https://i.ytimg.com/vi/RGXHqQR9XrQ/maxresdefault.jpg"))
        assertNull(ArtworkUrls.fallback("https://i.ytimg.com/vi/RGXHqQR9XrQ/hqdefault.jpg"))
        assertNull(ArtworkUrls.fallback("https://notytimg.com/vi/RGXHqQR9XrQ/maxresdefault.jpg"))
    }
    @Test fun coverSurfaceMixesTheTintAndMeetsWhiteTextContrast() {
        assertEquals(0xff263647.toInt(),CoverPalette.surface(0xff6496c8.toInt()))
        assertEquals(0xff131d1b.toInt(),CoverPalette.surface(null))
        for(tint in listOf(null,0xff000000.toInt(),0xff6496c8.toInt(),0xffffffff.toInt())) {
            val surface=CoverPalette.surface(tint)
            fun channel(shift: Int): Double {
                val srgb=((surface ushr shift) and 255)/255.0
                return if(srgb<=0.04045) srgb/12.92 else ((srgb+0.055)/1.055).pow(2.4)
            }
            val luminance=0.2126*channel(16)+0.7152*channel(8)+0.0722*channel(0)
            assertTrue(1.05/(luminance+0.05)>=4.5)
        }
    }
    @Test fun mixedPlaylistProjectionPreservesAllLocalSlots() {
        assertEquals(listOf("local-a","youtube:12345678901","local-b","youtube:abcdefghijk","youtube:ABCDEFGHIJK","local-c"),
            CollectionRules.applyPortable(listOf("local-a","youtube:abcdefghijk","local-b","youtube:12345678901","local-c"),listOf("youtube:12345678901","youtube:abcdefghijk","youtube:ABCDEFGHIJK")))
        assertEquals(listOf("local-a","local-b"),CollectionRules.applyPortable(listOf("local-a","youtube:abcdefghijk","local-b"),emptyList()))
        assertEquals(listOf("local-a","youtube:abcdefghijk"),CollectionRules.applyPortable(listOf("local-a"),listOf("youtube:abcdefghijk")))
    }
    @Test fun listeningUsesTheSameFixturesAsWindowsAndWeb() {
        val contract=fixture("listening-contract.json")
        val start=contract.getValue("startedAt").jsonPrimitive.long
        for(item in contract.getValue("cases").jsonArray.map { it.jsonObject }) {
            val name=item.getValue("name").jsonPrimitive.content
            val samples=item.getValue("samples").jsonArray.map { it.jsonArray }
            val clock=ListeningClock()
            for((index,sample) in samples.withIndex()) {
                val position=(sample[0].jsonPrimitive.double*1000).toLong()
                val elapsed=sample[1].jsonPrimitive.long
                val playing=sample[2].jsonPrimitive.boolean
                if(index==0) clock.reset(position,elapsed,start+elapsed,playing)
                else clock.sample(position,100000,elapsed,start+elapsed,playing)
            }
            assertEquals(name,item.getValue("listenedMs").jsonPrimitive.long,clock.listenedMs)
            assertEquals(name,item.getValue("qualified").jsonPrimitive.boolean,clock.qualified)
        }
    }
    @Test fun lyricsUseTheExistingCrossPlatformParsingContract() {
        for(item in fixture("lyrics-contract.json").getValue("parse").jsonArray.map { it.jsonObject }) {
            val expected=item.getValue("lines").jsonArray
            val actual=Lrc.parse(item.getValue("lrc").jsonPrimitive.content)
            assertEquals(item.getValue("name").jsonPrimitive.content,expected.size,actual.size)
            for(index in actual.indices) {
                val wanted=expected[index].jsonObject; val got=actual[index]
                assertEquals(wanted.getValue("time").jsonPrimitive.double,got.time,0.00001)
                assertEquals(wanted.getValue("text").jsonPrimitive.content,got.text)
                val words=wanted["words"]?.jsonArray.orEmpty()
                assertEquals("${item["name"]}: words",words.size,got.words.size)
                words.forEachIndexed { i,word -> assertEquals(word.jsonObject.getValue("text").jsonPrimitive.content,got.words[i].text); assertEquals(word.jsonObject.getValue("time").jsonPrimitive.double,got.words[i].time,0.00001) }
                assertEquals(wanted["end"]?.jsonPrimitive?.doubleOrNull,got.end)
            }
        }
    }
}
