package app.openfy.android.ui

import androidx.compose.foundation.lazy.LazyListLayoutInfo
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

internal val ArtistSecondaryText = Color(0xffededf0)

internal data class ArtistPageColors(val base: Color, val secondary: Color, val deep: Color, val surface: Color) {
    constructor(theme: ArtistThemeColors) : this(
        Color(android.graphics.Color.parseColor(theme.base)),
        Color(android.graphics.Color.parseColor(theme.secondary)),
        Color(android.graphics.Color.parseColor(theme.deep)),
        Color(android.graphics.Color.parseColor(theme.surface)),
    )

    private fun section(key: String) = when {
        ":artist-discography:" in key -> secondary
        ":artist-details:" in key -> deep
        else -> base
    }

    private fun destination(key: String) = when {
        key.endsWith(":fade-discography") -> secondary
        key.endsWith(":fade-details") -> deep
        key.endsWith(":fade-end") -> Ink
        else -> null
    }

    fun at(layout: LazyListLayoutInfo, y: Float, snap: Boolean = false): Color {
        val visible = layout.visibleItemsInfo
        val item = visible.lastOrNull { it.offset <= y } ?: visible.firstOrNull() ?: return base
        val key = item.key.toString()
        val start = section(key)
        val end = destination(key) ?: return start
        val progress = ((y - item.offset) / item.size.coerceAtLeast(1)).coerceIn(0f, 1f)
        if (snap) return if (progress < 0.5f) start else end
        return Color(
            red = start.red + (end.red - start.red) * progress,
            green = start.green + (end.green - start.green) * progress,
            blue = start.blue + (end.blue - start.blue) * progress,
        )
    }

    fun Modifier.backdrop(scroll: LazyListState) = drawBehind {
        if (size.height <= 0) return@drawBehind
        val layout = scroll.layoutInfo
        val positions = mutableListOf(0f, size.height)
        for (item in layout.visibleItemsInfo) {
            if (destination(item.key.toString()) == null) continue
            positions.add(item.offset.toFloat().coerceIn(0f, size.height))
            positions.add((item.offset + item.size).toFloat().coerceIn(0f, size.height))
        }
        val stops = positions.distinct().sorted().map { position ->
            position / size.height to at(layout, position)
        }
        drawRect(Brush.verticalGradient(*stops.toTypedArray(), endY = size.height))
    }
}
