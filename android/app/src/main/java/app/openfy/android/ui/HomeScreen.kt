package app.openfy.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.RecentContext
import app.openfy.android.data.Song
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// Retain the existing scaffold call during the parallel screen changes.
@Suppress("UNUSED_PARAMETER")
internal fun LazyListScope.homeItems(
    vm: OpenfyViewModel,
    listening: List<ListeningRow>,
    recents: List<RecentContext>,
    songMap: Map<String, Song>,
    currentId: String?,
    stats: Map<String, List<ListeningRow>>,
    period: String,
    onPeriod: (String) -> Unit,
    suggestions: List<Song>,
    releases: List<JsonObject>,
    importFiles: () -> Unit,
    onSongActions: (Song) -> Unit,
) {
    val library = vm.library.value
    val hasFavorites = songMap.values.any { it.favorite }
    val playlists = library.homePlaylists
    val quick = quickAccess(hasFavorites, recents, playlists)
    if (quick.isNotEmpty()) {
        item(key = "home:quick-access", contentType = "home-grid") {
            HomeQuickAccess(quick, vm::openRecent)
        }
    }

    val year = homeYear()
    val currentReleases = currentYearReleases(releases, year)
    val collections = (listOfNotNull(homeFavorites.takeIf { hasFavorites }) + playlists).take(12)
    item(key = "home:suggestions", contentType = "home-suggestions") {
        val loading by vm.recommendationsLoading.collectAsStateWithLifecycle()
        val failed by vm.recommendationsFailed.collectAsStateWithLifecycle()
        if (suggestions.isNotEmpty() || loading || failed) {
            HomeSuggestions(suggestions, currentId, loading, failed, quick.isNotEmpty(),
                refresh = { vm.discover(force = true) }, play = { vm.play(it, suggestions) }, onSongActions = onSongActions)
        }
        if (library.ready && songMap.isEmpty() && recents.isEmpty() && suggestions.isEmpty() &&
            currentReleases.isEmpty() && collections.isEmpty() && !loading
        ) {
            HomeEmpty(search = { vm.selectTab(1) }, importFiles = importFiles)
        }
    }

    if (currentReleases.isNotEmpty()) {
        item(key = "home:releases", contentType = "home-shelf") {
            HomeShelf("Lanzamientos de $year") {
                items(currentReleases, key = { requireNotNull(it.homeAlbumId) }, contentType = { "album" }) { album ->
                    val id = requireNotNull(album.homeAlbumId)
                    val title = (album["title"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                    val artist = (album["artists"] as? JsonArray).orEmpty().mapNotNull { entry ->
                        ((entry as? JsonObject)?.get("name") as? JsonPrimitive)?.contentOrNull
                    }.joinToString(", ")
                    HomeCollectionCard(title, artist, (album["artwork"] as? JsonPrimitive)?.contentOrNull,
                        open = { vm.openRemote("album", id, title) })
                }
            }
        }
    }

    val recentSongs = library.recentSongs
    if (recents.isNotEmpty() || recentSongs.isNotEmpty()) {
        item(key = "home:recent", contentType = "home-shelf") {
            HomeShelf("Escuchado recientemente") {
                if (recents.isNotEmpty()) {
                    items(recents, key = { it.homeKey }, contentType = { it.kind }) { recent ->
                        HomeContextCard(recent, open = { vm.openRecent(recent) })
                    }
                } else {
                    items(recentSongs, key = { it.id }, contentType = { "song" }) { song ->
                        HomeCollectionCard(song.title, song.artist, song.artwork,
                            open = { vm.play(song, recentSongs) }, more = { onSongActions(song) })
                    }
                }
            }
        }
    }

    if (collections.isNotEmpty()) {
        item(key = "home:collections", contentType = "home-shelf") {
            HomeShelf("Tus favoritas y playlists") {
                items(collections, key = { it.homeKey }, contentType = { it.kind }) { collection ->
                    HomeContextCard(collection, open = { vm.openRecent(collection) })
                }
            }
        }
    }
}

@Composable
private fun HomeShelf(title: String, content: LazyListScope.() -> Unit) {
    Column(Modifier.padding(top = SectionGap)) {
        HomeHeading(title, Modifier.padding(start = Gutter, end = Gutter, bottom = 12.dp))
        HomeRail(content = content)
    }
}

@Composable
private fun HomeHeading(title: String, modifier: Modifier = Modifier) {
    Text(title, modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge,
        maxLines = 2, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun HomeSuggestions(
    songs: List<Song>,
    currentId: String?,
    loading: Boolean,
    failed: Boolean,
    followsQuickAccess: Boolean,
    refresh: () -> Unit,
    play: (Song) -> Unit,
    onSongActions: (Song) -> Unit,
) {
    Column(Modifier.padding(top = if (followsQuickAccess) SectionGap else 8.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Gutter).heightIn(min = 48.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeHeading("Sugerencias para ti", Modifier.weight(1f))
            when {
                loading -> Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        Modifier.size(20.dp).semantics { contentDescription = "Actualizando sugerencias" },
                        strokeWidth = 2.dp,
                    )
                }
                failed -> TextButton(onClick = refresh, modifier = Modifier.heightIn(min = 48.dp)) { Text("Reintentar") }
                else -> ActionIcon(Icons.Default.Refresh, "Actualizar sugerencias", action = refresh)
            }
        }
        if (songs.isNotEmpty() || loading) {
            Spacer(Modifier.height(4.dp))
            HomeRail {
                if (songs.isNotEmpty()) {
                    items(songs, key = { it.id }, contentType = { "recommendation" }) { song ->
                        HomeSuggestionCard(song, song.id == currentId, play = { play(song) }, more = { onSongActions(song) })
                    }
                } else {
                    items(3, key = { "placeholder:$it" }, contentType = { "recommendation-placeholder" }) {
                        HomeSuggestionPlaceholder()
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HomeEmpty(search: () -> Unit, importFiles: () -> Unit) {
    Column(Modifier.padding(horizontal = Gutter).padding(top = SectionGap), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HomeHeading("Empieza con tu música")
        Text("Busca canciones o importa tus archivos.", color = Muted, style = MaterialTheme.typography.bodyMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = search, modifier = Modifier.heightIn(min = 48.dp)) { Text("Buscar música") }
            OutlinedButton(onClick = importFiles, modifier = Modifier.heightIn(min = 48.dp), border = BorderStroke(1.dp, Muted)) {
                Text("Importar archivos")
            }
        }
    }
}
