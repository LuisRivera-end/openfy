package app.openfy.android

import app.openfy.android.ui.MotionRepository
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class MotionArtistTest {

    @Test
    fun artistKey_prefixesWithNamespaceAndNormalizes() {
        val evidence = listOf("Cosa Nuestra", "Playá Saturno - Single")
        val key = MotionRepository.artistKey("Ráuw Alejandro", "UC-a", evidence)
        assertEquals(key, MotionRepository.artistKey("Rauw Alejandro", "UC-a", listOf("Playa Saturno", "Cosa Nuestra", "Cosa Nuestra")))
        assertNotEquals(key, MotionRepository.artistKey("Rauw Alejandro", "UC-b", evidence))
        assertNotEquals(key, MotionRepository.artistKey("Rauw Alejandro", "UC-a", listOf("Other release")))
        assertNotEquals(key, MotionRepository.key("artist", "Rauw Alejandro"))
    }

    @Test
    fun matchArtist_exactNormalizedMatching() {
        // Normal matching
        assertTrue(MotionRepository.matchArtist("Bad Bunny", "Bad Bunny"))
        assertTrue(MotionRepository.matchArtist("bad bunny", "BAD BUNNY"))
        assertTrue(MotionRepository.matchArtist("  Bad   Bunny  ", "bad bunny"))

        // Accents / diacritics
        assertTrue(MotionRepository.matchArtist("Beyoncé", "Beyonce"))
        assertTrue(MotionRepository.matchArtist("Rosalía", "Rosalia"))

        // Feat / featuring stripped in normalize
        assertTrue(MotionRepository.matchArtist("Bizarrap", "Bizarrap (feat. Shakira)"))

        // Symbols
        assertTrue(MotionRepository.matchArtist("¥$", "¥$"))

        // Non-matches
        assertFalse(MotionRepository.matchArtist("Drake", "Kendrick Lamar"))
        assertFalse(MotionRepository.matchArtist("Bad Bunny", "Bad"))
        assertFalse(MotionRepository.matchArtist("", "Bad Bunny"))
    }

    @Test
    fun matchesAnyAlbum_matchesAtLeastOneAlbumIgnoringSingleAndEp() {
        val ytAlbums = listOf("Un Verano Sin Ti", "YHLQMDLG")
        val appleAlbums = listOf("Un Verano Sin Ti", "Oasis", "X 100PRE")
        assertTrue(MotionRepository.matchesAnyAlbum(ytAlbums, appleAlbums))

        // Single suffix ignored
        val ytSingles = listOf("Flowers - Single")
        val appleSingles = listOf("Flowers")
        assertTrue(MotionRepository.matchesAnyAlbum(ytSingles, appleSingles))

        // EP suffix ignored
        val ytEps = listOf("My Heart - EP")
        val appleEps = listOf("My Heart")
        assertTrue(MotionRepository.matchesAnyAlbum(ytEps, appleEps))

        // Case and accents
        val ytAccents = listOf("El Último Tour Del Mundo")
        val appleAccents = listOf("el ultimo tour del mundo")
        assertTrue(MotionRepository.matchesAnyAlbum(ytAccents, appleAccents))

        // No matches
        val ytDifferent = listOf("Album X", "Album Y")
        val appleDifferent = listOf("Album A", "Album B")
        assertFalse(MotionRepository.matchesAnyAlbum(ytDifferent, appleDifferent))

        // Empty lists
        assertFalse(MotionRepository.matchesAnyAlbum(emptyList(), appleAlbums))
        assertFalse(MotionRepository.matchesAnyAlbum(ytAlbums, emptyList()))
    }

    @Test
    fun pickArtistVideoKey_selectsWideOrFullscreenOrNull() {
        // Both wide and fullscreen: wide is preferred
        val both = buildJsonObject {
            put("motionArtistWide16x9", buildJsonObject {
                put("video", "https://example.apple.com/wide.m3u8")
            })
            put("motionArtistFullscreen16x9", buildJsonObject {
                put("video", "https://example.apple.com/fullscreen.m3u8")
            })
        }
        assertEquals("motionArtistWide16x9", MotionRepository.pickArtistVideoKey(both))

        // Only fullscreen
        val fullscreenOnly = buildJsonObject {
            put("motionArtistFullscreen16x9", buildJsonObject {
                put("video", "https://example.apple.com/fullscreen.m3u8")
            })
        }
        assertEquals("motionArtistFullscreen16x9", MotionRepository.pickArtistVideoKey(fullscreenOnly))

        // Missing video address or empty
        val emptyAddress = buildJsonObject {
            put("motionArtistWide16x9", buildJsonObject {
                put("video", "")
            })
        }
        assertNull(MotionRepository.pickArtistVideoKey(emptyAddress))

        // Neither present
        val neither = buildJsonObject {
            put("motionSquareVideo1x1", buildJsonObject {
                put("video", "https://example.apple.com/square.m3u8")
            })
        }
        assertNull(MotionRepository.pickArtistVideoKey(neither))
    }

    @Test
    fun selectArtistCandidate_singleReadyCandidateMatches() {
        val ytAlbums = listOf("Motomami", "El Mal Querer")
        val wideVideo = buildJsonObject {
            put("motionArtistWide16x9", buildJsonObject {
                put("video", "https://example.apple.com/video.m3u8")
            })
        }

        val candidate1WrongName = MotionRepository.ArtistCandidate(
            id = "1",
            name = "Rauw Alejandro",
            albumNames = listOf("Motomami"),
            editorialVideo = wideVideo
        )
        val candidate2NoAlbumMatch = MotionRepository.ArtistCandidate(
            id = "2",
            name = "Rosalía",
            albumNames = listOf("Los Ángeles"),
            editorialVideo = wideVideo
        )
        val candidate3Match = MotionRepository.ArtistCandidate(
            id = "3",
            name = "Rosalia",
            albumNames = listOf("Motomami - Single", "El Mal Querer"),
            editorialVideo = wideVideo
        )

        val result = MotionRepository.selectArtistCandidate(
            "Rosalía",
            ytAlbums,
            listOf(candidate1WrongName, candidate2NoAlbumMatch, candidate3Match)
        )

        assertNotNull(result)
        assertEquals("3", result!!.first.id)
        assertEquals("motionArtistWide16x9", result.second)

        val eval = MotionRepository.evaluateArtistCandidates(
            "Rosalía",
            ytAlbums,
            listOf(candidate1WrongName, candidate2NoAlbumMatch, candidate3Match)
        )
        assertTrue(eval is MotionRepository.ArtistCandidateResult.Ready)
    }

    @Test
    fun evaluateArtistCandidates_ambiguousNamesakesYieldsUnmatched() {
        val ytAlbums = listOf("Motomami", "El Mal Querer")
        val wideVideo = buildJsonObject {
            put("motionArtistWide16x9", buildJsonObject {
                put("video", "https://example.apple.com/video.m3u8")
            })
        }

        // Two candidates matching name and at least one release: one ready, one without video
        val candidate1Ready = MotionRepository.ArtistCandidate(
            id = "1",
            name = "Rosalia",
            albumNames = listOf("Motomami"),
            editorialVideo = wideVideo
        )
        val candidate2NoVideo = MotionRepository.ArtistCandidate(
            id = "2",
            name = "Rosalía",
            albumNames = listOf("El Mal Querer"),
            editorialVideo = null
        )

        val eval1 = MotionRepository.evaluateArtistCandidates(
            "Rosalía",
            ytAlbums,
            listOf(candidate1Ready, candidate2NoVideo)
        )
        assertEquals(MotionRepository.ArtistCandidateResult.Unmatched, eval1)
        assertNull(MotionRepository.selectArtistCandidate("Rosalía", ytAlbums, listOf(candidate1Ready, candidate2NoVideo)))

        // Two candidates both ready
        val candidate3AlsoReady = MotionRepository.ArtistCandidate(
            id = "3",
            name = "Rosalía",
            albumNames = listOf("Motomami - Single"),
            editorialVideo = wideVideo
        )
        val eval2 = MotionRepository.evaluateArtistCandidates(
            "Rosalía",
            ytAlbums,
            listOf(candidate1Ready, candidate3AlsoReady)
        )
        assertEquals(MotionRepository.ArtistCandidateResult.Unmatched, eval2)
        assertNull(MotionRepository.selectArtistCandidate("Rosalía", ytAlbums, listOf(candidate1Ready, candidate3AlsoReady)))
    }

    @Test
    fun evaluateArtistCandidates_onlyVerifiedWithoutVideoYieldsNone() {
        val ytAlbums = listOf("Motomami")
        val candidateNoVideo = MotionRepository.ArtistCandidate(
            id = "1",
            name = "Rosalía",
            albumNames = listOf("Motomami"),
            editorialVideo = null
        )

        val eval = MotionRepository.evaluateArtistCandidates(
            "Rosalía",
            ytAlbums,
            listOf(candidateNoVideo)
        )
        assertEquals(MotionRepository.ArtistCandidateResult.None, eval)
        assertNull(MotionRepository.selectArtistCandidate("Rosalía", ytAlbums, listOf(candidateNoVideo)))
    }

    @Test
    fun evaluateArtistCandidates_noAlbumMatchYieldsUnmatched() {
        val ytAlbums = listOf("Motomami")
        val candidateWrongAlbum = MotionRepository.ArtistCandidate(
            id = "1",
            name = "Rosalía",
            albumNames = listOf("Los Ángeles"),
            editorialVideo = null
        )

        val eval = MotionRepository.evaluateArtistCandidates(
            "Rosalía",
            ytAlbums,
            listOf(candidateWrongAlbum)
        )
        assertEquals(MotionRepository.ArtistCandidateResult.Unmatched, eval)
        assertNull(MotionRepository.selectArtistCandidate("Rosalía", ytAlbums, listOf(candidateWrongAlbum)))
    }
}
