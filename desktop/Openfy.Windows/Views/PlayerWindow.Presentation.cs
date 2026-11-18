using System.Numerics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Openfy.Core;
using Windows.Foundation;

namespace Openfy.Windows.Views;

public sealed partial class PlayerWindow
{
    private Grid? pictureArtworkSlot, pictureInfoSlot, pictureLyricsSlot;
    private Grid? pictureArtView, pictureInfoView, pictureLyricsView, pictureMiniView;
    private Canvas? picturePresentation;
    private (double Width, double Height, bool Idle, bool Card, string Layout)? presentationKey;
    private Rect presentationArtBounds, presentationLyricsBounds;
    private double pictureScale = 1;
    private bool presentationQueued;

    private void InitializePresentation()
    {
        if (stage == null || pictureCapture == null || lyricsHost == null || info == null) return;
        picturePresentation = new Canvas(); pictureCapture.Children.Add(picturePresentation);
        (Grid Slot, Grid View) Separate(FrameworkElement child) {
            var slot = new Grid { IsHitTestVisible = false, HorizontalAlignment = child.HorizontalAlignment, VerticalAlignment = child.VerticalAlignment };
            stage.Children.Remove(child); stage.Children.Add(slot);
            child.Margin = new Thickness(0);
            var view = new Grid(); view.Children.Add(child); picturePresentation.Children.Add(view);
            return (slot, view);
        }
        (pictureArtworkSlot, pictureArtView) = Separate(artworkFrame);
        (pictureInfoSlot, pictureInfoView) = Separate(info);
        (pictureLyricsSlot, pictureLyricsView) = Separate(lyricsHost);
        lyricsScroll.ViewChanged += LyricsDepthChanged;
        QueuePresentation();
    }

    private void QueuePresentation()
    {
        if (picturePresentation == null || presentationQueued || released) return;
        presentationQueued = true;
        DispatcherQueue.TryEnqueue(() => {
            presentationQueued = false;
            if (released || pictureRoot == null) return;
            bool slide = layoutSlide && PictureMotion; layoutSlide = false;
            stage?.UpdateLayout(); presentationKey = null; UpdatePresentation(slide, slide ? Immersive.LayoutMilliseconds : Immersive.CompactMilliseconds);
        });
    }

    /// <summary>`duration`: the idle change (CompactMilliseconds) or the split ↔ cover slide when the lyrics column comes or goes (LayoutMilliseconds).</summary>
    private void UpdatePresentation(bool animate = false, int duration = Immersive.CompactMilliseconds)
    {
        if (pictureRoot == null || pictureArtworkSlot == null || pictureInfoSlot == null || pictureLyricsSlot == null || pictureArtView == null || pictureInfoView == null || pictureLyricsView == null || header == null || seekBlock == null || stage == null || info == null || lyricsHost == null || pictureArtworkSlot.ActualWidth <= 0) return;
        double width = pictureRoot.ActualWidth, height = pictureRoot.ActualHeight;
        var key = (width, height, pictureIdle, previewSong != null, layout);
        if (presentationKey == key) return;
        presentationKey = key;
        Rect Bounds(FrameworkElement child) { var p = child.TransformToVisual(pictureRoot).TransformPoint(default); return new(p.X, p.Y, child.ActualWidth, child.ActualHeight); }
        var art = Bounds(pictureArtworkSlot); var copy = Bounds(pictureInfoSlot); var lyrics = Bounds(pictureLyricsSlot); var head = Bounds(header); var content = Bounds(stage); var dock = Bounds(seekBlock);
        bool split = layout == Immersive.Split, cover = layout == Immersive.Cover;
        // The docked cover shares the split rows: same vertical placement and idle centring.
        bool column = split || cover;
        pictureScale = pictureIdle ? Math.Min(Immersive.CompactScale, Math.Max(1, (height - head.Bottom - 48) / Math.Max(1, art.Height + copy.Height + 62))) : 1;
        double scale = pictureScale, side = art.Width * scale;
        double x = Math.Max(content.Left, art.X - (side - art.Width) / 2);
        double group = side + (copy.Height + 62) * scale;
        double y = column && pictureIdle ? Math.Max(head.Bottom + 24, Math.Min(art.Y, (head.Bottom + 24 + height - 24 - group) / 2)) : art.Y;
        double infoY = column ? y + side + 22 * scale : copy.Y;
        bool motion = animate && PictureMotion;
        void Move(Grid view, double left, double top, double w, double h, bool animated = true) {
            view.Width = Math.Max(1, w); view.Height = Math.Max(1, h);
            bool eased = motion && animated;
            view.ScaleTransition = eased ? new Vector3Transition { Duration = TimeSpan.FromMilliseconds(duration) } : null;
            view.TranslationTransition = eased ? new Vector3Transition { Duration = TimeSpan.FromMilliseconds(duration) } : null;
            view.Scale = new((float)scale, (float)scale, 1); view.Translation = new((float)left, (float)top, 0);
        }
        Move(pictureArtView, x, y, art.Width, art.Height);
        double infoX = column ? x : Math.Max(content.Left, copy.X - copy.Width * (scale - 1) / 2);
        double infoWidth = Math.Min(copy.Width, (content.Right - infoX) / scale);
        info.Width = infoWidth; Move(pictureInfoView, infoX, infoY, infoWidth, copy.Height);
        // The enlarged artwork keeps the full-size gap; the lyrics shift into the empty outer margin instead of narrowing.
        double gap = Math.Max(32, lyrics.X - art.Right);
        double left = split ? Math.Max(lyrics.X, x + side + gap) : lyrics.X;
        double right = split ? Math.Max(content.Right, Math.Min(width - Immersive.SideMargin, content.Right + left - lyrics.X)) : content.Right;
        double top = split ? y + side * Immersive.LyricsTop : Math.Max(lyrics.Top, infoY + copy.Height * scale + 48);
        // Docked above the controls or in the compact corner, the lyrics end 16 px before the card.
        double cardTop = previewSong != null ? CardTarget().Y - 16 : double.PositiveInfinity;
        double bottom = Math.Min(pictureIdle ? height - 24 : dock.Top - 20, cardTop);
        double lyricWidth = Math.Max(1, right - left), lyricHeight = Math.Max(48, bottom - top);
        presentationArtBounds = new(x, y, side, side);
        // Without a lyrics column the fading view keeps its last place. A column that has just appeared is placed
        // directly; its own fade (ShowLyricsPane) reveals it once the song has moved aside.
        if (!cover) {
            lyricsHost.Width = lyricWidth / scale; lyricsHost.Height = lyricHeight / scale;
            Move(pictureLyricsView, left, top, lyricWidth / scale, lyricHeight / scale, duration == Immersive.CompactMilliseconds);
            presentationLyricsBounds = new(left, top, lyricWidth, lyricHeight);
        }
        else presentationLyricsBounds = Rect.Empty;
        if (miniProgress != null) {
            miniProgress.Width = infoWidth;
            if (pictureMiniView != null) Move(pictureMiniView, infoX, infoY + copy.Height * scale + 12 * scale, infoWidth, 28);
        }
        lyricsHost.UpdateLayout(); UpdateLyricsDepth();
        if (following && activeIndex >= 0 && lyricsPanel.Children.OfType<Button>().FirstOrDefault(b => b.Tag is int i && i == activeIndex) is { } current) {
            double lineY = current.TransformToVisual(lyricsPanel).TransformPoint(default).Y;
            lyricsScroll.ChangeView(null, Math.Clamp(lineY + current.ActualHeight / 2 - lyricsScroll.ViewportHeight * (split ? .35 : .5), 0, lyricsScroll.ScrollableHeight), null, true);
        }
    }

    private void LyricsDepthChanged(object? sender, ScrollViewerViewChangedEventArgs args) => UpdateLyricsDepth();
    /// <summary>Lines fade out at both edges of the viewport over the same band (web: .has-depth mask).</summary>
    private void UpdateLyricsDepth()
    {
        if (picturePresentation == null || lyricsScroll.ViewportHeight <= 0) return;
        double viewport = lyricsScroll.ViewportHeight, edge = Math.Max(1, viewport * Immersive.LyricsEdge);
        foreach (var button in lyricsPanel.Children.OfType<Button>()) {
            if (button.Tag is not int i) continue;
            double y = button.TransformToVisual(lyricsPanel).TransformPoint(default).Y - lyricsScroll.VerticalOffset;
            int distance = activeIndex < 0 ? 4 : Math.Min(4, Math.Abs(i - activeIndex));
            double emphasis = i == activeIndex ? 1 : Math.Max(.25, .65 - distance * .1);
            double fade = Math.Clamp((y + button.ActualHeight) / edge, 0, 1) * Math.Clamp((viewport - y) / edge, 0, 1);
            button.Opacity = emphasis * fade;
        }
    }

    private void ReleasePresentation() => lyricsScroll.ViewChanged -= LyricsDepthChanged;
}
