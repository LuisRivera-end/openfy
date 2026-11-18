using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using System.Numerics;
using Openfy.Core;
using Openfy.Windows.Graphics;
using Openfy.Windows.Services;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class PlayerWindow
{
    private Grid? pictureRoot;
    private Canvas? pictureOverlay;
    private Grid? pictureCapture;
    private Grid? miniProgress;
    private ProgressBar? miniBar;
    private Border? miniFill;
    private string[] previewPalette = ["#28483e", "#18212e", "#111113"];
    private TextBlock? miniPosition, miniDuration, nextCountdown, nextTitle, nextArtist, nextDuration;
    private Border? nextCard;
    private Image? nextCover, flyingCover;
    private DispatcherQueueTimer? pictureTimer;
    private SongRow? previewSong;
    private string? visualQueueId;
    private int previewGeneration;
    private long lastInteraction, hideAfter, morphStarted;
    private long sceneSwitchAt;
    private bool sceneSwitching;
    private bool pictureIdle, pointerHeld, keyboardInput, promoting;
    private bool pictureActive = true, pointerAway, mouseHeld;
    private global::Windows.Foundation.Point? lastPointer;
    private global::Windows.Foundation.Rect previewBounds, destinationBounds;
    // The card has a docked and a compact-corner geometry; switching between them is tweened per frame
    // so the ambient preview region stays glued to it.
    private Immersive.CardBounds cardFrom, cardTo;
    private double cardScale = 1;
    private long cardMoveStarted;
    private bool cardMoving, cardPlaced;
    private bool HoldingBigPicture => Full && previewSong != null && previewSong.Entry.QueueId == model.Current?.Entry.QueueId && visualQueueId != model.Current?.Entry.QueueId;
    private bool PictureMotion => model.Settings.Effects && WindowsIntegration.AnimationsEnabled;

    private static Grid Dock(FrameworkElement child)
    {
        child.Margin = new Thickness(0);
        var wrapper = new Grid(); wrapper.Children.Add(child); return wrapper;
    }
    private IEnumerable<Grid> PictureDocks => new[] { seekBlock, transportRow, footerRow }.OfType<Grid>();

    private void InitializeBigPicture(Grid root)
    {
        pictureRoot = root; visualQueueId = model.Current?.Entry.QueueId;
        // The fullscreen presentation can retain outgoing metadata while the next decoder is preparing.
        title.ClearValue(TextBlock.TextProperty); artist.ClearValue(TextBlock.TextProperty);
        title.Text = model.Title; artist.Text = model.Artist;
        pictureCapture = new Grid(); root.Children.Remove(layer); pictureCapture.Children.Add(layer); root.Children.Add(pictureCapture);
        InitializePresentation();
        pictureOverlay = new Canvas { IsHitTestVisible = false }; pictureCapture.Children.Add(pictureOverlay);
        miniProgress = new Grid { Height = 28, Visibility = Visibility.Collapsed };
        miniBar = new ProgressBar { Minimum = 0, Maximum = 100, Height = 2, MinHeight = 0, Foreground = Ui.Brush("#FFFFFF"), Background = Ui.Brush("#FFFFFF33"), VerticalAlignment = VerticalAlignment.Top };
        AutomationProperties.SetName(miniBar, "Progreso de la canción"); miniProgress.Children.Add(miniBar);
        miniFill = new Border { Height = 2, Background = Ui.Brush("#FFFFFF"), HorizontalAlignment = HorizontalAlignment.Left };
        miniProgress.Children.Add(new Border { Height = 2, Background = Ui.Brush("#FFFFFF33"), VerticalAlignment = VerticalAlignment.Top, Child = miniFill });
        miniPosition = PlayerControls.Time(TextAlignment.Left); miniDuration = PlayerControls.Time(TextAlignment.Right);
        foreach (var text in new[] { miniPosition, miniDuration }) { text.FontSize = 10; text.Foreground = Ui.Brush("#FFFFFF86"); text.VerticalAlignment = VerticalAlignment.Bottom; miniProgress.Children.Add(text); }
        pictureMiniView = new Grid(); pictureMiniView.Children.Add(miniProgress); pictureOverlay.Children.Add(pictureMiniView);
        var card = new Grid { Padding = new Thickness(16), ColumnSpacing = 16 };
        card.ColumnDefinitions.Add(new() { Width = new GridLength(80) }); card.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        nextCover = Ui.Image(80); var coverFrame = new Border { CornerRadius = new(8), Child = nextCover, Background = Ui.Brush("#FFFFFF12") }; card.Children.Add(coverFrame);
        var copy = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        copy.Children.Add(Ui.Text("A continuación", 12));
        nextTitle = PlayerControls.SingleLine("", 16, true); nextArtist = PlayerControls.SingleLine("", 13); nextArtist.Opacity = .75;
        nextTitle.Tag = nextArtist.Tag = "display";
        copy.Children.Add(nextTitle); copy.Children.Add(nextArtist);
        var timing = new Grid { Margin = new Thickness(0, 4, 0, 0) }; timing.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); timing.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        nextCountdown = Ui.Text("", 12); nextDuration = Ui.Text("", 12); nextCountdown.Opacity = nextDuration.Opacity = .75;
        timing.Children.Add(nextCountdown); Grid.SetColumn(nextDuration, 1); timing.Children.Add(nextDuration); copy.Children.Add(timing);
        Grid.SetColumn(copy, 1); card.Children.Add(copy);
        nextCard = new Border { Height = 120, CornerRadius = new(16), Child = card, BorderThickness = new(1), BorderBrush = Ui.Brush("#FFFFFF1A"), Visibility = Visibility.Collapsed, Tag = "ambient-preview" };
        AutomationProperties.SetName(nextCard, "Siguiente canción"); AutomationProperties.SetLiveSetting(nextCard, AutomationLiveSetting.Polite);
        pictureOverlay.Children.Add(nextCard);
        flyingCover = Ui.Image(80); flyingCover.Visibility = Visibility.Collapsed; pictureOverlay.Children.Add(flyingCover);
        pictureTimer = DispatcherQueue.CreateTimer(); pictureTimer.Interval = TimeSpan.FromMilliseconds(100); pictureTimer.Tick += PictureTick;
        model.PropertyChanged += PictureChanged; model.QueueChanged += PictureQueueChanged;
        PointerEventHandler moved = (_, args) => { var point = args.GetCurrentPoint(root).Position; if (lastPointer == point) return; lastPointer = point; pointerAway = false; keyboardInput = false; PictureActivity(); };
        PointerEventHandler pressed = (_, args) => { pointerHeld = true; mouseHeld = args.Pointer.PointerDeviceType == Microsoft.UI.Input.PointerDeviceType.Mouse; pointerAway = false; keyboardInput = false; PictureActivity(); };
        PointerEventHandler releasedPointer = (_, _) => { pointerHeld = false; mouseHeld = false; PictureActivity(); };
        PointerEventHandler exited = (_, args) => {
            var point = args.GetCurrentPoint(root).Position;
            if (point.X >= 0 && point.Y >= 0 && point.X < root.ActualWidth && point.Y < root.ActualHeight) return;
            LeavePicture();
        };
        PointerEventHandler lostCapture = (_, _) => { pointerHeld = false; mouseHeld = false; };
        PointerEventHandler wheel = (_, _) => PictureActivity();
        KeyEventHandler key = (_, _) => { keyboardInput = true; pointerAway = false; PictureActivity(); };
        root.AddHandler(UIElement.PointerMovedEvent, moved, true); root.AddHandler(UIElement.PointerPressedEvent, pressed, true);
        root.AddHandler(UIElement.PointerReleasedEvent, releasedPointer, true); root.AddHandler(UIElement.PointerCanceledEvent, releasedPointer, true);
        root.AddHandler(UIElement.PointerWheelChangedEvent, wheel, true); root.AddHandler(UIElement.KeyDownEvent, key, true);
        root.AddHandler(UIElement.PointerExitedEvent, exited, true); root.AddHandler(UIElement.PointerCaptureLostEvent, lostCapture, true);
        RoutedEventHandler loaded = (_, _) => ResetBigPicture(); root.Loaded += loaded;
        SizeChangedEventHandler resize = (_, _) => { if (promoting) FinishPromotion(); SetPictureIdle(false); lastInteraction = Environment.TickCount64; QueuePresentation(); };
        root.SizeChanged += resize;
        global::Windows.Foundation.TypedEventHandler<object, WindowActivatedEventArgs> activated = (_, args) => SetPictureActive(args.WindowActivationState != WindowActivationState.Deactivated);
        Activated += activated;
        Ui.OnRelease(root, () => {
            ReleasePresentation();
            StopBigPicture(); pictureTimer.Tick -= PictureTick; model.PropertyChanged -= PictureChanged; model.QueueChanged -= PictureQueueChanged;
            root.RemoveHandler(UIElement.PointerMovedEvent, moved); root.RemoveHandler(UIElement.PointerPressedEvent, pressed);
            root.RemoveHandler(UIElement.PointerReleasedEvent, releasedPointer); root.RemoveHandler(UIElement.PointerCanceledEvent, releasedPointer);
            root.RemoveHandler(UIElement.PointerWheelChangedEvent, wheel); root.RemoveHandler(UIElement.KeyDownEvent, key);
            root.RemoveHandler(UIElement.PointerExitedEvent, exited); root.RemoveHandler(UIElement.PointerCaptureLostEvent, lostCapture);
            root.Loaded -= loaded; root.SizeChanged -= resize; Activated -= activated;
        });
        lastInteraction = Environment.TickCount64;
    }
    private void PictureChanged(object? sender, PropertyChangedEventArgs args) { if (Full && pictureRoot != null && Visible) UpdatePicture(); }
    private void PictureQueueChanged() { if (Full && pictureRoot != null && Visible) UpdatePicture(); }
    private void ResetBigPicture()
    {
        if (pictureTimer == null) return;
        pointerHeld = false; mouseHeld = false; keyboardInput = false; pointerAway = false; lastPointer = null; PictureActivity(); pictureTimer.Start(); UpdatePicture(); RefreshMotion();
    }
    private void StopBigPicture()
    {
        pictureTimer?.Stop(); CancelPreview(); sceneSwitching = false;
    }
    private void PictureActivity() { lastInteraction = Environment.TickCount64; SetPictureIdle(false); }
    private void LeavePicture() { pointerAway = true; keyboardInput = false; }
    private void SetPictureActive(bool active)
    {
        pictureActive = active;
        if (!active) { LeavePicture(); pointerHeld = false; mouseHeld = false; }
        // Losing focus to another monitor is inactivity, not a reason to stop observing it.
        if (!released && AppWindow.IsVisible) pictureTimer?.Start();
    }
    private bool DockKeyboardFocus()
    {
        if (!pictureActive || pointerAway || pictureRoot?.XamlRoot == null) return false;
        DependencyObject? focused = FocusManager.GetFocusedElement(pictureRoot.XamlRoot) as DependencyObject;
        if (!keyboardInput && focused is not Control { FocusState: FocusState.Keyboard }) return false;
        while (focused != null) { if (PictureDocks.Any(dock => ReferenceEquals(dock, focused))) return true; focused = VisualTreeHelper.GetParent(focused); }
        return false;
    }
    private static void Fade(FrameworkElement element, bool show, bool motion)
    {
        element.OpacityTransition = motion ? new ScalarTransition { Duration = TimeSpan.FromMilliseconds(320) } : null;
        element.Opacity = show ? 1 : 0;
        // Use the XAML composition properties together; RenderTransform cannot be mixed with facade transitions.
        element.TranslationTransition = motion ? new Vector3Transition { Duration = TimeSpan.FromMilliseconds(320) } : null;
        element.Translation = new Vector3(0, show ? 0 : 8, 0);
    }
    private void SetPictureIdle(bool idle)
    {
        if (miniProgress == null || pictureIdle == idle) return;
        pictureIdle = idle; hideAfter = Environment.TickCount64 + (PictureMotion ? 320 : 0);
        foreach (var dock in PictureDocks) {
            var child = (FrameworkElement)dock.Children[0];
            if (idle) dock.Height = Math.Max(dock.ActualHeight, child.ActualHeight);
            child.Visibility = Visibility.Visible; child.IsHitTestVisible = !idle;
            if (idle && pictureRoot?.XamlRoot != null && FocusManager.GetFocusedElement(pictureRoot.XamlRoot) is Control focused && focused.FocusState != FocusState.Keyboard)
                (header as Grid)?.Children.OfType<Button>().FirstOrDefault()?.Focus(FocusState.Programmatic);
            Fade(child, !idle, PictureMotion);
            if (!idle) dock.Height = double.NaN;
        }
        miniProgress.Visibility = Visibility.Visible; Fade(miniProgress, idle, PictureMotion); UpdatePresentation(true); PositionPicture();
    }
    private void PictureTick(DispatcherQueueTimer sender, object args)
    {
        if (!Visible) { StopBigPicture(); return; }
        // A release outside this window may not be routed back to the pressed control.
        if (pointerHeld && mouseHeld && !WindowsIntegration.PointerButtonsDown) { pointerHeld = false; mouseHeld = false; }
        if (!pointerHeld && !DockKeyboardFocus() && Environment.TickCount64 - lastInteraction >= Immersive.IdleMilliseconds) SetPictureIdle(true);
        if (Environment.TickCount64 >= hideAfter) {
            foreach (var dock in PictureDocks) if (pictureIdle) ((FrameworkElement)dock.Children[0]).Visibility = Visibility.Collapsed;
            if (!pictureIdle && miniProgress != null) miniProgress.Visibility = Visibility.Collapsed;
        }
        UpdatePicture();
    }
    private void PositionPicture()
    {
        if (pictureRoot == null || miniProgress == null || info == null || seekBlock == null || nextCard == null) return;
        UpdatePresentation();
        if (previewSong == null || promoting) return;
        var target = CardTarget();
        if (cardMoving) { cardTo = target; return; }
        if (cardPlaced && PictureMotion && target.Scale != cardScale) {
            cardFrom = new(previewBounds.X, previewBounds.Y, previewBounds.Width, previewBounds.Height, cardScale); cardTo = target;
            cardMoveStarted = Environment.TickCount64; cardMoving = true;
            CompositionTarget.Rendering += CardFrame; CardFrame(null, EventArgs.Empty);
            return;
        }
        ApplyCard(target);
    }
    /// <summary>Above the dock with the controls visible; the larger bottom-right corner card in compact mode.</summary>
    private Immersive.CardBounds CardTarget()
    {
        var seek = seekBlock!.TransformToVisual(pictureRoot).TransformPoint(default);
        double contentWidth = stage?.ActualWidth ?? pictureRoot!.ActualWidth - 40;
        double right = (stage?.TransformToVisual(pictureRoot).TransformPoint(default).X ?? 20) + (stage?.ActualWidth ?? Math.Max(1, Math.Min(Immersive.CardWidth, contentWidth)));
        return Immersive.NextCardBounds(pictureRoot!.ActualWidth, pictureRoot.ActualHeight, right, contentWidth, seek.Y, pictureIdle);
    }
    private void ApplyCard(Immersive.CardBounds bounds)
    {
        if (nextCard == null) return;
        previewBounds = new(bounds.X, bounds.Y, bounds.Width, bounds.Height); cardScale = bounds.Scale; cardPlaced = true;
        // One layout, uniformly scaled: the box is (width / scale) × CardHeight.
        nextCard.Width = bounds.Width / bounds.Scale; nextCard.Height = Immersive.CardHeight;
        nextCard.Scale = new((float)bounds.Scale, (float)bounds.Scale, 1);
        Canvas.SetLeft(nextCard, bounds.X); Canvas.SetTop(nextCard, bounds.Y);
        surface?.PositionPreview(bounds.X, bounds.Y, bounds.Width, bounds.Height, 16 * bounds.Scale);
    }
    private void CardFrame(object? sender, object args)
    {
        if (!cardMoving || promoting || released) { StopCardMove(); return; }
        double raw = Math.Clamp((Environment.TickCount64 - cardMoveStarted) / (double)Immersive.CompactMilliseconds, 0, 1), t = raw * raw * (3 - 2 * raw);
        double Mix(double a, double b) => a + (b - a) * t;
        ApplyCard(new(Mix(cardFrom.X, cardTo.X), Mix(cardFrom.Y, cardTo.Y), Mix(cardFrom.Width, cardTo.Width), Mix(cardFrom.Height, cardTo.Height), Mix(cardFrom.Scale, cardTo.Scale)));
        if (raw >= 1 || !PictureMotion) { StopCardMove(); ApplyCard(cardTo); }
    }
    private void StopCardMove()
    {
        if (!cardMoving) return;
        cardMoving = false; CompositionTarget.Rendering -= CardFrame;
    }
    private void UpdatePicture()
    {
        if (pictureRoot == null || released) return;
        if (miniBar != null) miniBar.Value = model.Duration > 0 && double.IsFinite(model.Duration) ? Math.Clamp(model.Position / model.Duration * 100, 0, 100) : 0;
        if (miniFill != null && miniProgress != null) miniFill.Width = miniProgress.ActualWidth * (miniBar?.Value ?? 0) / 100;
        if (miniPosition != null) miniPosition.Text = model.PositionText;
        if (miniDuration != null) miniDuration.Text = model.DurationText;
        if (nextCard != null) nextCard.Background = surface?.Failed == true ? Ui.Gradient(previewPalette[0], previewPalette[^1]) : null;
        string? currentId = model.Current?.Entry.QueueId;
        if (promoting) { if (previewSong?.Entry.QueueId != currentId || model.Error.Length > 0) { CancelPreview(); BeginSceneFade(); } return; }
        if (currentId != visualQueueId) {
            if (HoldingBigPicture && model.Error.Length == 0) {
                var audio = model.Engine.CapturePresence();
                if (audio.Generation == model.SelectionGeneration && audio.State == PlaybackPresenceState.Playing) BeginPromotion();
                if (nextCountdown != null) nextCountdown.Text = "Preparando reproducción…";
                return;
            }
            CancelPreview(); BeginSceneFade(); return;
        }
        if (sceneSwitching) {
            if (Environment.TickCount64 < sceneSwitchAt) return;
            sceneSwitching = false; SyncPicture();
            Fade(artworkFrame, true, PictureMotion); if (info != null) Fade(info, true, PictureMotion); if (lyricsHost != null) Fade(lyricsHost, true, PictureMotion);
        }
        title.Text = model.Title; artist.Text = model.Artist;
        var seconds = Immersive.UpcomingSeconds(model.Position, model.Duration);
        var next = model.NextAutomatic;
        if (seconds == null || next == null || next.Entry.QueueId == currentId || model.RepeatMode == "one" || model.Error.Length > 0) { if (previewSong != null) CancelPreview(); return; }
        if (previewSong?.Entry.QueueId != next.Entry.QueueId || previewSong?.Artwork != next.Artwork) {
            CancelPreview(); previewSong = next;
            nextTitle!.Text = next.Title; nextArtist!.Text = next.Artist; nextDuration!.Text = next.Duration > 0 ? next.Length : "";
            nextCard!.Visibility = Visibility.Visible; nextCard.Opacity = 1;
            AutomationProperties.SetName(nextCard, $"A continuación: {next.Title}, {next.Artist}");
            FrameworkElementAutomationPeer.FromElement(nextCard)?.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
            nextCover!.Source = null;
            surface?.SetPreview(Ambient.PaletteTexture(["#28483e", "#18212e", "#111113"]));
            PositionPicture(); _ = PreparePreviewAsync(next, ++previewGeneration);
        }
        nextCountdown!.Text = model.Engine.CapturePresence().State == PlaybackPresenceState.Paused ? $"En pausa · {seconds} s restantes" : model.Engine.Buffering || seconds == 0 ? "Preparando reproducción…" : !model.Playing ? $"En pausa · {seconds} s restantes" : $"Empieza en {seconds} s";
        PositionPicture();
    }
    private async Task PreparePreviewAsync(SongRow row, int own)
    {
        byte[] pixels = Ambient.PaletteTexture(["#28483e", "#18212e", "#111113"]);
        string[] palette = ["#28483e", "#18212e", "#111113"];
        string? path = null;
        int pixelWidth = 0, pixelHeight = 0;
        try {
            if (row.Artwork != null) { var result = await model.Artwork.GetAsync(row.Artwork, 1024); path = result.Path; pixelWidth = result.Width; pixelHeight = result.Height; palette = result.Palette; pixels = await ArtworkPixels.LoadAsync(path) ?? Ambient.PaletteTexture(result.Palette); }
        } catch { /* Keep the same palette fallback as the principal ambient. */ }
        if (own != previewGeneration || previewSong?.Entry.QueueId != row.Entry.QueueId || released) return;
        previewPalette = palette;
        if (path != null) Ui.Cover(nextCover!, path, 1024, 1024, pixelWidth, pixelHeight);
        surface?.SetPreview(pixels); PositionPicture();
    }
    private void CancelPreview()
    {
        previewGeneration++; CompositionTarget.Rendering -= PromotionFrame;
        StopCardMove(); cardPlaced = false;
        promoting = false; previewSong = null; surface?.ClearPreview();
        if (nextCard != null) nextCard.Visibility = Visibility.Collapsed;
        if (flyingCover != null) flyingCover.Visibility = Visibility.Collapsed;
        QueuePresentation();
        if (Full) { artworkFrame.Opacity = 1; if (info != null) info.Opacity = 1; if (lyricsHost != null) lyricsHost.Opacity = 1; }
    }
    private void SyncPicture()
    {
        visualQueueId = model.Current?.Entry.QueueId; title.Text = model.Title; artist.Text = model.Artist; Ui.Cover(artwork, model.Cover);
        RefreshMotion();
    }
    private void BeginSceneFade()
    {
        if (!PictureMotion) { SyncPicture(); return; }
        visualQueueId = model.Current?.Entry.QueueId; sceneSwitching = true; sceneSwitchAt = Environment.TickCount64 + 160;
        Fade(artworkFrame, false, true); if (info != null) Fade(info, false, true); if (lyricsHost != null) Fade(lyricsHost, false, true);
    }
    private void BeginPromotion()
    {
        if (pictureRoot == null || previewSong == null || nextCover == null || flyingCover == null || nextCard == null) return;
        if (!PictureMotion) { FinishPromotion(); return; }
        StopCardMove(); UpdatePresentation();
        destinationBounds = presentationArtBounds;
        promoting = true; morphStarted = Environment.TickCount64;
        flyingCover.Source = nextCover.Source; flyingCover.Visibility = Visibility.Visible;
        nextCard.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(150) }; nextCard.Opacity = 0;
        artworkFrame.Opacity = 0;
        if (info != null) Fade(info, false, true); if (lyricsHost != null) Fade(lyricsHost, false, true);
        CompositionTarget.Rendering += PromotionFrame; PromotionFrame(null, EventArgs.Empty);
    }
    private void PromotionFrame(object? sender, object args)
    {
        if (!promoting || pictureRoot == null || flyingCover == null) return;
        double raw = Math.Clamp((Environment.TickCount64 - morphStarted) / (double)Immersive.TransitionMilliseconds, 0, 1), t = raw * raw * (3 - 2 * raw);
        double Mix(double a, double b) => a + (b - a) * t;
        surface?.PositionPreview(Mix(previewBounds.X, 0), Mix(previewBounds.Y, 0), Mix(previewBounds.Width, pictureRoot.ActualWidth), Mix(previewBounds.Height, pictureRoot.ActualHeight), 16 * cardScale * (1 - t));
        // The cover leaves from its place inside the (possibly scaled) card.
        Canvas.SetLeft(flyingCover, Mix(previewBounds.X + 16 * cardScale, destinationBounds.X)); Canvas.SetTop(flyingCover, Mix(previewBounds.Y + 20 * cardScale, destinationBounds.Y));
        flyingCover.Width = Mix(80 * cardScale, destinationBounds.Width); flyingCover.Height = Mix(80 * cardScale, destinationBounds.Height);
        if (raw >= 1 || !PictureMotion) FinishPromotion();
    }
    private void FinishPromotion()
    {
        surface?.ClearPreview(true); CancelPreview(); SyncPicture(); BuildLyrics();
        if (PictureMotion) {
            if (info != null) { info.OpacityTransition = null; info.Opacity = 0; }
            if (lyricsHost != null) { lyricsHost.OpacityTransition = null; lyricsHost.Opacity = 0; }
        }
        if (info != null) Fade(info, true, PictureMotion); if (lyricsHost != null) Fade(lyricsHost, true, PictureMotion);
    }
}
