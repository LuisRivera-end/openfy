package app.openfy.android

import app.openfy.android.data.CollectionRules
import app.openfy.android.lyrics.Lrc
import app.openfy.android.playback.ListeningClock
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

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
