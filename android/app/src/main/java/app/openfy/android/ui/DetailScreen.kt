@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package app.openfy.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.openfy.android.data.ListeningRow
import app.openfy.android.data.PlaylistRow
import app.openfy.android.data.Song
import kotlinx.serialization.json.*
import kotlin.math.roundToInt

internal fun LazyListScope.detailItems(
    vm: OpenfyViewModel,detail: DetailState,playlist: PlaylistRow?,tracks: List<Song>,
    songMap: Map<String,Song>,currentId: String?,stats: Map<String,List<ListeningRow>>,period: String,onPeriod: (String)->Unit,
    query: String,onQuery: (String)->Unit,onFilters: ()->Unit,requestNotifications: ()->Unit,
    onRename: (PlaylistRow)->Unit,onDelete: (PlaylistRow)->Unit,onSongActions: (Song)->Unit,
    fullTracks: List<Song>,filtersActive: Boolean,onClearFilters: ()->Unit,onHeroTitleMeasured: (Int)->Unit,
    heroTopPadding: Dp,updateNotice: (@Composable ()->Unit)?,
    albumYear: Int? = null,albumArtist: String? = null,artistColors: ArtistPageColors? = null,
    albumTint: AlbumTintColors? = null,albumPresentation: AlbumPresentation? = null
) {
    val route="detail:${detail.kind}:${detail.id}"
    val isAlbum=detail.kind=="album" || detail.kind=="localalbum"
    val isArtist=detail.kind=="artist" || detail.kind=="localartist"
    val isRemoteArtist=detail.kind=="artist"
    val isFavorites=detail.kind=="favorites"
    val isTop=detail.kind=="top"
    val isFiltered=!isArtist && (query.isNotEmpty() || filtersActive)
    val artwork=detail.artwork?.takeIf { it.isNotBlank() } ?: fullTracks.firstNotNullOfOrNull { it.artwork }
    val title=playlist?.name ?: detail.title
    val plays=if(isTop) stats.values.sumOf { rows -> rows.sumOf { it.plays.toLong() } } else 0L
    val listenedMs=if(isTop) stats.values.sumOf { rows -> rows.sumOf { it.listenedMs } } else 0L
    val noListening=isTop && plays==0L && listenedMs==0L
    val trackCount=songCount(fullTracks.size)
    val artist=if(isAlbum) {
        albumArtist?.takeIf { it.isNotBlank() } ?: run {
            val distinct = fullTracks.map { it.albumArtist() }.filter(String::isNotBlank).distinct()
            if (distinct.size == 1) distinct.first() else null
        }
    } else null
    val subtitle=when {
        isAlbum -> listOfNotNull(
            "Álbum",
            artist,
            albumYear?.toString(),
            trackCount.takeUnless { detail.loading && fullTracks.isEmpty() }
        ).joinToString(" · ")
        isArtist -> "Artista"
        else -> "Playlist · $trackCount"
    }
    if (artistColors != null) {
        val hasReleases = detail.albums.isNotEmpty() || detail.singles.isNotEmpty() || detail.moreAlbums || detail.moreSingles
        val hasDetails = detail.artists.isNotEmpty()
        val releaseStart = "$route:artist-discography"
        val detailsStart = "$route:artist-details"

        item(key = "$route:header") {
            val measurement = remember { HeroTitleMeasurement() }
            val titleModifier = Modifier.onGloballyPositioned {
                measurement.title = it
                measurement.bottomPx()?.let(onHeroTitleMeasured)
            }
            val banner = detail.banner?.takeIf(String::isNotBlank)
            var videoReady by remember(detail.id) { mutableStateOf(false) }
            val hasWideMedia = isRemoteArtist && (banner != null || videoReady)
            // Wide header art runs under the glass toolbar (as on the web); the copy below keeps its place.
            val mediaUnderBar = hasWideMedia && updateNotice == null
            Column(Modifier.fillMaxWidth().onGloballyPositioned {
                measurement.hero = it
                measurement.bottomPx()?.let(onHeroTitleMeasured)
            }.padding(top = if (mediaUnderBar) 0.dp else heroTopPadding)) {
                if (updateNotice != null) {
                    Box(Modifier.padding(horizontal = Gutter)) { updateNotice() }
                    Spacer(Modifier.height(6.dp))
                }
                if (isRemoteArtist) {
                    val albumTitles = remember(detail.albums, detail.singles) {
                        (detail.albums + detail.singles).mapNotNull {
                            (it["title"] ?: it["name"])?.jsonPrimitive?.contentOrNull
                        }
                    }
                    BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val mediaSize = when {
                        mediaUnderBar -> Modifier.height(maxWidth * 9f / 16f + heroTopPadding)
                        hasWideMedia -> Modifier.aspectRatio(16f / 9f)
                        else -> Modifier
                    }
                    Box(Modifier.fillMaxWidth().then(mediaSize)) {
                        MotionArtistArtwork(
                            artist = title, albums = albumTitles, fallback = banner,
                            playing = true, modifier = Modifier.matchParentSize(), artistId = detail.id,
                            onVideoReady = { videoReady = it }
                        )
                        if (hasWideMedia) Box(Modifier.matchParentSize().background(Brush.verticalGradient(
                            0f to Color.Transparent,
                            0.42f to Color.Transparent,
                            0.83f to artistColors.base.copy(alpha = 0.82f),
                            1f to artistColors.base
                        )))
                        else ArtistPortraitHeader(title, "Artista", artwork, artistColors, titleModifier)
                        // A light scrim keeps the status bar and the glass controls legible over bright art.
                        if (mediaUnderBar) Box(Modifier.fillMaxWidth().height(heroTopPadding + 24.dp).background(Brush.verticalGradient(
                            0f to Color.Black.copy(alpha = 0.42f),
                            1f to Color.Transparent
                        )))
                    }
                    }
                    if (hasWideMedia) ArtistHeading(title, "Artista", titleModifier, Modifier.fillMaxWidth().padding(horizontal = Gutter))
                } else {
                    ArtistPortraitHeader(title, "Artista en tu biblioteca", artwork, artistColors, titleModifier)
                }
                Spacer(Modifier.height(16.dp))
                ArtistActions(
                    name = title,
                    biography = detail.subtitle,
                    image = artwork,
                    tracks = tracks,
                    artistColors = artistColors,
                    onPlay = { tracks.firstOrNull()?.let { vm.play(it, tracks) } },
                    onShuffle = { tracks.firstOrNull()?.let { vm.play(it, tracks, true) } }
                )
                Spacer(Modifier.height(10.dp))
            }
        }

        val error = detail.error
        if (error != null) gutterItem("$route:error") {
            Text(error, color = ArtistSecondaryText, style = MaterialTheme.typography.bodyMedium)
            ArtistTextButton("Reintentar") { vm.back(); vm.openRemote(detail.kind, detail.id, detail.title) }
        }
        if (isRemoteArtist && fullTracks.isNotEmpty()) gutterItem("$route:popular") {
            SectionTitle("Canciones populares")
        }
        when {
            detail.loading && fullTracks.isEmpty() -> skeletons("$route:loading")
            tracks.isEmpty() && error == null && !detail.loading -> gutterItem("$route:empty") {
                EmptyCollection("Aún no hay canciones")
            }
        }
        songItems(tracks, songMap, currentId, { vm.play(it, tracks) }, onSongActions,
            keyPrefix = "$route:song", showFavorite = true, artistColors = artistColors)
        if (detail.moreSongs) gutterItem("$route:more-songs") {
            ArtistTextButton("Ver más canciones", enabled = !detail.loading, action = vm::artistSongs)
        }

        if (hasReleases) {
            item(key = "$route:fade-discography") { Spacer(Modifier.height(48.dp)) }
            val latest = (detail.albums + detail.singles).maxByOrNull { it["year"]?.jsonPrimitive?.intOrNull ?: 0 }
            if (latest != null) gutterItem("$releaseStart:latest") {
                SectionTitle("Último lanzamiento")
                ArtistLatestRelease(latest, artistColors, vm::openRemote)
            }
            artistReleaseShelf(releaseStart, "albums", "Álbumes", detail.albums, detail.moreAlbums, vm)
            artistReleaseShelf(releaseStart, "singles", "Singles y EPs", detail.singles, detail.moreSingles, vm)
        }
        if (hasDetails) {
            val transition = if (hasReleases) releaseStart else route
            item(key = "$transition:fade-details") { Spacer(Modifier.height(48.dp)) }
            gutterItem("$detailsStart:related-heading") { SectionTitle("Fans también escuchan") }
            item(key = "$detailsStart:related") { Cards(detail.artists, "artist", vm::openRemote) }
        }
        val last = when {
            hasDetails -> detailsStart
            hasReleases -> releaseStart
            else -> route
        }
        item(key = "$last:fade-end") { Spacer(Modifier.height(48.dp)) }
    } else if (isAlbum) {
        val tint = albumTint ?: albumTint(null)
        val effectiveDescription = albumPresentation?.description?.text?.takeIf(String::isNotBlank)
            ?: detail.subtitle.takeIf(String::isNotBlank)
        val descriptionSource = albumPresentation?.description?.source ?: "youtube"

        item(key = "$route:header") {
            val measurement = remember { HeroTitleMeasurement() }
            val titleModifier = Modifier.onGloballyPositioned {
                measurement.title = it
                measurement.bottomPx()?.let(onHeroTitleMeasured)
            }
            AlbumHeader(
                title = title,
                artist = artist,
                year = albumYear,
                artwork = artwork,
                description = effectiveDescription,
                descriptionSource = descriptionSource,
                albumTint = tint,
                tracks = tracks,
                fullTracks = fullTracks,
                songMap = songMap,
                titleModifier = titleModifier,
                heroTopPadding = heroTopPadding,
                updateNotice = updateNotice,
                vm = vm,
                requestNotifications = requestNotifications
            )
        }

        val error = detail.error
        collectionFilterItem("$route:filter", query, onQuery, onFilters, filtersActive, if (isFiltered) tracks.size else null, surfaceColor = tint.surfaceColor)
        if (error != null) {
            gutterItem("$route:error") {
                Retry(error) { vm.back(); vm.openRemote(detail.kind, detail.id, detail.title) }
            }
        }
        when {
            detail.loading && fullTracks.isEmpty() -> skeletons("$route:loading")
            tracks.isEmpty() && error == null && !detail.loading -> {
                if (isFiltered) noCollectionMatches("$route:no-matches", onClearFilters)
                else gutterItem("$route:empty") { EmptyCollection("Aún no hay canciones") }
            }
        }

        val trackNumbers = fullTracks.mapIndexed { index, song -> song.id to (index + 1) }.toMap()
        songItems(
            tracks = tracks,
            songMap = songMap,
            currentId = currentId,
            play = { vm.play(it, tracks) },
            onSongActions = onSongActions,
            keyPrefix = "$route:song",
            trackNumbers = trackNumbers,
            showFavorite = true,
            albumTint = tint,
            albumArtist = artist
        )
    } else {
        item(key="$route:header") {
            val rankingArtwork=if(isTop) fullTracks.take(4).mapNotNull { it.artwork } else emptyList()
            val tint=if(isFavorites) FavoriteArtworkColor else artworkTint(if(isTop) rankingArtwork.firstOrNull() else artwork)
            val measurement=remember { HeroTitleMeasurement() }
            val titleModifier=Modifier.onGloballyPositioned {
                measurement.title=it
                measurement.bottomPx()?.let(onHeroTitleMeasured)
            }
            val actions: @Composable ()->Unit = {
                if (isArtist) {
                    ArtistActions(
                        name = title,
                        biography = detail.subtitle,
                        image = artwork,
                        tracks = tracks,
                        artistColors = artistColors ?: ArtistPageColors(NEUTRAL),
                        onPlay = { tracks.firstOrNull()?.let { vm.play(it, tracks) } },
                        onShuffle = { tracks.firstOrNull()?.let { vm.play(it, tracks, true) } }
                    )
                } else {
                    CollectionActions(vm,playlist,tracks,fullTracks,songMap,requestNotifications,onRename,onDelete)
                }
            }
            Box(Modifier.fillMaxWidth().collectionBackdrop(tint,heroTopPadding).onGloballyPositioned {
                measurement.hero=it
                measurement.bottomPx()?.let(onHeroTitleMeasured)
            }) {
                Column(Modifier.fillMaxWidth().padding(top=heroTopPadding)) {
                    if(updateNotice!=null) {
                        Box(Modifier.padding(horizontal=Gutter)) { updateNotice() }
                        Spacer(Modifier.height(6.dp))
                    }
                    if(isTop) {
                        RankingHeader(title,rankingArtwork,period,onPeriod,listenedMs,plays,titleModifier,actions)
                    } else {
                        CollectionHeader(title,subtitle,artwork,isArtist,isFavorites,isAlbum,artist,titleModifier,
                            description=detail.subtitle.takeIf { isArtist && !isRemoteArtist }.orEmpty(),actions=actions)
                    }
                }
            }
        }

        val error=detail.error
        if (!isArtist) collectionFilterItem("$route:filter",query,onQuery,onFilters,filtersActive,if(isFiltered) tracks.size else null)
        if(error!=null) {
            gutterItem("$route:error") {
                Retry(error) { vm.back(); vm.openRemote(detail.kind,detail.id,detail.title) }
            }
        }
        if(isRemoteArtist && fullTracks.isNotEmpty()) {
            gutterItem("$route:popular") { SectionTitle("Canciones populares") }
        }
        when {
            detail.loading && fullTracks.isEmpty() -> skeletons("$route:loading")
            noListening -> gutterItem("$route:no-listening") {
                EmptyCollection("Sin escuchas en este período",if(period!="all") "Ver todo" else null) { onPeriod("all") }
            }
            tracks.isEmpty() && error==null && !detail.loading -> {
                if(isFiltered) noCollectionMatches("$route:no-matches",onClearFilters)
                else gutterItem("$route:empty") { EmptyCollection("Aún no hay canciones") }
            }
        }

        if(isTop && tracks.isNotEmpty()) {
            gutterItem("$route:plays-heading") {
                Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterEnd) { PlayCountHeading() }
            }
        }
        val trackNumbers=if(isAlbum) fullTracks.mapIndexed { index,song -> song.id to (index+1) }.toMap() else emptyMap()
        songItems(tracks,songMap,currentId,{ vm.play(it,tracks) },onSongActions,if(isTop) stats else emptyMap(),
            keyPrefix="$route:song",trackNumbers=trackNumbers,showFavorite=!isFavorites)
        if(detail.moreSongs) gutterItem("$route:more-songs") {
            TextButton(onClick=vm::artistSongs,enabled=!detail.loading) { Text("Ver más canciones") }
        }
        if(detail.albums.isNotEmpty()) {
            gutterItem("$route:albums-title") { SectionTitle("Álbumes y lanzamientos") }
            item(key="$route:albums") { Cards(detail.albums,"album",vm::openRemote) }
        }
        if(detail.moreAlbums) gutterItem("$route:more-albums") {
            TextButton(onClick={ vm.artistReleases("albums") }) { Text("Ver más álbumes") }
        }
        if(detail.moreSingles) gutterItem("$route:more-singles") {
            TextButton(onClick={ vm.artistReleases("singles") }) { Text("Ver más singles y EPs") }
        }
        if(detail.artists.isNotEmpty()) {
            gutterItem("$route:artists-title") { SectionTitle("Artistas similares") }
            item(key="$route:artists") { Cards(detail.artists,"artist",vm::openRemote) }
        }
    }
}

private class HeroTitleMeasurement {
    var hero: LayoutCoordinates? = null
    var title: LayoutCoordinates? = null

    fun bottomPx(): Int? {
        val container=hero?.takeIf { it.isAttached } ?: return null
        val heading=title?.takeIf { it.isAttached } ?: return null
        return container.localPositionOf(heading,Offset(0f,heading.size.height.toFloat())).y.roundToInt()
    }
}

@Composable private fun CollectionHeader(
    title: String,subtitle: String,artwork: String?,isArtist: Boolean,isFavorites: Boolean,
    isAlbum: Boolean,albumArtist: String?,titleModifier: Modifier,description: String,actions: @Composable ()->Unit
) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal=Gutter).padding(top=16.dp,bottom=8.dp),
        horizontalAlignment=Alignment.CenterHorizontally
    ) {
        val size=if(isArtist) 152.dp else 176.dp
        val shape=if(isArtist) CircleShape else RoundedCornerShape(Radii.feature)
        val artworkModifier=Modifier.size(size).shadow(12.dp,shape)
        when {
            isFavorites -> FavoritesCover(artworkModifier,size)
            isAlbum -> MotionArtwork(artist=albumArtist,album=title,fallback=artwork,playing=true,
                modifier=artworkModifier,shape=shape)
            else -> Cover(artwork,artworkModifier,1024)
        }
        Text(
            title,Modifier.padding(top=16.dp).then(titleModifier),color=TextColor,textAlign=TextAlign.Center,maxLines=2,
            overflow=TextOverflow.Ellipsis,style=collectionTitleStyle()
        )
        Text(
            subtitle,Modifier.padding(top=4.dp),color=Muted,textAlign=TextAlign.Center,maxLines=2,
            overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall.copy(fontSize=13.sp)
        )
        if(description.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            ExpandableBiography(description,collapsedLines=3,expandLabel="Más")
        }
        Spacer(Modifier.height(12.dp))
        actions()
    }
}

@Composable private fun RankingHeader(
    title: String,artwork: List<String>,period: String,onPeriod: (String)->Unit,listenedMs: Long,plays: Long,
    titleModifier: Modifier,actions: @Composable ()->Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal=Gutter).padding(top=12.dp,bottom=8.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,
            horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(title,Modifier.weight(1f).then(titleModifier),color=Color.White,style=collectionTitleStyle(),
                maxLines=2,overflow=TextOverflow.Ellipsis)
            if(artwork.isNotEmpty()) ArtworkMosaic(artwork,Modifier.size(64.dp).clip(RoundedCornerShape(Radii.card)),64.dp)
        }
        Spacer(Modifier.height(6.dp))
        Periods(period,onPeriod)
        Row(Modifier.fillMaxWidth().padding(top=8.dp,bottom=12.dp),horizontalArrangement=Arrangement.spacedBy(24.dp)) {
            Box(Modifier.weight(1f)) { Stat("${listenedMs/60_000}","minutos escuchados") }
            Box(Modifier.weight(1f)) { Stat("$plays","reproducciones") }
        }
        actions()
    }
}

@Composable private fun artworkTint(artwork: String?): Color {
    val context=LocalContext.current
    var dominant by remember(context,artwork) { mutableStateOf<Int?>(null) }
    LaunchedEffect(context,artwork) {
        dominant=CoverPalette.dominant(context,artwork)
    }
    return dominant?.let { Color(it) } ?: Raised
}

private fun Modifier.collectionBackdrop(tint: Color,heroTopPadding: Dp) = drawWithCache {
    val startColor=tint.copy(alpha=0.55f).compositeOver(Ink)
    val backdrop=Brush.verticalGradient(
        0f to startColor,
        0.45f to tint.copy(alpha=0.18f).compositeOver(Ink),
        1f to Ink,
        endY=(heroTopPadding+360.dp).toPx().coerceAtMost(size.height)
    )
    val barHeight=heroTopPadding.toPx().coerceAtMost(size.height)
    val whiteContrast=1.05f/(startColor.luminance()+0.05f)
    val scrim=if(barHeight>0f && whiteContrast<4.5f) {
        Brush.verticalGradient(listOf(Ink.copy(alpha=0.35f),Ink.copy(alpha=0f)),endY=barHeight)
    } else null
    onDrawBehind {
        drawRect(backdrop)
        if(scrim!=null) drawRect(scrim,size=Size(size.width,barHeight))
    }
}

@Composable private fun collectionTitleStyle() = MaterialTheme.typography.headlineMedium.copy(
    fontSize=26.sp,fontWeight=FontWeight.Bold,lineHeight=31.sp
)

@Composable
private fun ArtistPortraitHeader(title: String, label: String, artwork: String?, colors: ArtistPageColors, titleModifier: Modifier) {
    // Stacked and centred, like Apple Music's mobile artist page: portrait, then name, then the actions below.
    BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = Gutter, vertical = 16.dp)) {
        val coverSize = if (maxWidth < 340.dp) 136.dp else 168.dp
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Cover(artwork, Modifier.size(coverSize).shadow(12.dp, CircleShape).clip(CircleShape), coverSize, colors.surface)
            ArtistHeading(title, label, titleModifier, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun ArtistHeading(title: String, label: String, titleModifier: Modifier, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = ArtistSecondaryText, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
        Text(
            title, titleModifier, color = Color.White, maxLines = 3, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            style = MaterialTheme.typography.headlineMedium.copy(fontSize = 32.sp, lineHeight = 36.sp)
        )
    }
}

@Composable
private fun ArtistTextButton(label: String, enabled: Boolean = true, action: () -> Unit) {
    TextButton(onClick = action, enabled = enabled, colors = ButtonDefaults.textButtonColors(contentColor = Color.White)) {
        Text(label)
    }
}

private fun LazyListScope.artistReleaseShelf(
    sectionKey: String, kind: String, title: String, cards: List<JsonObject>, more: Boolean, vm: OpenfyViewModel
) {
    if (cards.isNotEmpty()) {
        gutterItem("$sectionKey:$kind-heading") { SectionTitle(title) }
        item(key = "$sectionKey:$kind-cards") { Cards(cards, "album", vm::openRemote) }
    }
    if (more) gutterItem("$sectionKey:$kind-more") {
        val label = if (kind == "albums") "Ver más álbumes" else "Ver más singles y EPs"
        ArtistTextButton(label) { vm.artistReleases(kind) }
    }
}

@Composable
private fun ArtistLatestRelease(item: JsonObject, colors: ArtistPageColors, open: (String, String, String) -> Unit) {
    val id = item["id"]?.jsonPrimitive?.contentOrNull ?: return
    val title = (item["title"] ?: item["name"])?.jsonPrimitive?.contentOrNull ?: return
    val artwork = item["artwork"]?.jsonPrimitive?.contentOrNull
    val year = item["year"]?.jsonPrimitive?.intOrNull
    val shape = RoundedCornerShape(Radii.card)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(colors.deep)
            .clickable { open("album", id, title) }.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Cover(artwork, Modifier.size(64.dp).clip(RoundedCornerShape(Radii.tile)), 64.dp, colors.surface)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = Color.White, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (year != null) Text(year.toString(), color = ArtistSecondaryText, style = MaterialTheme.typography.bodySmall)
        }
        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = ArtistSecondaryText)
    }
}

private val ArtistGlassSize = 44.dp

// Liquid glass lens over the artist backdrop, matching .artist-glass-button on the web: a translucent tint of the
// artist colour, a diagonal specular sheen and a rim that is brighter at the top edge. Compose cannot blur what
// lies behind a view, so the depth comes from the sheen and the rim alone; an
// elevation shadow would show through the translucent fill as a dark disc, so there is none.
@Composable
private fun ArtistGlassButton(
    onClick: () -> Unit,
    label: String,
    artistColors: ArtistPageColors,
    enabled: Boolean = true,
    content: @Composable () -> Unit
) {
    Box(
        Modifier
            .size(ArtistGlassSize)
            .alpha(if (enabled) 1f else 0.45f)
            .clip(CircleShape)
            .background(artistColors.deep.copy(alpha = 0.34f))
            .background(
                Brush.linearGradient(
                    0f to Color.White.copy(alpha = 0.22f),
                    0.42f to Color.White.copy(alpha = 0.05f),
                    0.58f to Color.White.copy(alpha = 0.02f),
                    1f to Color.White.copy(alpha = 0.12f),
                    start = Offset(0f, 0f),
                    end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY)
                )
            )
            .border(
                1.dp,
                Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.45f), Color.White.copy(alpha = 0.10f))),
                CircleShape
            )
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center
    ) { content() }
}

@Composable
private fun ArtistActions(
    name: String,
    biography: String,
    image: String?,
    tracks: List<Song>,
    artistColors: ArtistPageColors,
    onPlay: () -> Unit,
    onShuffle: () -> Unit
) {
    var showBioSheet by remember { mutableStateOf(false) }

    // Apple Music's mobile order: info on the left, play in the middle, shuffle on the right. The info slot keeps
    // its width when there is no biography so play stays on the page's centre line.
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Gutter),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterHorizontally)
    ) {
        if (biography.isNotBlank()) {
            ArtistGlassButton(
                onClick = { showBioSheet = true },
                label = "Acerca de $name",
                artistColors = artistColors
            ) {
                Icon(Icons.Outlined.Info, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
            }
        } else {
            Spacer(Modifier.size(ArtistGlassSize))
        }
        IconButton(
            onClick = onPlay,
            enabled = tracks.isNotEmpty(),
            modifier = Modifier
                .size(56.dp)
                .background(Color.White, CircleShape)
                .semantics { contentDescription = "Reproducir" }
        ) {
            Icon(Icons.Default.PlayArrow, contentDescription = null, tint = artistColors.deep, modifier = Modifier.size(32.dp))
        }
        ArtistGlassButton(
            onClick = onShuffle,
            enabled = tracks.size > 1,
            label = "Reproducir en aleatorio",
            artistColors = artistColors
        ) {
            Icon(Icons.Default.Shuffle, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
        }
    }

    if (showBioSheet && biography.isNotBlank()) {
        ArtistBiographySheet(
            name = name,
            biography = biography,
            image = image,
            artistColors = artistColors,
            onDismiss = { showBioSheet = false }
        )
    }
}

@Composable
private fun ArtistBiographySheet(
    name: String,
    biography: String,
    image: String?,
    artistColors: ArtistPageColors,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = artistColors.deep,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (!image.isNullOrBlank()) {
                Cover(
                    image,
                    Modifier.size(128.dp).clip(CircleShape),
                    128.dp,
                    artistColors.surface
                )
            }
            Text(
                name,
                color = Color.White,
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                textAlign = TextAlign.Center
            )
            Column(
                Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    "Acerca de",
                    color = Color.White,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold)
                )
                Text(
                    biography,
                    color = ArtistSecondaryText,
                    style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp)
                )
            }
        }
    }
}

@Composable private fun CollectionActions(
    vm: OpenfyViewModel,playlist: PlaylistRow?,tracks: List<Song>,fullTracks: List<Song>,songMap: Map<String,Song>,
    requestNotifications: ()->Unit,onRename: (PlaylistRow)->Unit,onDelete: (PlaylistRow)->Unit
) {
    fun isDownloadable(song: Song) = song.source=="youtube" && !(songMap[song.id]?.offlineReady ?: song.offlineReady)

    val downloadable=remember(tracks,songMap) { tracks.distinctBy { it.id }.filter(::isDownloadable) }
    var pendingDownload by remember { mutableStateOf<List<Song>?>(null) }
    fun downloadSongs(songs: List<Song>) {
        val remaining=songs.filter(::isDownloadable)
        if(remaining.isNotEmpty()) {
            requestNotifications()
            remaining.forEach { vm.download(it) }
        }
    }
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        IconButton(
            onClick={ tracks.firstOrNull()?.let { vm.play(it,tracks,true) } },
            enabled=tracks.isNotEmpty(),modifier=Modifier.size(48.dp)
        ) { Icon(Icons.Default.Shuffle,"Aleatorio",Modifier.size(24.dp)) }
        IconButton(
            onClick={
                if(downloadable.size>10) pendingDownload=downloadable
                else downloadSongs(downloadable)
            },
            enabled=downloadable.isNotEmpty(),modifier=Modifier.size(48.dp)
        ) { Icon(Icons.Default.Download,"Descargar") }
        if(playlist!=null) {
            PlaylistActions(playlist,{ onRename(playlist) },{ onDelete(playlist) }) {
                val keep=!playlist.keepDownloaded
                if(keep && fullTracks.any(::isDownloadable)) requestNotifications()
                vm.run {
                    vm.app.repository.savePlaylist(playlist.copy(keepDownloaded=keep))
                    if(keep) vm.app.downloads.syncCollections()
                }
            }
        }
        Spacer(Modifier.weight(1f))
        IconButton(
            onClick={ tracks.firstOrNull()?.let { vm.play(it,tracks) } },
            enabled=tracks.isNotEmpty(),
            modifier=Modifier.size(56.dp).background(if(tracks.isEmpty()) Raised else Green,CircleShape),
            colors=IconButtonDefaults.iconButtonColors(contentColor=Color.Black,disabledContentColor=Muted)
        ) { Icon(Icons.Default.PlayArrow,"Reproducir",Modifier.size(32.dp)) }
    }
    pendingDownload?.let { songs ->
        AlertDialog(
            onDismissRequest={ pendingDownload=null },
            title={ Text("Descargar ${songCount(songs.size)}") },
            confirmButton={
                TextButton(onClick={ pendingDownload=null; downloadSongs(songs) }) { Text("Descargar") }
            },
            dismissButton={ TextButton(onClick={ pendingDownload=null }) { Text("Cancelar") } }
        )
    }
}

@Composable private fun PlaylistActions(
    playlist: PlaylistRow,onRename: ()->Unit,onDelete: ()->Unit,onKeepDownloaded: ()->Unit
) {
    var open by remember { mutableStateOf(false) }
    Box {
        ActionIcon(Icons.Default.MoreHoriz,"Opciones de la colección") { open=true }
        DropdownMenu(expanded=open,onDismissRequest={ open=false }) {
            DropdownMenuItem(text={ Text("Cambiar nombre") },onClick={ open=false; onRename() })
            DropdownMenuItem(text={ Text("Eliminar") },onClick={ open=false; onDelete() })
            DropdownMenuItem(
                text={ Text("Mantener descargada") },
                onClick={ open=false; onKeepDownloaded() },
                modifier=Modifier.semantics {
                    stateDescription=if(playlist.keepDownloaded) "Activado" else "Desactivado"
                },
                trailingIcon={ if(playlist.keepDownloaded) Icon(Icons.Default.Check,null,tint=Green) }
            )
        }
    }
}

@Composable private fun ExpandableBiography(description: String,collapsedLines: Int,expandLabel: String,artist: Boolean = false) {
    var expanded by rememberSaveable(description) { mutableStateOf(false) }
    var hasOverflow by remember(description) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Text(description,color=if(artist) ArtistSecondaryText else Muted,style=MaterialTheme.typography.bodyMedium,maxLines=if(expanded) Int.MAX_VALUE else collapsedLines,
            overflow=TextOverflow.Ellipsis,onTextLayout={ if(!expanded) hasOverflow=it.hasVisualOverflow })
        if(expanded || hasOverflow) TextButton(onClick={ expanded=!expanded },modifier=Modifier.heightIn(min=48.dp),
            colors=ButtonDefaults.textButtonColors(contentColor=if(artist) Color.White else MaterialTheme.colorScheme.primary)) {
            Text(if(expanded) "Leer menos" else expandLabel)
        }
    }
}

internal fun LazyListScope.noCollectionMatches(key: String,clear: ()->Unit) {
    gutterItem(key) { EmptyCollection("Sin coincidencias","Limpiar filtros",clear) }
}

@Composable private fun EmptyCollection(title: String,actionLabel: String? = null,onAction: ()->Unit = {}) {
    Column(Modifier.padding(vertical=SectionGap),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text(title,style=MaterialTheme.typography.titleLarge)
        if(actionLabel!=null) TextButton(onClick=onAction,modifier=Modifier.heightIn(min=48.dp)) { Text(actionLabel) }
    }
}

private fun formatAlbumDuration(tracks: List<Song>): String? {
    if (tracks.isEmpty() || tracks.any { it.duration <= 0 }) return null
    val totalMs = tracks.sumOf { it.duration }
    val totalMinutes = totalMs / 60_000
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    return if (hours > 0) {
        if (minutes > 0) "$hours h $minutes min" else "$hours h"
    } else {
        "$minutes min"
    }
}

@Composable
private fun AlbumHeader(
    title: String,
    artist: String?,
    year: Int?,
    artwork: String?,
    description: String?,
    descriptionSource: String,
    albumTint: AlbumTintColors,
    tracks: List<Song>,
    fullTracks: List<Song>,
    songMap: Map<String, Song>,
    titleModifier: Modifier,
    heroTopPadding: Dp,
    updateNotice: (@Composable () -> Unit)?,
    vm: OpenfyViewModel,
    requestNotifications: () -> Unit
) {
    var dialogOpen by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth().padding(top = heroTopPadding)) {
        if (updateNotice != null) {
            Box(Modifier.padding(horizontal = Gutter)) { updateNotice() }
            Spacer(Modifier.height(6.dp))
        }

        BoxWithConstraints(
            Modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            val panelWidth = maxWidth
            val coverSize = minOf(216.dp, panelWidth * 0.56f, (panelWidth - 40.dp).coerceAtLeast(0.dp))
            val shape = RoundedCornerShape(12.dp)
            val artworkModifier = Modifier.size(coverSize).shadow(12.dp, shape)

            MotionArtwork(
                artist = artist,
                album = title,
                fallback = artwork,
                playing = !dialogOpen,
                modifier = artworkModifier,
                shape = shape
            )
        }

        Spacer(Modifier.height(16.dp))

        Column(
            Modifier.fillMaxWidth().padding(horizontal = Gutter),
            horizontalAlignment = Alignment.Start
        ) {
            Text(
                title,
                modifier = titleModifier,
                color = TextColor,
                style = MaterialTheme.typography.headlineMedium.copy(
                    fontSize = 28.sp,
                    lineHeight = 32.sp,
                    fontWeight = FontWeight.Bold
                )
            )

            if (!artist.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    artist,
                    color = TextColor,
                    style = MaterialTheme.typography.bodyLarge.copy(
                        fontSize = 16.sp,
                        lineHeight = 22.sp,
                        fontWeight = FontWeight.Medium
                    )
                )
            }

            if (year != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    year.toString(),
                    color = albumTint.mutedColor,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 13.sp,
                        lineHeight = 18.sp
                    )
                )
            }

            if (!description.isNullOrBlank()) {
                Spacer(Modifier.height(12.dp))
                AlbumDescriptionBlock(
                    description = description,
                    albumTint = albumTint,
                    onOpenDialog = { dialogOpen = true }
                )
            }

            Spacer(Modifier.height(20.dp))

            AlbumActions(
                vm = vm,
                tracks = tracks,
                fullTracks = fullTracks,
                songMap = songMap,
                requestNotifications = requestNotifications,
                albumTint = albumTint
            )

            Spacer(Modifier.height(16.dp))

            val trackCountText = songCount(fullTracks.size)
            val durationText = formatAlbumDuration(fullTracks)
            val summary = if (durationText != null) "$trackCountText   $durationText" else trackCountText
            Text(
                summary,
                color = albumTint.mutedColor,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
            )
            Spacer(Modifier.height(8.dp))
        }
    }

    if (dialogOpen && !description.isNullOrBlank()) {
        val attribution = if (descriptionSource == "apple") "Texto de Apple Music" else "Texto de YouTube Music"
        AlertDialog(
            onDismissRequest = { dialogOpen = false },
            title = {
                Text(
                    title,
                    color = TextColor,
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                )
            },
            text = {
                Column(
                    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        description,
                        color = TextColor,
                        style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp)
                    )
                    Text(
                        attribution,
                        color = albumTint.mutedColor,
                        style = MaterialTheme.typography.labelMedium
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { dialogOpen = false }) {
                    Text("Cerrar", color = Green)
                }
            },
            containerColor = Surface
        )
    }
}

@Composable
private fun AlbumDescriptionBlock(
    description: String,
    albumTint: AlbumTintColors,
    onOpenDialog: () -> Unit
) {
    var hasOverflow by remember(description) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().widthIn(max = 650.dp)) {
        Text(
            description,
            color = albumTint.mutedColor,
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, lineHeight = 21.sp),
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            onTextLayout = { hasOverflow = it.hasVisualOverflow }
        )
        if (hasOverflow) {
            TextButton(
                onClick = onOpenDialog,
                modifier = Modifier.heightIn(min = 48.dp),
                colors = ButtonDefaults.textButtonColors(contentColor = Color.White)
            ) {
                Text("Más")
            }
        }
    }
}

@Composable
private fun AlbumActions(
    vm: OpenfyViewModel,
    tracks: List<Song>,
    fullTracks: List<Song>,
    songMap: Map<String, Song>,
    requestNotifications: () -> Unit,
    albumTint: AlbumTintColors
) {
    fun isDownloadable(song: Song) = song.source == "youtube" && !(songMap[song.id]?.offlineReady ?: song.offlineReady)
    val downloadable = remember(tracks, songMap) { tracks.distinctBy { it.id }.filter(::isDownloadable) }
    var pendingDownload by remember { mutableStateOf<List<Song>?>(null) }
    fun downloadSongs(songs: List<Song>) {
        val remaining = songs.filter(::isDownloadable)
        if (remaining.isNotEmpty()) {
            requestNotifications()
            remaining.forEach { vm.download(it) }
        }
    }

    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        IconButton(
            onClick = { tracks.firstOrNull()?.let { vm.play(it, tracks) } },
            enabled = tracks.isNotEmpty(),
            modifier = Modifier
                .size(56.dp)
                .background(if (tracks.isEmpty()) Raised else Green, CircleShape)
                .semantics { contentDescription = "Reproducir" }
        ) {
            Icon(
                Icons.Default.PlayArrow,
                contentDescription = null,
                tint = Color.Black,
                modifier = Modifier.size(32.dp)
            )
        }

        FilledTonalButton(
            onClick = { tracks.firstOrNull()?.let { vm.play(it, tracks, true) } },
            enabled = tracks.isNotEmpty(),
            modifier = Modifier.height(48.dp),
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = albumTint.surfaceColor,
                contentColor = TextColor
            )
        ) {
            Icon(Icons.Default.Shuffle, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("Aleatorio")
        }

        if (downloadable.isNotEmpty()) {
            IconButton(
                onClick = {
                    if (downloadable.size > 10) pendingDownload = downloadable
                    else downloadSongs(downloadable)
                },
                modifier = Modifier.size(48.dp).background(albumTint.surfaceColor, CircleShape)
            ) {
                Icon(Icons.Default.Download, "Descargar", tint = TextColor)
            }
        }
    }

    pendingDownload?.let { songs ->
        AlertDialog(
            onDismissRequest = { pendingDownload = null },
            title = { Text("Descargar ${songCount(songs.size)}") },
            confirmButton = {
                TextButton(onClick = { pendingDownload = null; downloadSongs(songs) }) { Text("Descargar") }
            },
            dismissButton = { TextButton(onClick = { pendingDownload = null }) { Text("Cancelar") } }
        )
    }
}
