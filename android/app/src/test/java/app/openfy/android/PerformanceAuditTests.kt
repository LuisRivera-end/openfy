package app.openfy.android

import app.openfy.android.data.RecentContext
import app.openfy.android.playback.ListeningBatcher
import app.openfy.android.playback.QueueSnapshotState
import app.openfy.android.ui.MotionRepository
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class PerformanceAuditTests {

    @Test
    fun listeningBatchingLosesNoMilliseconds() {
        val batcher = ListeningBatcher()
        assertEquals(0L, batcher.pending.values.sumOf { it.listenedMs })
        assertTrue(batcher.isEmpty)

        // 1. Accumulate 15 seconds of 1000ms samples at 1-second intervals
        var now = 1000L
        for (sec in 1..15) {
            batcher.accumulate(mapOf("2026-11-19" to 1000L), "song-1", counted = false, at = now, null)
            val shouldFlush = batcher.shouldFlush(counted = false, nowMonotonic = now, force = false)
            if (sec < 15) {
                assertFalse("Should not flush before 15s at sec=$sec", shouldFlush)
            } else {
                assertTrue("Should flush at 15s", shouldFlush)
            }
            now += 1000L
        }

        // Drain at 15s
        val (flushed1, recent1) = batcher.drain(now)
        assertNull(recent1)
        assertEquals(1, flushed1.size)
        val entry1 = flushed1["2026-11-19:song-1"]
        assertNotNull(entry1)
        assertEquals(15000L, entry1!!.listenedMs)
        assertEquals(0, entry1.plays)
        assertTrue(batcher.isEmpty)

        // 2. Cross-day accumulation
        val crossDay = mapOf("2026-11-19" to 400L, "2026-11-20" to 600L)
        batcher.accumulate(crossDay, "song-2", counted = false, at = now, null)
        assertFalse(batcher.isEmpty)
        val (flushed2, _) = batcher.drain(now)
        assertEquals(2, flushed2.size)
        assertEquals(400L, flushed2["2026-11-19:song-2"]?.listenedMs)
        assertEquals(600L, flushed2["2026-11-20:song-2"]?.listenedMs)
        assertEquals(1000L, flushed2.values.sumOf { it.listenedMs })

        // 3. Counted = true triggers immediate flush
        batcher.accumulate(mapOf("2026-11-20" to 1000L), "song-3", counted = true, at = now, null)
        assertTrue("Counted listen must trigger immediate flush", batcher.shouldFlush(counted = true, nowMonotonic = now))
        val (flushed3, _) = batcher.drain(now)
        assertEquals(1, flushed3["2026-11-20:song-3"]?.plays)
        assertEquals(1000L, flushed3["2026-11-20:song-3"]?.listenedMs)

        // 4. Restore on failure loses no milliseconds
        batcher.accumulate(mapOf("2026-11-20" to 5000L), "song-4", counted = false, at = now, RecentContext("album", "a1", "Album 1"))
        val (failedBatch, failedRecent) = batcher.drain(now)
        // More listening happens while DB write failed
        batcher.accumulate(mapOf("2026-11-20" to 3000L), "song-4", counted = false, at = now + 3000L, null)
        // Restore failed batch
        batcher.restore(failedBatch, failedRecent)
        val (restored, restoredRecent) = batcher.drain(now + 3000L)
        assertEquals(8000L, restored["2026-11-20:song-4"]?.listenedMs)
        assertNotNull(restoredRecent)
        assertEquals("Album 1", restoredRecent?.title)
    }

    @Test
    fun persistDedupe() {
        val s1 = QueueSnapshotState(
            count = 2, index = 0, position = 1200L, repeat = 0, shuffle = false,
            queueIds = listOf("s1", "s2"), contexts = listOf("{\"title\":\"C1\"}", "{\"title\":\"C2\"}")
        )
        val sIdentical = QueueSnapshotState(
            count = 2, index = 0, position = 1200L, repeat = 0, shuffle = false,
            queueIds = listOf("s1", "s2"), contexts = listOf("{\"title\":\"C1\"}", "{\"title\":\"C2\"}")
        )
        // When unchanged and paused:
        assertTrue("Identical snapshot must be recognized", s1.isIdentical(sIdentical))

        // When playing (position advances):
        val sPlaying = s1.copy(position = 6200L)
        assertFalse("Different position is not identical", s1.isIdentical(sPlaying))
        assertTrue("Queue and contexts match, contexts can be reused", s1.hasSameQueueAndContexts(sPlaying))

        // When track advances:
        val sNextTrack = s1.copy(index = 1, position = 0L)
        assertFalse(s1.isIdentical(sNextTrack))
        assertTrue("Queue and contexts still match across track change in same queue", s1.hasSameQueueAndContexts(sNextTrack))

        // When queue changes:
        val sQueueChanged = s1.copy(queueIds = listOf("s1", "s3"))
        assertFalse(s1.isIdentical(sQueueChanged))
        assertFalse("Modified queue items must trigger full rebuild", s1.hasSameQueueAndContexts(sQueueChanged))
    }

    @Test
    fun streamingTokenScanAcrossChunkBoundary() {
        // Valid JWT with expiration far in future
        val header = "eyJhbGciOiJFUzI1NiJ9"
        // {"exp": 2000000000} in base64url is eyJleHAiOjIwMDAwMDAwMDB9
        val payload = "eyJleHAiOjIwMDAwMDAwMDB9"
        val signature = "abcdefghijklmnopqrstuvwxyz0123456789-_ABCDEFGHIJKLMN"
        val validToken = "$header.$payload.$signature"

        // Build a payload where padding puts the token across a 32-byte chunk boundary
        // e.g. 25 bytes of prefix, token is ~90 bytes, then 50 bytes of trailing content
        val prefix = "var __cfg = { token: \""
        val suffix = "\" }; // extra bundle content that extends beyond the token"
        val bundleContent = prefix + validToken + suffix
        val stream = ByteArrayInputStream(bundleContent.toByteArray(Charsets.ISO_8859_1))

        // Scan with chunkSize = 32 and overlapSize = 128 (token is ~99 chars)
        val found = MotionRepository.findTokenInStream(
            input = stream,
            limit = 32 * 1024 * 1024,
            chunkSize = 32,
            overlapSize = 128,
            minimumExpiry = 1000L
        )
        assertEquals("Token crossing 32-byte boundary must be completely recovered", validToken, found)

        // Verify expired token before valid token is skipped
        // {"exp": 1000} in base64url is eyJleHAiOjEwMDB9 (exp * 1000 = 1_000_000 ms)
        val expiredToken = "$header.eyJleHAiOjEwMDB9.$signature"
        val streamWithExpired = ByteArrayInputStream(("/* old */ \"$expiredToken\"; /* current */ \"$validToken\"").toByteArray(Charsets.ISO_8859_1))
        val foundAfterExpired = MotionRepository.findTokenInStream(
            input = streamWithExpired,
            limit = 32 * 1024 * 1024,
            chunkSize = 32,
            overlapSize = 128,
            minimumExpiry = 5_000_000L
        )
        assertEquals("Expired token must be skipped in favor of valid token", validToken, foundAfterExpired)

        // Verify limit enforcement: if limit is smaller than token start, returns null
        val shortStream = ByteArrayInputStream(bundleContent.toByteArray(Charsets.ISO_8859_1))
        val notFound = MotionRepository.findTokenInStream(
            input = shortStream,
            limit = 10,
            chunkSize = 32,
            overlapSize = 64,
            minimumExpiry = 1000L
        )
        assertNull("Stream exceeding size cap before token must return null", notFound)
    }
}
