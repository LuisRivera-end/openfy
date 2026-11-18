package app.openfy.android.lyrics

import app.openfy.android.OpenfyApplication
import app.openfy.android.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.File

@Serializable data class LyricsWord(val time: Double,val text: String)
@Serializable data class LyricsLine(val time: Double,val text: String,val words: List<LyricsWord> = emptyList(),val end: Double? = null)

object Lrc {
    private val stamp=Regex("\\[(\\d+):(\\d{2})(?:[.:](\\d+))?]")
    private val wordStamp=Regex("<(\\d+):(\\d{2})(?:[.:](\\d+))?>")
    private fun seconds(match: MatchResult)=match.groupValues[1].toDouble()*60+match.groupValues[2].toDouble()+("0."+match.groupValues[3]).toDouble()
    fun parse(text: String): List<LyricsLine> {
        val offset=Regex("\\[offset:([+-]?\\d+)]",RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)?.toDouble()?.div(1000) ?: 0.0
        return text.lineSequence().flatMap { line ->
            val stamps=stamp.findAll(line).toList()
            if(stamps.isEmpty()) return@flatMap emptySequence()
            val body=line.substring(stamps.last().range.last+1)
            val marks=wordStamp.findAll(body).toList()
            val words=marks.mapIndexedNotNull { index, mark ->
                val value=body.substring(mark.range.last+1,marks.getOrNull(index+1)?.range?.first ?: body.length)
                if(value.isEmpty()) null else LyricsWord((seconds(mark)+offset).coerceAtLeast(0.0),value)
            }
            val clean=body.replace(wordStamp,"").trim()
            val prefix=marks.firstOrNull()?.let { body.substring(0,it.range.first) }.orEmpty()
            val fragments=if(prefix.isNotBlank()) listOf(LyricsWord((seconds(stamps.first())+offset).coerceAtLeast(0.0),prefix))+words else words
            stamps.asSequence().map { LyricsLine((seconds(it)+offset).coerceAtLeast(0.0),clean,fragments,
                marks.lastOrNull()?.takeIf { it.range.last==body.lastIndex }?.let { seconds(it)+offset }) }
        }.sortedBy { it.time }.toList().let { lines -> lines.mapIndexed { index,line ->
            val next=lines.getOrNull(index+1)?.time
            val valid=line.words.withIndex().all { (i,word) -> word.time>=line.time && (i==0 || word.time>=line.words[i-1].time) && (next==null || word.time<next) }
                && (line.end==null || (line.words.lastOrNull()?.time ?: line.time)<=line.end && (next==null || line.end<=next))
            if(valid) line else line.copy(words=emptyList(),end=null)
        } }
    }
}

class LyricsRepository(private val app: OpenfyApplication) {
    suspend fun resolve(song: Song, refresh: Boolean = false): LyricsRow = withContext(Dispatchers.IO) {
        val dao=app.database.library()
        val previous=dao.lyrics(song.id)
        if(previous!=null && !refresh && previous.expiresAt>System.currentTimeMillis()) return@withContext previous
        val embedded=song.path?.let { EmbeddedLyrics.read(File(it)) }
        val embeddedLines=embedded?.let(Lrc::parse).orEmpty()
        if(embeddedLines.isNotEmpty()) return@withContext store(song.id,"synced",embedded!!,embeddedLines,"embedded")
        try {
            val url="https://lrclib.net/api/get".toHttpUrl().newBuilder()
                .addQueryParameter("track_name",song.title).addQueryParameter("artist_name",song.artist)
                .addQueryParameter("album_name",song.album).addQueryParameter("duration",(song.duration/1000).toString()).build()
            val response=app.http.newCall(Request.Builder().url(url).header("User-Agent","Openfy/0.5.1").build()).execute().use {
                if(it.code==404) null else { check(it.isSuccessful) { "Lyrics unavailable" }; Json.parseToJsonElement(it.body!!.string()).jsonObject }
            }
            val synced=response?.get("syncedLyrics")?.jsonPrimitive?.contentOrNull
            if(!synced.isNullOrBlank()) return@withContext store(song.id,"synced",synced,Lrc.parse(synced),"lrclib")
            if(embedded!=null) return@withContext store(song.id,"plain",embedded,emptyList(),"embedded")
            if(response?.get("instrumental")?.jsonPrimitive?.booleanOrNull==true) return@withContext store(song.id,"instrumental","",emptyList(),"lrclib")
            val plain=response?.get("plainLyrics")?.jsonPrimitive?.contentOrNull
            if(!plain.isNullOrBlank()) return@withContext store(song.id,"plain",plain,emptyList(),"lrclib")
            if(song.source=="youtube") {
                val fallback=app.provider.call("lyrics",buildJsonObject { put("id",song.id.removePrefix("youtube:")) })
                val value=fallback["plainText"]?.jsonPrimitive?.content.orEmpty()
                if(value.isNotBlank()) return@withContext store(song.id,"plain",value,emptyList(),"youtube")
            }
            store(song.id,"not_found","",emptyList(),"")
        } catch(error: Exception) {
            if(error is kotlinx.coroutines.CancellationException) throw error
            if(embedded!=null) return@withContext store(song.id,"plain",embedded,emptyList(),"embedded")
            // A temporary failure is not cached as a verified absence.
            previous ?: LyricsRow(song.id,"error",plainText="No se pudieron consultar las letras. Reintenta cuando tengas conexión.")
        }
    }
    private suspend fun store(id: String, status: String, text: String, lines: List<LyricsLine>, source: String): LyricsRow {
        val now=System.currentTimeMillis()
        val result=LyricsRow(id,status,if(lines.isEmpty()) text else lines.joinToString("\n") { it.text },
            Json.encodeToString(lines),source,now,now+if(status=="not_found") 86400000L else 30*86400000L)
        app.database.library().putLyrics(result); return result
    }
}

/** Bounded tag readers; never load the audio body just to find lyrics. */
object EmbeddedLyrics {
    fun read(file: File): String? = runCatching {
        when(file.extension.lowercase()) { "mp3","aac" -> id3(file); "flac" -> flac(file); "m4a" -> mp4(file); else -> null }
    }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    private fun size(bytes: ByteArray, sync: Boolean = false): Int = bytes.fold(0) { n,b -> (n shl if(sync) 7 else 8) or (b.toInt() and if(sync) 127 else 255) }
    private fun id3(file: File): String? = java.io.RandomAccessFile(file,"r").use { input ->
        val header=ByteArray(10); input.readFully(header)
        if(String(header,0,3)!="ID3") return null
        val version=header[3].toInt(); val end=minOf(file.length(),10L+size(header.copyOfRange(6,10),true),4L*1024*1024)
        if(header[5].toInt() and 64 != 0) return null
        var plain: String?=null
        while(input.filePointer+10<=end) {
            val tag=ByteArray(10); input.readFully(tag); val length=size(tag.copyOfRange(4,8),version==4)
            if(length<=0 || input.filePointer+length>end) break
            if(String(tag,0,4)=="USLT") {
                val bytes=ByteArray(length); input.readFully(bytes)
                val charset=when(bytes[0].toInt()) { 1 -> Charsets.UTF_16; 2 -> Charsets.UTF_16BE; 3 -> Charsets.UTF_8; else -> Charsets.ISO_8859_1 }
                val decoded=String(bytes,4,bytes.size-4,charset)
                plain=decoded.substringAfter('\u0000',decoded)
            } else if(String(tag,0,4)=="SYLT") {
                val bytes=ByteArray(length); input.readFully(bytes)
                synchronizedId3(bytes)?.let { return it }
            } else {
                input.seek(input.filePointer+length)
            }
        }; plain
    }
    private fun synchronizedId3(bytes: ByteArray): String? {
        if(bytes.size<8 || bytes[4].toInt()!=2) return null
        val encoding=bytes[0].toInt()
        val charset=when(encoding) { 1 -> Charsets.UTF_16; 2 -> Charsets.UTF_16BE; 3 -> Charsets.UTF_8; else -> Charsets.ISO_8859_1 }
        val terminator=if(encoding in 1..2) 2 else 1
        var at=6
        fun text(): String {
            val start=at
            while(at+terminator<=bytes.size && !(bytes[at]==0.toByte() && (terminator==1 || bytes[at+1]==0.toByte()))) at+=terminator
            val result=String(bytes,start,at-start,charset)
            at+=terminator
            return result
        }
        text() // descriptor
        val entries=mutableListOf<Pair<Long,String>>()
        while(at<bytes.size) {
            val value=text()
            if(at+4>bytes.size) break
            val time=size(bytes.copyOfRange(at,at+4)).toLong() and 0xffffffffL; at+=4
            entries+=time to value
        }
        if(entries.isEmpty()) return null
        fun stamp(ms: Long)=String.format(java.util.Locale.US,"%02d:%02d.%03d",ms/60000,ms/1000%60,ms%1000)
        val breaks=entries.count { it.second.contains('\n') }
        val fragments=breaks>0 && breaks<entries.size*.7 && entries.any { !it.second.contains('\n') && it.second.isNotBlank() }
        if(!fragments) return entries.joinToString("\n") { "[${stamp(it.first)}]${it.second}" }
        val lines=mutableListOf<String>(); var line=StringBuilder(); var start=0L
        fun flush() { if(line.isNotEmpty()) { lines+="[${stamp(start)}]$line"; line=StringBuilder() } }
        entries.forEach { (time,value) -> value.split('\n').forEachIndexed { index,part ->
            if(index>0) flush()
            if(part.isNotEmpty() || value.isEmpty()) { if(line.isEmpty()) start=time; line.append("<${stamp(time)}>$part") }
        } }
        flush(); return lines.joinToString("\n")
    }
    private fun flac(file: File): String? = java.io.RandomAccessFile(file,"r").use { input ->
        val signature=ByteArray(4); input.readFully(signature); if(String(signature)!="fLaC") return null
        while(input.filePointer+4<file.length()) {
            val flag=input.readUnsignedByte(); val length=(input.readUnsignedByte() shl 16) or (input.readUnsignedByte() shl 8) or input.readUnsignedByte()
            if(length>4*1024*1024) return null
            if(flag and 127 == 4) {
                val bytes=ByteArray(length); input.readFully(bytes)
                val data=java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                val vendor=data.int; if(vendor<0 || vendor>data.remaining()) return null; data.position(data.position()+vendor)
                val count=data.int
                repeat(count.coerceIn(0,10000)) {
                    val n=data.int; if(n<0 || n>data.remaining()) return null
                    val value=ByteArray(n); data.get(value); val tag=String(value,Charsets.UTF_8)
                    if(tag.substringBefore('=').uppercase() in setOf("LYRICS","UNSYNCEDLYRICS")) return tag.substringAfter('=')
                }
            } else input.seek(input.filePointer+length)
            if(flag and 128 != 0) break
        }; null
    }
    private fun mp4(file: File): String? = java.io.RandomAccessFile(file,"r").use { input ->
        fun atoms(end: Long, depth: Int): String? {
            if(depth>8) return null
            while(input.filePointer+8<=end) {
                val start=input.filePointer; var length=input.readInt().toLong() and 0xffffffffL
                val type=ByteArray(4); input.readFully(type); val name=String(type,Charsets.ISO_8859_1)
                if(length==1L) length=input.readLong()
                if(length<8 || start+length>end) return null
                if(name in setOf("moov","udta","meta","ilst","©lyr")) {
                    if(name=="meta") input.skipBytes(4)
                    if(name=="©lyr") {
                        if(length<=1024*1024) {
                            input.skipBytes(16); val bytes=ByteArray((start+length-input.filePointer).toInt()); input.readFully(bytes)
                            return String(bytes,Charsets.UTF_8)
                        }
                    } else atoms(start+length,depth+1)?.let { return it }
                }
                input.seek(start+length)
            }; return null
        }; atoms(input.length(),0)
    }
}
