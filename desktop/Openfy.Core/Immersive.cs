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
    public const int CompactMilliseconds = 320, CardEnterMilliseconds = 320, LayoutMilliseconds = 600;
    public const double CardWidth = 420, CardHeight = 120, CornerHeight = 160, CornerMargin = 32, CornerWidth = .38, CornerMaxWidth = 640, AvoidGap = 24;

    public readonly record struct CardBounds(double X, double Y, double Width, double Height, double Scale);

    /// <summary>
    /// The "A continuación" card: above the dock while the controls are visible, and in compact (idle)
    /// mode anchored to the bottom-right corner, the same layout uniformly scaled and widened.
    /// When an obstacle rectangle is given (such as the centred cover column without synced lyrics),
    /// the card narrows and reduces its scale if needed to maintain AvoidGap clearance.
    /// The card's own layout box is (Width / Scale) × CardHeight.
    /// </summary>
    public static CardBounds NextCardBounds(double viewportWidth, double viewportHeight, double contentRight, double contentWidth, double dockTop, bool idle, double? avoidRight = null, double? avoidBottom = null)
    {
        double width, height, scale, x, y;
        if (!idle) {
            width = Math.Max(1, Math.Min(CardWidth, contentWidth));
            height = CardHeight;
            scale = 1;
            x = contentRight - width;
            y = Math.Max(68, dockTop - 136);
        } else {
            width = Math.Max(1, Math.Min(viewportWidth - 2 * CornerMargin, Math.Max(CardWidth, Math.Min(CornerMaxWidth, viewportWidth * CornerWidth))));
            height = CornerHeight;
            scale = CornerHeight / CardHeight;
            x = viewportWidth - CornerMargin - width;
            y = Math.Max(68, viewportHeight - CornerMargin - CornerHeight);
        }
        if (avoidRight is { } ar && avoidBottom is { } ab && ab + AvoidGap > y) {
            double minWidth = CardWidth * .75;
            if (idle) {
                double available = viewportWidth - CornerMargin - (ar + AvoidGap);
                if (available >= CardWidth) {
                    width = Math.Min(width, available);
                    x = viewportWidth - CornerMargin - width;
                } else {
                    scale = Math.Max(1, available / minWidth);
                    height = CardHeight * scale;
                    width = Math.Max(available, minWidth);
                    x = viewportWidth - CornerMargin - width;
                    y = Math.Max(68, viewportHeight - CornerMargin - height);
                }
            } else {
                double available = contentRight - (ar + AvoidGap);
                width = Math.Max(minWidth, Math.Min(width, available));
                x = contentRight - width;
            }
        }
        return new(x, y, width, height, scale);
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
