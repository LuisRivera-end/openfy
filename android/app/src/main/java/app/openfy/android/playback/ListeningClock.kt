package app.openfy.android.playback

import java.time.Instant
import java.time.ZoneId

/** Count only an advancing audible clock; discontinuities must call reset(). */
class ListeningClock {
    private var position = 0L
    private var clock = 0L
    private var wall = 0L
    private var audible = false
    var listenedMs = 0L; private set
    var qualified = false; private set
    fun reset(positionMs: Long, monotonicMs: Long, at: Long, playing: Boolean) {
        position=positionMs; clock=monotonicMs; wall=at; audible=playing
    }
    fun sample(positionMs: Long, durationMs: Long, monotonicMs: Long, at: Long, playing: Boolean): Pair<Map<String,Long>,Boolean> {
        val advance=positionMs-position
        val elapsed=(monotonicMs-clock).coerceAtLeast(0)
        val amount=if(audible && advance in 0..elapsed+250) minOf(advance,elapsed) else 0
        val days=mutableMapOf<String,Long>()
        var start=maxOf(wall,at-amount)
        while(start<at && amount>0) {
            val date=Instant.ofEpochMilli(start).atZone(ZONE).toLocalDate()
            val midnight=date.plusDays(1).atStartOfDay(ZONE).toInstant().toEpochMilli()
            val end=minOf(at,midnight)
            days[date.toString()]=(days[date.toString()] ?: 0)+(end-start)
            start=end
        }
        listenedMs += days.values.sum()
        val counted=!qualified && durationMs>0 && listenedMs>=durationMs*.9
        if(counted) qualified=true
        reset(positionMs,monotonicMs,at,playing)
        return days to counted
    }
    companion object { val ZONE: ZoneId = ZoneId.of("America/Mexico_City") }
}
