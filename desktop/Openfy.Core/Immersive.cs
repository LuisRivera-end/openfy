namespace Openfy.Core;

/// <summary>
/// Fullscreen player layout shared with the PWA (shared/utils/immersive.ts).
/// Pinned by tests/fixtures/immersive-layout-contract.json.
/// </summary>
public static class Immersive
{
    public const double SplitMinWidth = 900, SplitMinAspect = 1.1;
    public const string Cover = "cover", Split = "split", Stacked = "stacked";
    public const int IdleMilliseconds = 4000, LeadSeconds = 10, TransitionMilliseconds = 1200;
    public const double CompactScale = 1.2, LyricsTop = .2, LyricsEdge = .18, SideMargin = 48;
    public const int CompactMilliseconds = 320, LayoutMilliseconds = 600;
    public const double CardWidth = 420, CardHeight = 120, CornerHeight = 160, CornerMargin = 32, CornerWidth = .38, CornerMaxWidth = 640;

    public readonly record struct CardBounds(double X, double Y, double Width, double Height, double Scale);

    /// <summary>
    /// The "A continuación" card: above the dock while the controls are visible, and in compact (idle)
    /// mode anchored to the bottom-right corner, the same layout uniformly scaled and widened.
    /// The card's own layout box is (Width / Scale) × CardHeight.
    /// </summary>
    public static CardBounds NextCardBounds(double viewportWidth, double viewportHeight, double contentRight, double contentWidth, double dockTop, bool idle)
    {
        if (!idle) {
            double docked = Math.Max(1, Math.Min(CardWidth, contentWidth));
            return new(contentRight - docked, Math.Max(68, dockTop - 136), docked, CardHeight, 1);
        }
        double width = Math.Max(1, Math.Min(viewportWidth - 2 * CornerMargin, Math.Max(CardWidth, Math.Min(CornerMaxWidth, viewportWidth * CornerWidth))));
        return new(viewportWidth - CornerMargin - width, Math.Max(68, viewportHeight - CornerMargin - CornerHeight), width, CornerHeight, CornerHeight / CardHeight);
    }

    public static int? NextIndex(int count, int index, string repeat)
    {
        if (count <= 0 || index < 0 || index >= count) return null;
        if (repeat == "one") return index;
        return index + 1 < count ? index + 1 : repeat == "all" ? 0 : null;
    }
    public static int? UpcomingSeconds(double position, double duration)
    {
        if (!double.IsFinite(position) || !double.IsFinite(duration) || duration <= 0) return null;
        double remaining = duration - position;
        return remaining >= 0 && remaining <= LeadSeconds ? (int)Math.Ceiling(remaining) : null;
    }

    /// <summary>
    /// Big Picture shows the lyrics column only for synced lyrics: plain text has nothing to follow, so plain,
    /// instrumental, not found and a failed load leave the centred cover. While a load is pending the current
    /// choice is kept, so a song change does not bounce between layouts.
    /// </summary>
    public static bool BigPictureLyrics(string? status, bool pending, bool previous)
    {
        if (status == "synced") return true;
        if (status == null && pending) return previous;
        return false;
    }

    public static string Layout(double width, double height, bool lyrics)
    {
        if (!lyrics) return Cover;
        return width >= SplitMinWidth && height > 0 && width / height >= SplitMinAspect ? Split : Stacked;
    }
}
