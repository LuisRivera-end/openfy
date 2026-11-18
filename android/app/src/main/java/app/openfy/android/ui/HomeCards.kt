@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package app.openfy.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.openfy.android.data.RecentContext
import app.openfy.android.data.Song
import kotlinx.coroutines.CancellationException

private val quickTileSize = 56.dp
private val featureWidth = 260.dp
private val featureHeight = 325.dp
private val collectionSize = 156.dp
private val featureArtistColor = Color(0xffd4d4d8)

@Composable
internal fun HomeRail(content: LazyListScope.() -> Unit) {
    val state = rememberLazyListState()
    LazyRow(
        state = state,
        contentPadding = PaddingValues(horizontal = Gutter),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        flingBehavior = rememberSnapFlingBehavior(state, snapPosition = SnapPosition.Start),
        content = content,
    )
}

@Composable
internal fun HomeQuickAccess(tiles: List<RecentContext>, open: (RecentContext) -> Unit) {
    Column(
        Modifier.padding(start = Gutter, end = Gutter, top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        tiles.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { tile ->
                    key(tile.homeKey) {
                        Row(
                            Modifier.weight(1f).height(quickTileSize).clip(RoundedCornerShape(Radii.tile))
                                .background(Raised).clickable(role = Role.Button) { open(tile) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            val cover = Modifier.size(quickTileSize)
                            if (tile.kind == "favorites") FavoritesCover(cover, quickTileSize)
                            else Cover(tile.artwork, cover, quickTileSize, background = Raised)
                            Text(
                                tile.title,
                                Modifier.weight(1f).padding(horizontal = 10.dp),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
internal fun HomeSuggestionPlaceholder() {
    Box(Modifier.size(featureWidth, featureHeight).clip(RoundedCornerShape(Radii.feature)).background(Raised))
}

@Composable
internal fun HomeSuggestionCard(song: Song, current: Boolean, play: () -> Unit, more: () -> Unit) {
    val context = LocalContext.current
    val coverPixels = with(LocalDensity.current) { featureWidth.roundToPx().coerceAtLeast(780) }
    val dominant by key(song.artwork) {
        produceState<Int?>(null, context, song.artwork) {
            value = try {
                CoverPalette.dominant(context, song.artwork)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                null
            }
        }
    }
    Column(
        Modifier.size(featureWidth, featureHeight).clip(RoundedCornerShape(Radii.feature))
            .combinedClickable(role = Role.Button, onClick = play, onLongClick = more, onLongClickLabel = "Opciones de canción")
            .semantics { if (current) stateDescription = "Canción actual" },
    ) {
        Box(Modifier.size(featureWidth)) {
            Cover(song.artwork, Modifier.matchParentSize(), coverPixels, background = Raised)
            if (current) {
                Box(
                    Modifier.align(Alignment.TopEnd).padding(10.dp).size(20.dp)
                        .background(Ink, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(8.dp).background(Green, CircleShape))
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().height(featureHeight - featureWidth)
                .background(Color(CoverPalette.surface(dominant))).padding(12.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(song.title, color = TextColor, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(song.artist, color = featureArtistColor, style = MaterialTheme.typography.bodySmall,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
internal fun HomeContextCard(context: RecentContext, open: () -> Unit) {
    val subtitle = when (context.kind) {
        "playlist" -> "Playlist"
        "album" -> "Álbum"
        "artist" -> "Artista"
        "favorites" -> "Tus favoritas"
        else -> context.subtitle
    }
    HomeCollectionCard(context.title, subtitle, context.artwork,
        favorite = context.kind == "favorites", artist = context.kind == "artist", open = open)
}

@Composable
internal fun HomeCollectionCard(
    title: String,
    subtitle: String,
    artwork: String?,
    favorite: Boolean = false,
    artist: Boolean = false,
    open: () -> Unit,
    more: (() -> Unit)? = null,
) {
    val shape = if (artist) CircleShape else RoundedCornerShape(Radii.card)
    val interaction = if (more == null) Modifier.clickable(role = Role.Button, onClick = open)
        else Modifier.combinedClickable(role = Role.Button, onClick = open, onLongClick = more, onLongClickLabel = "Opciones de canción")
    Column(Modifier.width(collectionSize).then(interaction)) {
        val cover = Modifier.size(collectionSize).clip(shape)
        if (favorite) FavoritesCover(cover, collectionSize)
        else Cover(artwork, cover, collectionSize, background = Raised)
        Spacer(Modifier.height(8.dp))
        Text(title, style = MaterialTheme.typography.titleSmall.copy(fontSize = 14.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (subtitle.isNotEmpty()) {
            Text(subtitle, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
