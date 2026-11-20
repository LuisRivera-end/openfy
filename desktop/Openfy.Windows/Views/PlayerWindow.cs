using System.ComponentModel;
using System.Numerics;
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Graphics;
using Openfy.Windows.Services;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class PlayerWindow : Window
{
    private static readonly global::Windows.UI.Color Lit = global::Windows.UI.Color.FromArgb(255, 255, 255, 255), Dim = global::Windows.UI.Color.FromArgb(92, 255, 255, 255);
    private readonly MainViewModel model;
    private readonly string kind;
    private ReactiveSurface? surface;
    private readonly Image artwork;
    private readonly Border artworkFrame;
    private readonly StackPanel lyricsPanel = new() { Spacing = 2 };
    private readonly ScrollViewer lyricsScroll;
    private readonly Button play, shuffle, repeat;
    private readonly Button? favorite, follow;
    private readonly TextBlock source, title, artist;
    // Fullscreen: one grid whose rows and columns follow Immersive.Layout (cover, split or stacked).
    private readonly Grid? stage, lyricsHost;
    private readonly FrameworkElement? header, info, seekBlock, transportRow, footerRow;
    // Mini and widget: the current (and, in the widget, next) synchronized line.
    private readonly StackPanel? compactLyrics;
    private string layout = "";
    // Big Picture keeps the lyrics column only for synced lyrics (Immersive.BigPictureLyrics).
    // The first answer after opening is applied directly; later changes slide the song.
    private bool lyricsPane = true, layoutSlide, lyricsAnswered;
    private double layoutWidth, layoutHeight;
    private int lyricsPaneGeneration;
    private bool following = true;
    private bool lyricsNeedSnap;
    private double? active;
    private int activeIndex = -1;
    private LyricWords? activeWords;
    private LyricsLine? activeLine;
    private double? activeNext;
    private bool sweeping;
    private readonly Action notifyClosed;
    private readonly ScrollViewer layer;
    private bool released, destroying;
    // Closing only hides the window: skip lyric/artwork rebuilds while hidden and catch up in ShowView.
    private bool hidden, lyricsStale, artworkStale;
    private bool Full => kind == "fullscreen";
    private bool LyricsOn => Full || compactLyrics != null && model.Settings.CompactLyrics;
    public new bool Visible => WindowsIntegration.Visible(WindowsIntegration.Handle(this));
    public string Diagnostics => surface?.Diagnostics ?? "Preparando gráficos";
    public double TargetFps => surface?.Target ?? 0;
    public double ActualFps => surface?.ActualFps ?? 0;
    public string Layout => layout;

    public PlayerWindow(MainViewModel state, string role, WindowPlacement? placement, Action closed)
    {
        model = state; kind = role; notifyClosed = closed; Title = role == "fullscreen" ? "Openfy · Pantalla completa" : role == "mini" ? "Openfy · Mini" : "Openfy · Widget";
        bool full = role == "fullscreen", mini = role == "mini";
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Openfy.ico"));
        var root = new Grid { RequestedTheme = ElementTheme.Dark, Background = Ui.Brush("#101314") };
        var background = new SwapChainPanel(); root.Children.Add(background);
        var presenter = (OverlappedPresenter)AppWindow.Presenter; presenter.SetBorderAndTitleBar(false, false); presenter.IsAlwaysOnTop = mini;
        presenter.IsResizable = role != "widget" || !model.Settings.WidgetLocked;
        // Without the maximize style Windows does not Snap the mini or widget to half the screen during touch drags.
        if (!full) presenter.IsMaximizable = false;
        AppWindow.IsShownInSwitchers = full;
        if (mini) WindowsIntegration.ResizeDefault(this, 460, 230); else if (role == "widget") WindowsIntegration.ResizeDefault(this, 360, 520); else WindowsIntegration.ResizeDefault(this, 1280, 800);
        WindowsIntegration.Restore(this, placement);

        var page = new Grid();
        var content = new StackPanel { Padding = new Thickness(18, 12, 18, 12), HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Center };
        if (full) { stage = new Grid { HorizontalAlignment = HorizontalAlignment.Center }; page.Children.Add(stage); }
        else page.Children.Add(content);
        void Place(UIElement element) { if (stage != null) stage.Children.Add(element); else content.Children.Add(element); }

        // The mini keeps a shorter header so the sung line fits above the transport.
        var top = new Grid { Height = mini ? 36 : 44, Margin = new Thickness(0, 0, 0, full ? 20 : mini ? 4 : 10), ColumnSpacing = 10 };
        top.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); top.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); top.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var close = Ui.IconButton(full ? "down" : "close", "Cerrar reproductor", Close, 44);
        source = PlayerControls.SingleLine(full ? "De tu biblioteca" : "openfy.", full ? 12 : 14, !full); source.Foreground = Ui.Brush(full ? "#FFFFFFA0" : "#F4F4F5"); source.VerticalAlignment = VerticalAlignment.Center;
        if (full) top.Children.Add(close);
        else { Grid.SetColumnSpan(source, 2); top.Children.Add(source); Grid.SetColumn(close, 2); top.Children.Add(close); }
        header = top; Place(top);

        artwork = Ui.Image(full ? 328 : mini ? 53 : 190);
        var art = new Grid { Background = Ui.Gradient("#28483E", "#151B23") }; artHost = art;
        var disc = Ui.Icon("disc", mini ? 26 : full ? 90 : 62); disc.Opacity = .45; art.Children.Add(disc); art.Children.Add(artwork);
        artworkFrame = new Border { CornerRadius = new CornerRadius(full ? 12 : mini ? 6 : 8), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Child = art };
        lyricsScroll = new ScrollViewer { Content = lyricsPanel, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
        if (full)
        {
            Place(artworkFrame);
            // Fade lines in and out at the edges, as the web mask does.
            lyricsHost = new Grid();
            lyricsHost.Children.Add(lyricsScroll);
            follow = Ui.Button("Seguir reproducción", () => { following = true; active = null; UpdateLyricsFollowing(); PositionChanged(null, new(nameof(model.Position))); });
            follow.HorizontalAlignment = HorizontalAlignment.Center; follow.VerticalAlignment = VerticalAlignment.Bottom; follow.Margin = new Thickness(0, 0, 0, 12); follow.Visibility = Visibility.Collapsed; lyricsHost.Children.Add(follow);
            Place(lyricsHost);
        }
        else if (!mini) content.Children.Add(artworkFrame);

        var copy = new StackPanel { Spacing = full ? 7 : 5, VerticalAlignment = VerticalAlignment.Center };
        title = PlayerControls.SingleLine("", full ? 28 : mini ? 13 : 21, true); Ui.Bind(title, TextBlock.TextProperty, model, nameof(model.Title)); copy.Children.Add(title);
        artist = PlayerControls.SingleLine("", full ? 15 : mini ? 11 : 13); artist.Foreground = Ui.Brush(full ? "#FFFFFF91" : "#A1A1AA"); Ui.Bind(artist, TextBlock.TextProperty, model, nameof(model.Artist)); copy.Children.Add(artist);
        if (!full)
        {
            // The sung line follows the title, with the next line under it in the widget.
            compactLyrics = new StackPanel { Spacing = 3, Visibility = Visibility.Collapsed, Margin = new Thickness(0, mini ? 2 : 6, 0, 0) };
            copy.Children.Add(compactLyrics);
        }
        var details = new Grid { Margin = new Thickness(0, full ? 26 : mini ? 0 : 20, 0, full ? 17 : mini ? 4 : 12), ColumnSpacing = 12 };
        details.ColumnDefinitions.Add(new() { Width = mini ? new GridLength(53) : new GridLength(1, GridUnitType.Star) }); details.ColumnDefinitions.Add(new() { Width = mini ? new GridLength(1, GridUnitType.Star) : GridLength.Auto });
        if (mini) { details.Children.Add(artworkFrame); Grid.SetColumn(copy, 1); details.Children.Add(copy); }
        else
        {
            details.Children.Add(copy);
            favorite = Ui.IconButton("heart", "Añadir a favoritas", () => { if (model.Current is { } current) _ = model.RunAsync(() => model.FavoriteAsync(current)); }, 44); if (!full) favorite.VerticalAlignment = VerticalAlignment.Top; Grid.SetColumn(favorite, 1); details.Children.Add(favorite);
        }
        info = details; Place(details);

        var seek = PlayerControls.Seek(model);
        var timing = new Grid(); timing.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); timing.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var position = PlayerControls.Time(TextAlignment.Left); position.FontSize = 10; position.Foreground = Ui.Brush("#FFFFFF86"); Ui.Bind(position, TextBlock.TextProperty, model, nameof(model.PositionText)); timing.Children.Add(position);
        var duration = PlayerControls.Time(TextAlignment.Right); duration.FontSize = 10; duration.Foreground = position.Foreground; Ui.Bind(duration, TextBlock.TextProperty, model, nameof(model.DurationText)); Grid.SetColumn(duration, 1); timing.Children.Add(duration);
        var seeking = new StackPanel(); seeking.Children.Add(seek); if (!mini) seeking.Children.Add(timing);
        seekBlock = full ? Dock(seeking) : seeking; Place(seekBlock);

        var transport = new Grid { Margin = new Thickness(0, full ? 12 : 8, 0, full ? 17 : 0), ColumnSpacing = mini ? 2 : 8 };
        for (int i = 0; i < 5; i++) transport.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        shuffle = Ui.IconButton("shuffle", "Reproducción aleatoria", model.Shuffle, 44);
        var previous = Ui.IconButton("previous", "Canción anterior", () => _ = model.RunAsync(() => model.AdvanceAsync(-1)), 44);
        play = Ui.PlayButton(() => _ = model.RunAsync(model.ToggleAsync), full ? 68 : 44);
        var next = Ui.IconButton("next", "Canción siguiente", () => _ = model.RunAsync(() => model.AdvanceAsync(1)), 44);
        repeat = Ui.IconButton("repeat", "Repetición", model.CycleRepeat, 44);
        var controls = new[] { shuffle, previous, play, next, repeat };
        for (int i = 0; i < controls.Length; i++) { Grid.SetColumn(controls[i], i); controls[i].HorizontalAlignment = HorizontalAlignment.Center; transport.Children.Add(controls[i]); }
        transportRow = full ? Dock(transport) : transport; Place(transportRow);

        if (full)
        {
            var footer = new Grid { ColumnSpacing = 8 }; footer.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); footer.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
            var device = Ui.Row(Ui.Icon("headphones", 16), Ui.Muted("En este equipo", 11)); device.VerticalAlignment = VerticalAlignment.Center; footer.Children.Add(device);
            var volume = PlayerControls.Volume(90); Ui.Bind(volume, Slider.ValueProperty, model, nameof(model.Volume), BindingMode.TwoWay); AutomationProperties.SetName(volume, "Volumen");
            var volumeRow = Ui.Row(Ui.Icon("volume", 18), volume); Grid.SetColumn(volumeRow, 1); footer.Children.Add(volumeRow);
            footerRow = Dock(footer); Place(footerRow);
        }
        if (role == "widget")
        {
            var locked = Ui.IconButton(model.Settings.WidgetLocked ? "lock" : "unlock", "Bloquear o mover widget", () => { model.Settings.WidgetLocked = !model.Settings.WidgetLocked; presenter.IsResizable = !model.Settings.WidgetLocked; UpdateCaptionRegion(); }, 44);
            RoutedEventHandler updateLock = (_, _) => { Ui.SetIcon(locked, model.Settings.WidgetLocked ? "lock" : "unlock", 18); Ui.SetActive(locked, model.Settings.WidgetLocked); }; locked.Click += updateLock; Ui.OnRelease(locked, () => locked.Click -= updateLock);
            Ui.SetActive(locked, model.Settings.WidgetLocked); locked.HorizontalAlignment = HorizontalAlignment.Right; locked.Margin = new Thickness(0, 8, 0, 0); content.Children.Add(locked);
        }
        PointerEventHandler manual = (_, _) => { following = false; UpdateLyricsFollowing(); };
        lyricsScroll.PointerWheelChanged += manual; lyricsScroll.PointerPressed += manual;
        Ui.OnRelease(lyricsScroll, () => { lyricsScroll.PointerWheelChanged -= manual; lyricsScroll.PointerPressed -= manual; });
        var scroll = new ScrollViewer { Content = page, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        layer = scroll; root.Children.Add(scroll); Content = root; Appearance.Attach(root);
        if (!full)
        {
            // Let Windows own the gesture from press through release, including touch and cross-monitor moves.
            captionInput = InputNonClientPointerSource.GetForWindowId(AppWindow.Id);
            captionHeader = top;
            captionClose = close;
            void OnLayout(object? sender, object args) => UpdateCaptionRegion();
            void OnScroll(object? sender, ScrollViewerViewChangedEventArgs args) => UpdateCaptionRegion();
            top.LayoutUpdated += OnLayout;
            scroll.ViewChanged += OnScroll;
            Ui.OnRelease(top, () => { top.LayoutUpdated -= OnLayout; scroll.ViewChanged -= OnScroll; });
        }
        root.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => model.Updates?.Interacted()), true);
        root.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler((_, _) => model.Updates?.Interacted()), true);
        SizeChangedEventHandler resize = (_, _) => {
            page.MinHeight = root.ActualHeight;
            if (full) ApplyLayout(root.ActualWidth, root.ActualHeight);
            else if (!mini) { double side = Math.Clamp(Math.Min(root.ActualWidth - 56, root.ActualHeight * (model.Settings.CompactLyrics ? .3 : .36)), 110, 250); artwork.Width = artwork.Height = side; }
        };
        root.SizeChanged += resize; Ui.OnRelease(root, () => root.SizeChanged -= resize);
        KeyEventHandler keyboard = (_, args) => { if (args.Key == global::Windows.System.VirtualKey.Escape) Close(); };
        root.KeyDown += keyboard; Ui.OnRelease(root, () => root.KeyDown -= keyboard);
        surface = new(background, this, model);
        if (full) InitializeBigPicture(root);
        model.ArtworkChanged += ArtworkChanged; model.LyricsChanged += BuildLyrics; model.PropertyChanged += PositionChanged; model.ContentChanged += UpdatePlayback;
        ArtworkChanged(); UpdatePlayback(); BuildLyrics();
        if (full) { model.LyricsVisible = true; _ = model.RunAsync(() => model.LoadLyricsAsync()); }
        AppWindow.Changed += SavePlacement; AppWindow.Closing += OnClosing; Closed += OnClosed;
        if (full) AppWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
    }

    private InputNonClientPointerSource? captionInput;
    private FrameworkElement? captionHeader, captionClose;
    private global::Windows.Graphics.RectInt32? captionRegion;

    private void UpdateCaptionRegion()
    {
        if (captionInput == null || captionHeader?.XamlRoot is not { } xaml || captionClose == null) return;
        var region = new global::Windows.Graphics.RectInt32();
        if (kind != "widget" || !model.Settings.WidgetLocked)
        {
            var start = captionHeader.TransformToVisual(null).TransformPoint(default);
            var end = captionClose.TransformToVisual(null).TransformPoint(default);
            double scale = xaml.RasterizationScale;
            int left = (int)Math.Round(start.X * scale);
            int right = (int)Math.Round(end.X * scale);
            int top = (int)Math.Round(Math.Max(0, start.Y) * scale);
            int bottom = (int)Math.Round(Math.Min(xaml.Size.Height, start.Y + captionHeader.ActualHeight) * scale);
            if (right > left && bottom > top) region = new(left, top, right - left, bottom - top);
        }
        if (captionRegion is { } previous && previous.Equals(region)) return;
        if (region.Width > 0) captionInput.SetRegionRects(NonClientRegionKind.Caption, [region]);
        else captionInput.ClearRegionRects(NonClientRegionKind.Caption);
        captionRegion = region;
    }

    /// <summary>
    /// Places the fullscreen pieces (Openfy.Core.Immersive, web twin in main.css). With synced lyrics, split puts a
    /// large cover with title and artist on the left, a shortened lyrics column on the right and every control in a
    /// dock along the bottom; stacked puts a compact header over the lyrics. Without them (plain, instrumental, not
    /// found or failed) cover keeps the split rows and dock with the song alone in the centre. Returns whether the
    /// layout changed (the lyrics were then rebuilt).
    /// </summary>
    private bool ApplyLayout(double width, double height)
    {
        if (stage == null || header == null || info == null || seekBlock == null || transportRow == null || footerRow == null || lyricsHost == null) return false;
        layoutWidth = width; layoutHeight = height;
        string next = Immersive.Layout(width, height, lyricsPane);
        bool changed = next != layout; layout = next;
        bool slide = layoutSlide && PictureMotion;
        FrameworkElement artPlace = pictureArtworkSlot ?? (FrameworkElement)artworkFrame, infoPlace = pictureInfoSlot ?? info, lyricsPlace = pictureLyricsSlot ?? (FrameworkElement)lyricsHost;
        stage.RowDefinitions.Clear(); stage.ColumnDefinitions.Clear();
        void At(FrameworkElement element, int row, int column = 0, int rowSpan = 1, int columnSpan = 1) { Grid.SetRow(element, row); Grid.SetColumn(element, column); Grid.SetRowSpan(element, rowSpan); Grid.SetColumnSpan(element, columnSpan); }
        GridLength Auto = GridLength.Auto, Star = new(1, GridUnitType.Star);
        bool split = layout == Immersive.Split, cover = layout == Immersive.Cover, large = split || cover;
        surface?.SetLyricsScrim(split ? Ambient.LyricsScrim : 0, !slide);
        title.FontSize = large ? 32 : 18; artist.FontSize = large ? 16 : 13;
        artworkFrame.CornerRadius = new CornerRadius(large ? 12 : 6);
        header.Margin = new Thickness(0, 0, 0, large ? 8 : 14);
        lyricsPlace.Visibility = cover ? Visibility.Collapsed : Visibility.Visible;
        double padding = 18, available = Math.Max(0, height - padding - 20);
        stage.Height = available; stage.VerticalAlignment = VerticalAlignment.Top; stage.Margin = new Thickness(0, padding, 0, 20);
        if (split)
        {
            double left = Math.Clamp(width * .3, 320, 520), gap = Math.Clamp(width * .06, 48, 128);
            stage.Width = Math.Min(1520, width - 96);
            stage.ColumnDefinitions.Add(new() { Width = new GridLength(left) }); stage.ColumnDefinitions.Add(new() { Width = new GridLength(gap) }); stage.ColumnDefinitions.Add(new() { Width = Star });
            foreach (var row in new[] { Auto, Star, Auto, Auto, Star, Auto, Auto }) stage.RowDefinitions.Add(new() { Height = row });
            double side = Math.Min(left, height * .52); artwork.Width = artwork.Height = artworkFrame.Width = artworkFrame.Height = side;
            artPlace.Width = artPlace.Height = side;
            infoPlace.Width = side; infoPlace.Height = 68; infoPlace.HorizontalAlignment = HorizontalAlignment.Center; infoPlace.Margin = new Thickness(0, 22, 0, 0);
            At(header, 0, 0, 1, 3); At(artPlace, 2); At(infoPlace, 3); At(lyricsPlace, 1, 2, 4);
            lyricsPlace.Height = height * .56; lyricsPlace.VerticalAlignment = VerticalAlignment.Center; lyricsPlace.Margin = new Thickness(0);
            seekBlock.Margin = new Thickness(0, 20, 0, 0); At(seekBlock, 5, 0, 1, 3);
            // The dock: transport centred over the row that holds the device label and the volume.
            At(footerRow, 6, 0, 1, 3); At(transportRow, 6, 0, 1, 3);
            transportRow.Width = Math.Min(440, stage.Width); transportRow.HorizontalAlignment = HorizontalAlignment.Center; transportRow.Margin = new Thickness(0, 2, 0, 8);
            footerRow.VerticalAlignment = VerticalAlignment.Center;
        }
        else if (cover)
        {
            // Wide: the split rows and dock in one column, so the song slides between its column and the centre while
            // the dock stays put. Narrow (web: the plain cover column): the transport gets its own row above the footer.
            bool wide = Immersive.Layout(width, height, true) == Immersive.Split;
            double left = Math.Clamp(width * .3, 320, 520);
            stage.Width = wide ? Math.Min(1520, width - 96) : Math.Min(620, Math.Max(260, width - 40));
            stage.ColumnDefinitions.Add(new() { Width = Star });
            foreach (var row in new[] { Auto, Star, Auto, Auto, Star, Auto, Auto, Auto }) stage.RowDefinitions.Add(new() { Height = row });
            double side = wide ? Math.Min(left, height * .52) : Math.Min(Math.Min(420, stage.Width), height * .41); artwork.Width = artwork.Height = artworkFrame.Width = artworkFrame.Height = side;
            artPlace.Width = artPlace.Height = side;
            infoPlace.Width = side; infoPlace.Height = 68; infoPlace.HorizontalAlignment = HorizontalAlignment.Center; infoPlace.Margin = new Thickness(0, 22, 0, 0);
            At(header, 0); At(artPlace, 2); At(infoPlace, 3); At(lyricsPlace, 1);
            seekBlock.Margin = new Thickness(0, 20, 0, 0); At(seekBlock, 5);
            if (wide) {
                At(footerRow, 6); At(transportRow, 6);
                transportRow.Width = Math.Min(440, stage.Width); transportRow.HorizontalAlignment = HorizontalAlignment.Center; transportRow.Margin = new Thickness(0, 2, 0, 8);
                footerRow.VerticalAlignment = VerticalAlignment.Center;
            } else {
                At(transportRow, 6); At(footerRow, 7);
                transportRow.Width = double.NaN; transportRow.HorizontalAlignment = HorizontalAlignment.Stretch; transportRow.Margin = new Thickness(0, 12, 0, 17);
            }
        }
        else
        {
            stage.Width = Math.Min(620, Math.Max(260, width - 40));
            stage.ColumnDefinitions.Add(new() { Width = new GridLength(56) }); stage.ColumnDefinitions.Add(new() { Width = new GridLength(14) }); stage.ColumnDefinitions.Add(new() { Width = Star });
            foreach (var row in new[] { Auto, Auto, Star, Auto, Auto, Auto }) stage.RowDefinitions.Add(new() { Height = row });
            artwork.Width = artwork.Height = artworkFrame.Width = artworkFrame.Height = 56;
            artPlace.Width = artPlace.Height = 56;
            infoPlace.Width = double.NaN; infoPlace.Height = 44; infoPlace.HorizontalAlignment = HorizontalAlignment.Stretch; infoPlace.Margin = new Thickness(0, 0, 0, 40);
            At(header, 0, 0, 1, 3); At(artPlace, 1); At(infoPlace, 1, 2); At(lyricsPlace, 2, 0, 1, 3); At(seekBlock, 3, 0, 1, 3); At(transportRow, 4, 0, 1, 3); At(footerRow, 5, 0, 1, 3);
            lyricsPlace.Height = double.NaN; lyricsPlace.VerticalAlignment = VerticalAlignment.Stretch; lyricsPlace.Margin = new Thickness(0, 12, 0, 4);
            seekBlock.Margin = new Thickness(0);
            transportRow.Width = double.NaN; transportRow.HorizontalAlignment = HorizontalAlignment.Stretch; transportRow.Margin = new Thickness(0, 12, 0, 17);
        }
        // Leave room so the first and last lines can reach the follow anchor.
        double box = split ? height * .56 : available;
        lyricsPanel.Padding = new Thickness(4, Math.Max(0, box * .2), 4, Math.Max(0, box * .6));
        if (changed) { ShowLyricsPane(!cover, slide); BuildLyrics(); RefreshMotion(); }
        else layoutSlide = false;
        QueuePresentation();
        return changed;
    }

    /// <summary>Re-evaluates the Big Picture lyrics column; a change slides the song (true when the layout was rebuilt).</summary>
    private bool UpdateLyricsPane()
    {
        if (!Full || HoldingBigPicture || promoting || layoutWidth <= 0) return false;
        bool next = Immersive.BigPictureLyrics(model.Lyrics?.Status, model.LyricsPending, lyricsPane), slide = lyricsAnswered;
        if (!model.LyricsPending) lyricsAnswered = true;
        if (next == lyricsPane) return false;
        lyricsPane = next; layoutSlide = slide;
        return ApplyLayout(layoutWidth, layoutHeight);
    }

    /// <summary>The lyrics column fades aside while the song slides; on the way back it appears once the song has arrived.</summary>
    private async void ShowLyricsPane(bool show, bool motion)
    {
        if (pictureLyricsView is not { } view) return;
        int own = ++lyricsPaneGeneration;
        view.OpacityTransition = motion ? new ScalarTransition { Duration = TimeSpan.FromMilliseconds(250) } : null;
        if (show) {
            view.Visibility = Visibility.Visible;
            if (motion) { view.Opacity = 0; await Task.Delay(Immersive.LayoutMilliseconds - 250); if (own != lyricsPaneGeneration || released) return; }
            view.Opacity = 1;
        } else {
            view.Opacity = 0;
            if (motion) { await Task.Delay(250); if (own != lyricsPaneGeneration || released) return; }
            view.Visibility = Visibility.Collapsed;
        }
    }

    private void UpdateLyricsFollowing() { if (follow != null) follow.Visibility = !following ? Visibility.Visible : Visibility.Collapsed; }

    private void UpdatePlayback()
    {
        bool enabled = model.Current != null; play.IsEnabled = shuffle.IsEnabled = repeat.IsEnabled = enabled;
        Ui.SetIcon(play, model.Playing ? "pause" : "play", Full ? 28 : 20); AutomationProperties.SetName(play, model.PlayLabel); ToolTipService.SetToolTip(play, model.PlayLabel);
        Ui.SetActive(shuffle, model.ShuffleEnabled); Ui.SetActive(repeat, model.RepeatMode != "off"); Ui.SetIcon(repeat, model.RepeatMode == "one" ? "repeatOne" : "repeat", 18);
        string repeatLabel = "Repetición: " + (model.RepeatMode == "off" ? "desactivada" : model.RepeatMode == "all" ? "toda la cola" : "una canción"); AutomationProperties.SetName(repeat, repeatLabel); ToolTipService.SetToolTip(repeat, repeatLabel);
        if (Full) source.Text = model.Current?.Entry.Source == "youtube" ? "YouTube Music" : "De tu biblioteca";
        if (favorite != null) { bool local = model.Current?.Entry.Source == "local"; favorite.Visibility = local ? Visibility.Visible : Visibility.Collapsed; Ui.SetActive(favorite, local && model.Library.Tracks.Any(track => track.Id == model.Current?.Entry.TrackId && track.Favorite)); }
        UpdateSweep(); SyncMotionPlayback();
    }

    private void SavePlacement(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (Full) return;
        model.Settings.Windows[kind] = WindowsIntegration.Placement(this);
        if (args.DidPositionChange || args.DidSizeChange) model.Updates?.Interacted();
    }
    private void OnClosed(object sender, WindowEventArgs args) { ReleaseResources(); Closed -= OnClosed; }
    private void OnClosing(AppWindow sender, AppWindowClosingEventArgs args) { if (!destroying) { args.Cancel = true; Close(); } }
    public new void Close() { StopBigPicture(); PauseMotion(); AppWindow.Hide(); StopSweep(); hidden = true; surface?.Suspend(); notifyClosed(); }
    public void ShowView(WindowPlacement? placement = null)
    {
        if (Full && placement != null) { AppWindow.SetPresenter(AppWindowPresenterKind.Overlapped); WindowsIntegration.Restore(this, placement); AppWindow.SetPresenter(AppWindowPresenterKind.FullScreen); }
        AppWindow.Show(); Activate();
        if (hidden) {
            hidden = false; surface?.Resume();
            if (artworkStale) { artworkStale = false; ArtworkChanged(); }
            if (lyricsStale) { lyricsStale = false; BuildLyrics(); }
            else { active = null; PositionChanged(null, new(nameof(model.Position))); }
        } if (Full) { lyricsAnswered = false; model.LyricsVisible = true; if (model.Lyrics == null) _ = model.RunAsync(() => model.LoadLyricsAsync()); }
        UpdateCompactVisibility(); UpdateSweep(); if (Full) { ResetBigPicture(); UpdateLyricsPane(); }
    }
    internal void SeekLyricsForCheck() { active = null; PositionChanged(null, new(nameof(model.Position))); }
    /// <summary>Opt-in QA capture: the Direct3D background (CaptureFrame) with the XAML layer composited on top.</summary>
    internal async Task<object> CaptureAsync(string path)
    {
        await Task.Delay(700); layer.UpdateLayout();
        var bitmap = new Microsoft.UI.Xaml.Media.Imaging.RenderTargetBitmap(); await bitmap.RenderAsync(pictureCapture ?? (FrameworkElement)layer);
        byte[] ui = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.ToArray(await bitmap.GetPixelsAsync());
        int width = bitmap.PixelWidth, height = bitmap.PixelHeight;
        byte[]? frame = null; int fw = 0, fh = 0;
        if (surface != null) frame = surface.CaptureFrame(out fw, out fh);
        var output = new byte[width * height * 4];
        for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                int o = (y * width + x) * 4, f = frame == null ? -1 : ((y * fh / height) * fw + x * fw / width) * 4;
                int alpha = ui[o + 3];
                for (int c = 0; c < 3; c++)
                {
                    int background = f < 0 ? (c == 0 ? 0x14 : c == 1 ? 0x13 : 0x10) : frame![f + c];
                    output[o + c] = (byte)Math.Min(255, ui[o + c] + background * (255 - alpha) / 255);
                }
                output[o + 3] = 255;
            }
        var folder = await global::Windows.Storage.StorageFolder.GetFolderFromPathAsync(Path.GetDirectoryName(path)!);
        var file = await folder.CreateFileAsync(Path.GetFileName(path), global::Windows.Storage.CreationCollisionOption.ReplaceExisting);
        using (var stream = await file.OpenAsync(global::Windows.Storage.FileAccessMode.ReadWrite))
        {
            var encoder = await global::Windows.Graphics.Imaging.BitmapEncoder.CreateAsync(global::Windows.Graphics.Imaging.BitmapEncoder.PngEncoderId, stream);
            encoder.SetPixelData(global::Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8, global::Windows.Graphics.Imaging.BitmapAlphaMode.Ignore, (uint)width, (uint)height, 96, 96, output); await encoder.FlushAsync();
        }
        return new { kind, layout, width, height, background = frame != null, words = activeWords != null };
    }
    public void Destroy() { destroying = true; ReleaseResources(); base.Close(); }
    private void ReleaseResources()
    {
        if (released) return; released = true;
        StopSweep(); ReleaseMotion();
        AppWindow.Changed -= SavePlacement; AppWindow.Closing -= OnClosing;
        surface?.Dispose(); surface = null; model.ArtworkChanged -= ArtworkChanged; model.LyricsChanged -= BuildLyrics; model.PropertyChanged -= PositionChanged; model.ContentChanged -= UpdatePlayback;
        if (Content is DependencyObject root) Ui.ReleaseTree(root); Content = null;
    }
    private void ArtworkChanged() { if (hidden) { artworkStale = true; return; } if (!HoldingBigPicture) Ui.Cover(artwork, model.Cover); }

    private double LineSize => layout == Immersive.Split ? Math.Clamp((Content as FrameworkElement)?.ActualWidth * .026 ?? 34, 28, 42) : 24;

    private void BuildLyrics()
    {
        if (hidden) { lyricsStale = true; return; }
        if (HoldingBigPicture || UpdateLyricsPane()) return;
        if (Full) {
            lyricsNeedSnap = true;
            // Cancel the previous song's in-flight scroll before replacing its rows.
            lyricsScroll.ChangeView(null, 0, null, true);
        }
        foreach (var child in lyricsPanel.Children) Ui.ReleaseTree(child);
        lyricsPanel.Children.Clear(); following = true; active = null; activeIndex = -1; activeWords = null; activeLine = null; UpdateLyricsFollowing();
        if (compactLyrics != null) { compactLyrics.Children.Clear(); UpdateCompactVisibility(); }
        if (!Full) { PositionChanged(null, new(nameof(model.Position))); return; }
        if (model.Lyrics is not { } lyrics) { lyricsPanel.Children.Add(Ui.Muted("La letra no está disponible. Puedes reintentar desde la ventana principal.")); return; }
        if (lyrics.Status != "synced")
        {
            var text = Ui.Text(lyrics.Status == "instrumental" ? "Esta canción es instrumental." : lyrics.PlainText.Length > 0 ? lyrics.PlainText : "No encontramos letras para esta canción.", 20); text.LineHeight = 34; text.TextWrapping = TextWrapping.Wrap; lyricsPanel.Children.Add(text);
        }
        else
        {
            double size = LineSize;
            for (int i = 0; i < lyrics.Lines.Length; i++)
            {
                var line = lyrics.Lines[i];
                var button = Ui.AsyncButton(line.Text.Length > 0 ? line.Text : "···", model, () => model.SeekAsync(line.Time));
                var text = Ui.Text(line.Text.Length > 0 ? line.Text : "···", size, true); text.LineHeight = size * 1.3; text.TextWrapping = TextWrapping.Wrap;
                button.Content = text; button.Tag = i; button.Background = Ui.Brush("#FFFFFF00"); button.BorderThickness = new Thickness(0); button.CornerRadius = new CornerRadius(4); button.Padding = new Thickness(0, 10, 6, 10);
                button.HorizontalAlignment = HorizontalAlignment.Stretch; button.HorizontalContentAlignment = HorizontalAlignment.Left; button.Opacity = .25;
                if (WindowsIntegration.AnimationsEnabled) { button.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(250) }; button.ScaleTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(250) }; }
                button.CenterPoint = new Vector3(0, (float)(size * .65), 0);
                lyricsPanel.Children.Add(button);
            }
        }
        if (lyrics.Attribution != null) { var attribution = Ui.Muted(lyrics.Attribution, 11); attribution.Margin = new Thickness(0, 18, 6, 0); lyricsPanel.Children.Add(attribution); }
        PositionChanged(null, new(nameof(model.Position)));
    }

    private void PositionChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName is nameof(model.Playing) or nameof(model.PlayLabel) or nameof(model.Current) or nameof(model.ShuffleEnabled) or nameof(model.RepeatMode)) UpdatePlayback();
        if (HoldingBigPicture) { StopSweep(); return; }
        if (hidden) return;
        if (args.PropertyName != nameof(model.Position) || model.Lyrics is not { Status: "synced" } lyrics || !LyricsOn) return;
        double? time = RenderPolicy.ActiveLyricsTime(lyrics.Lines, model.Position); if (time == active) return; active = time;
        int index = time == null ? -1 : Array.FindIndex(lyrics.Lines, line => line.Time == time);
        activeIndex = index; activeLine = index >= 0 ? lyrics.Lines[index] : null;
        activeNext = index >= 0 && index + 1 < lyrics.Lines.Length ? lyrics.Lines[index + 1].Time : null;
        activeWords = null;
        if (Full) HighlightFullscreen(lyrics);
        else UpdateCompact(lyrics);
        UpdateSweep();
    }

    /// <summary>The sung line at full strength, others fading with distance (web: .lyrics-immersive).</summary>
    private void HighlightFullscreen(LyricsResult lyrics)
    {
        bool motion = WindowsIntegration.AnimationsEnabled;
        foreach (var button in lyricsPanel.Children.OfType<Button>())
        {
            if (button.Tag is not int i) continue;
            int distance = activeIndex < 0 ? 4 : Math.Min(4, Math.Abs(i - activeIndex));
            bool current = i == activeIndex;
            button.Opacity = current ? 1 : Math.Max(.25, .65 - distance * .1);
            button.Scale = current || !motion ? Vector3.One : new Vector3(.97f, .97f, 1);
            var line = lyrics.Lines[i];
            if (current && line.Words is { Length: > 0 } words)
            {
                double size = LineSize;
                activeWords = new LyricWords(words, size, size * 1.3, Lit, Dim);
                button.Content = activeWords.Panel;
                PaintWords(model.Position);
            }
            else if (button.Content is WordWrapPanel)
            {
                var text = Ui.Text(line.Text.Length > 0 ? line.Text : "···", LineSize, true); text.LineHeight = LineSize * 1.3; text.TextWrapping = TextWrapping.Wrap; button.Content = text;
            }
            if (current && following) {
                double anchor = layout == Immersive.Split ? .35 : .5;
                if (lyricsNeedSnap) {
                    lyricsScroll.UpdateLayout();
                    double y = button.TransformToVisual(lyricsPanel).TransformPoint(default).Y;
                    lyricsScroll.ChangeView(null, Math.Clamp(y + button.ActualHeight / 2 - lyricsScroll.ViewportHeight * anchor, 0, lyricsScroll.ScrollableHeight), null, true);
                    lyricsNeedSnap = false;
                }
                else button.StartBringIntoView(new BringIntoViewOptions { VerticalAlignmentRatio = anchor, AnimationDesired = motion });
            }
        }
        UpdateLyricsDepth();
    }

    private void UpdateCompactVisibility()
    {
        if (compactLyrics == null) return;
        bool show = model.Settings.CompactLyrics && model.Lyrics is { Status: "synced" } && compactLyrics.Children.Count > 0;
        compactLyrics.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Mini: the sung line. Widget: the sung line and the next one.</summary>
    private void UpdateCompact(LyricsResult lyrics)
    {
        if (compactLyrics == null) return;
        compactLyrics.Children.Clear();
        bool mini = kind == "mini";
        if (activeLine is { } line && line.Text.Length > 0)
        {
            double size = mini ? 12 : 16;
            FrameworkElement current;
            if (line.Words is { Length: > 0 } words) { activeWords = new LyricWords(words, size, size * 1.3, Lit, Dim); current = activeWords.Panel; PaintWords(model.Position); }
            else { var text = Ui.Text(line.Text, size, true); text.LineHeight = size * 1.3; text.TextWrapping = TextWrapping.Wrap; current = text; }
            // Keep the compact windows to one (mini) or two (widget) lines of the sung verse.
            compactLyrics.Children.Add(new Border { Child = current, MaxHeight = size * 1.3 * (mini ? 1 : 2) + 1 });
            if (!mini && activeIndex + 1 < lyrics.Lines.Length && lyrics.Lines[activeIndex + 1].Text is { Length: > 0 } upcoming)
            {
                var upcomingText = PlayerControls.SingleLine(upcoming, 13); upcomingText.Opacity = .55; compactLyrics.Children.Add(upcomingText);
            }
        }
        UpdateCompactVisibility();
    }

    private void PaintWords(double position)
    {
        if (activeWords == null) return;
        var state = RenderPolicy.ActiveLyricsWord(activeLine, activeNext, position);
        if (state is { } value) activeWords.Update(value.Index, value.Progress);
    }

    // Per-frame word fill, only while a timed line is sung in a visible window.
    private void UpdateSweep()
    {
        bool want = activeWords != null && model.Playing && LyricsOn && !released && AppWindow.IsVisible;
        if (want && !sweeping) { sweeping = true; CompositionTarget.Rendering += OnRendering; }
        else if (!want) StopSweep();
        if (!want && activeWords != null) PaintWords(model.Position);
    }
    private void StopSweep() { if (!sweeping) return; sweeping = false; CompositionTarget.Rendering -= OnRendering; }
    private void OnRendering(object? sender, object args) => PaintWords(model.Engine.Position);
}
