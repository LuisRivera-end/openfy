using System.ComponentModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Openfy.Windows.Services;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private const double PlayerHeight = 72, PlayerMaxWidth = 880, PlayerMargin = 16, PlayerInset = PlayerHeight + PlayerMargin * 2;
    private const double EmptyPlayerHeight = 64, EmptyPlayerWidth = 112;
    private readonly Border playerPill;

    private Border PlayerBar(Grid main)
    {
        var bar = new Border {
            Height = EmptyPlayerHeight, MaxWidth = PlayerMaxWidth, Width = EmptyPlayerWidth, BorderThickness = new(1),
            Margin = new(PlayerMargin, 0, PlayerMargin, PlayerMargin),
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom
        };
        var hairline = Ui.Brush("#FFFFFF2E");
        Appearance.SetStyle(bar, () => {
            bar.Background = PlaybackBackground(playerGlass);
            bar.BorderBrush = hairline;
        });
        var layout = new Grid { ColumnSpacing = 20 };
        layout.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        layout.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        layout.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        bar.Child = layout;

        var now = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        now.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        now.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        var picture = new Grid { Background = Ui.Gradient("#28483E", "#151B23") };
        var fallback = Ui.Icon("music", 20); Ui.Tint(fallback, frameMuted); picture.Children.Add(fallback); picture.Children.Add(cover);
        var artwork = new Border { Child = picture, IsHitTestVisible = false };
        now.Children.Add(artwork);
        var copy = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        var title = PlayerControls.SingleLine("", 14, true); title.Foreground = frameWhite; title.IsHitTestVisible = false;
        Ui.Bind(title, TextBlock.TextProperty, model, nameof(model.Title)); copy.Children.Add(title);
        var artist = NewArtistLink(12, "#A1A1AA"); artist.SetPageForeground(frameMuted); copy.Children.Add(artist);
        void UpdateArtist() => artist.Set(model.Artist, ArtistTarget(model.Current));
        Grid.SetColumn(copy, 1); now.Children.Add(copy);
        // The open button lies underneath the cover and title (which ignore hits) so the artist link can sit on top of it.
        var open = Ui.Button("", () => openPlayer("fullscreen"), "Abrir reproductor ampliado");
        var transparent = Ui.Brush("#FFFFFF00");
        open.Padding = new Thickness(0); open.MinHeight = 0; open.Background = transparent; open.BorderThickness = new Thickness(0);
        foreach (string state in new[] { "PointerOver", "Pressed" }) open.Resources["ButtonBackground" + state] = transparent;
        open.HorizontalAlignment = HorizontalAlignment.Stretch; open.VerticalAlignment = VerticalAlignment.Stretch;
        var nowHost = new Grid { Children = { open, now } };
        var seek = PlayerControls.Seek(model);
        var display = new Grid { Children = { nowHost } };
        StylePlayerTimeline(display, nowHost, seek);

        var hover = Ui.Brush("#FFFFFF14");
        Button Control(string icon, string label, Action action, double glyphSize = 18)
        {
            var button = Ui.IconButton(icon, label, action, 40);
            button.Foreground = frameWhite;
            button.Resources["ButtonBackgroundPointerOver"] = hover;
            Ui.SetIcon(button, icon, glyphSize);
            return button;
        }
        void Previous() => _ = model.RunAsync(() => model.AdvanceAsync(-1));
        void Next() => _ = model.RunAsync(() => model.AdvanceAsync(1));
        var transport = Ui.Row(); transport.Spacing = 4;
        transport.VerticalAlignment = VerticalAlignment.Center; transport.HorizontalAlignment = HorizontalAlignment.Center;
        var shuffle = Control("shuffle", "Reproducción aleatoria", model.Shuffle, 17);
        var previous = Control("previous", "Canción anterior", Previous, 21);
        var play = Control("play", "Reproducir", () => _ = model.RunAsync(model.ToggleAsync), 26);
        var playStates = StateBrushes.Register(play, "ButtonBackgroundDisabled");
        var emptyPlayBackground = Ui.Brush("#F4F4F5");
        var emptyPlayInk = Ui.Brush("#07160B");
        var next = Control("next", "Canción siguiente", Next, 21);
        var repeat = Control("repeat", "Repetición desactivada", model.CycleRepeat, 17);
        foreach (var control in new[] { shuffle, previous, play, next, repeat }) transport.Children.Add(control);
        layout.Children.Add(transport);
        layout.Children.Add(display);

        var tools = Ui.Row(); tools.Spacing = 2; tools.VerticalAlignment = VerticalAlignment.Center; tools.HorizontalAlignment = HorizontalAlignment.Right;
        void ToggleLyrics() => _ = model.RunAsync(async () => {
            lyricsVisible = !lyricsVisible; queueVisible = false; model.LyricsVisible = lyricsVisible; BuildSide(); if (lyricsVisible) await model.LoadLyricsAsync();
        });
        void ToggleQueue() { queueVisible = !queueVisible; lyricsVisible = false; model.LyricsVisible = false; BuildSide(); }
        toggleLyricsPanel = ToggleLyrics;
        toggleQueuePanel = ToggleQueue;
        var lyrics = Control("lyrics", "Letras", ToggleLyrics);
        var queue = Control("queue", "Cola de reproducción", ToggleQueue);
        void UpdatePanels()
        {
            lyrics.Background = lyricsVisible ? frameSurface : Ui.Brush("#FFFFFF00");
            queue.Background = queueVisible ? frameSurface : Ui.Brush("#FFFFFF00");
        }
        var expand = Control("expand", "Pantalla completa", () => openPlayer("fullscreen"));
        var more = Control("more", "Más opciones de reproducción", () => { });
        var volumeIcon = Control("volume", "Volumen", () => { });
        var volumePopup = PlayerControls.Volume(150); Ui.Bind(volumePopup, Slider.ValueProperty, model, nameof(model.Volume), BindingMode.TwoWay); AutomationProperties.SetName(volumePopup, "Volumen");
        volumeIcon.Flyout = new Flyout { Content = volumePopup, Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Top };
        Ui.OnRelease(volumeIcon, () => Ui.ReleaseTree(volumePopup));
        var menu = new MenuFlyout();
        MenuFlyoutItem Menu(string label, Action action) { var item = new MenuFlyoutItem { Text = label }; RoutedEventHandler handler = (_, _) => action(); item.Click += handler; Ui.OnRelease(bar, () => item.Click -= handler); menu.Items.Add(item); return item; }
        var menuLyrics = Menu("Letras", ToggleLyrics);
        var menuQueue = Menu("Cola de reproducción", ToggleQueue);
        Menu("Minirreproductor", () => openPlayer("mini")); Menu("Widget de escritorio", () => openPlayer("widget"));
        var menuShuffle = Menu("Reproducción aleatoria", model.Shuffle);
        var menuRepeat = Menu("Cambiar repetición", model.CycleRepeat);
        var menuPrevious = Menu("Canción anterior", Previous);
        var menuNext = Menu("Canción siguiente", Next);
        var menuVolume = Menu("Volumen", () => DispatcherQueue.TryEnqueue(() => volumeIcon.Flyout.ShowAt(more)));
        var menuExpand = Menu("Pantalla completa", () => openPlayer("fullscreen"));
        more.Flyout = menu;
        expand.ContextFlyout = menu;
        foreach (var control in new[] { lyrics, queue, volumeIcon, expand, more }) tools.Children.Add(control);
        Grid.SetColumn(tools, 2); layout.Children.Add(tools);

        bool hasPlayback = false;
        void LayoutPlayer()
        {
            double available = main.ActualWidth;
            if (available <= 0) return;
            double width = Math.Min(PlayerMaxWidth, Math.Max(0, available - PlayerMargin * 2));
            bool narrow = available < 900, compactTools = width < 480;
            bool showExpand = width >= 405, showVolume = width >= 350, showAdjacent = width >= 300;
            bar.Height = hasPlayback ? PlayerHeight : EmptyPlayerHeight;
            bar.CornerRadius = new(bar.Height / 2);
            bar.Width = hasPlayback ? width : Math.Min(EmptyPlayerWidth, width);
            bar.Visibility = width >= (hasPlayback ? 172 : EmptyPlayerWidth) ? Visibility.Visible : Visibility.Collapsed;
            bar.Padding = hasPlayback ? new(12, 0, 14, 0) : new(10, 0, 10, 0);
            layout.ColumnSpacing = hasPlayback ? width < 350 ? 8 : 20 : 4;
            Grid.SetColumn(display, hasPlayback ? 1 : 0);
            Grid.SetColumn(transport, hasPlayback ? 0 : 1);
            nowHost.VerticalAlignment = hasPlayback ? VerticalAlignment.Top : VerticalAlignment.Center;
            nowHost.Margin = new(0, hasPlayback ? 9 : 0, 0, 0);
            artwork.CornerRadius = new(hasPlayback ? 8 : 6);
            picture.Width = picture.Height = cover.Width = cover.Height = hasPlayback ? 44 : 40;
            play.Width = play.Height = play.MinWidth = play.MinHeight = hasPlayback ? 40 : 36;
            play.CornerRadius = new(play.Width / 2);
            play.Background = hasPlayback ? transparent : emptyPlayBackground;
            if (hasPlayback) playStates.Set(transparent.Color, "ButtonBackgroundDisabled");

            shuffle.Visibility = repeat.Visibility = hasPlayback && !narrow ? Visibility.Visible : Visibility.Collapsed;
            previous.Visibility = next.Visibility = hasPlayback && showAdjacent ? Visibility.Visible : Visibility.Collapsed;
            seek.Visibility = open.Visibility = tools.Visibility =
                hasPlayback ? Visibility.Visible : Visibility.Collapsed;
            lyrics.Visibility = queue.Visibility = compactTools ? Visibility.Collapsed : Visibility.Visible;
            more.Visibility = compactTools ? Visibility.Visible : Visibility.Collapsed;
            expand.Visibility = showExpand ? Visibility.Visible : Visibility.Collapsed;
            volumeIcon.Visibility = showVolume ? Visibility.Visible : Visibility.Collapsed;
            menuLyrics.Visibility = menuQueue.Visibility = compactTools ? Visibility.Visible : Visibility.Collapsed;
            menuShuffle.Visibility = menuRepeat.Visibility = narrow ? Visibility.Visible : Visibility.Collapsed;
            menuPrevious.Visibility = menuNext.Visibility = showAdjacent ? Visibility.Collapsed : Visibility.Visible;
            menuExpand.Visibility = showExpand ? Visibility.Collapsed : Visibility.Visible;
            menuVolume.Visibility = showVolume ? Visibility.Collapsed : Visibility.Visible;
            copy.Visibility = hasPlayback && width >= 310 ? Visibility.Visible : Visibility.Collapsed;
            now.ColumnSpacing = copy.Visibility == Visibility.Visible ? 12 : 0;
        }
        void UpdatePlayback()
        {
            bool enabled = model.Current != null;
            hasPlayback |= enabled;
            foreach (var control in new[] { open, shuffle, previous, play, next, repeat, lyrics }) control.IsEnabled = enabled;
            menuLyrics.IsEnabled = enabled;
            UpdateArtist();
            seek.IsEnabled = enabled;
            menuPrevious.IsEnabled = menuNext.IsEnabled = enabled;
            play.Foreground = hasPlayback ? frameWhite : emptyPlayInk;
            Ui.SetIcon(play, model.Playing ? "pause" : "play", hasPlayback ? 26 : 20);
            AutomationProperties.SetName(play, model.PlayLabel); ToolTipService.SetToolTip(play, model.PlayLabel);
            Ui.SetActive(shuffle, model.ShuffleEnabled); Ui.SetActive(repeat, model.RepeatMode != "off"); Ui.SetIcon(repeat, model.RepeatMode == "one" ? "repeatOne" : "repeat", 17);
            foreach (var toggle in new[] { shuffle, repeat }) { toggle.Foreground = frameWhite; Ui.Tint((FrameworkElement)toggle.Content, frameWhite); }
            string repeatLabel = "Repetición: " + (model.RepeatMode == "off" ? "desactivada" : model.RepeatMode == "all" ? "toda la cola" : "una canción");
            AutomationProperties.SetName(repeat, repeatLabel); ToolTipService.SetToolTip(repeat, repeatLabel); UpdatePanels(); LayoutPlayer();
        }
        PropertyChangedEventHandler changed = (_, args) => {
            if (args.PropertyName is nameof(model.Playing) or nameof(model.PlayLabel) or nameof(model.Current) or nameof(model.ShuffleEnabled) or nameof(model.RepeatMode)) UpdatePlayback();
            else if (args.PropertyName is nameof(model.Artist) or nameof(model.Library)) UpdateArtist();
        };
        model.PropertyChanged += changed; Ui.OnRelease(bar, () => model.PropertyChanged -= changed); UpdatePlayback();
        PanelsChanged += UpdatePanels; Ui.OnRelease(bar, () => PanelsChanged -= UpdatePanels);
        SizeChangedEventHandler responsive = (_, _) => LayoutPlayer();
        main.SizeChanged += responsive; Ui.OnRelease(bar, () => main.SizeChanged -= responsive);
        return bar;
    }

    private static void StylePlayerTimeline(Grid display, Grid nowPlaying, Slider seek)
    {
        seek.Name = "PillSeek";
        seek.MinHeight = 0;
        seek.Height = 22;
        seek.VerticalAlignment = VerticalAlignment.Bottom;
        seek.IsThumbToolTipEnabled = false;
        seek.FocusVisualMargin = new(0);
        seek.FocusVisualPrimaryBrush = Ui.Brush("#FFFFFFB3");
        seek.FocusVisualPrimaryThickness = new(1);
        seek.FocusVisualSecondaryThickness = new(0);
        // Keep the Slider's tracker and range semantics. A zero-width thumb lets the native
        // decrease rectangle run all the way to either end of the display.
        seek.Template = (ControlTemplate)XamlReader.Load("""
        <ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Slider">
            <Grid x:Name="SliderContainer" Background="Transparent">
                <Grid x:Name="HorizontalTemplate">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="Auto"/>
                        <ColumnDefinition Width="Auto"/>
                        <ColumnDefinition Width="*"/>
                    </Grid.ColumnDefinitions>
                    <Rectangle x:Name="HorizontalTrackRect" Grid.ColumnSpan="3" Height="6" RadiusX="3" RadiusY="3" Margin="0,0,0,5" VerticalAlignment="Bottom" Fill="#24FFFFFF" IsHitTestVisible="False"/>
                    <Rectangle x:Name="HorizontalDecreaseRect" Height="6" RadiusX="3" RadiusY="3" Margin="0,0,0,5" VerticalAlignment="Bottom" IsHitTestVisible="False"/>
                    <Thumb x:Name="HorizontalThumb" Grid.Column="1" Width="0" MinWidth="0" Opacity="0" IsHitTestVisible="False"/>
                </Grid>
                <Border Height="14" Margin="0,0,0,1" VerticalAlignment="Bottom" CornerRadius="6" IsHitTestVisible="False" Control.IsTemplateFocusTarget="True"/>
            </Grid>
        </ControlTemplate>
        """);

        var timeInk = Ui.Brush("#FFFFFFE6");
        TextBlock Time(string name, TextAlignment alignment)
        {
            var text = PlayerControls.Time(alignment);
            text.Name = name;
            text.FontSize = 12;
            text.Foreground = timeInk;
            text.MinWidth = 0;
            text.TextTrimming = TextTrimming.CharacterEllipsis;
            return text;
        }
        var elapsed = Time("PillElapsed", TextAlignment.Left);
        var remaining = Time("PillRemaining", TextAlignment.Right);
        var times = new Grid { IsHitTestVisible = false, Opacity = 0, Margin = new(0, 28, 0, 0), VerticalAlignment = VerticalAlignment.Top };
        times.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        times.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        AutomationProperties.SetAccessibilityView(times, AccessibilityView.Raw);
        Grid.SetColumn(remaining, 1);
        times.Children.Add(elapsed);
        times.Children.Add(remaining);
        display.Children.Add(times);
        display.Children.Add(seek);

        static string Clock(double seconds)
        {
            var time = TimeSpan.FromSeconds(Math.Max(0, Math.Floor(seconds)));
            return $"{(int)time.TotalMinutes}:{time.Seconds:00}";
        }
        void UpdateTimes()
        {
            elapsed.Text = Clock(seek.Value);
            remaining.Text = "−" + Clock(seek.Maximum - seek.Value);
        }
        seek.ValueChanged += (_, _) => UpdateTimes();
        long maximum = seek.RegisterPropertyChangedCallback(Slider.MaximumProperty, (_, _) => UpdateTimes());
        Ui.OnRelease(seek, () => seek.UnregisterPropertyChangedCallback(Slider.MaximumProperty, maximum));
        UpdateTimes();

        var fill = Ui.Brush("#F4F4F5");
        var thickness = new ScaleTransform { ScaleY = .5 };
        seek.Loaded += (_, _) => {
            if (Ui.Find<Grid>(seek)?.Children.FirstOrDefault() is not Grid horizontal) return;
            foreach (var line in horizontal.Children.OfType<Rectangle>())
            {
                line.RenderTransformOrigin = new(.5, .5);
                line.RenderTransform = thickness;
                if (line.Name == "HorizontalDecreaseRect") line.Fill = fill;
            }
        };

        var blur = PlayerDetailsBlur.Attach(display, nowPlaying);

        bool pointerOver = false, dragging = false, animating = false;
        double progress = 0, start = 0, target = 0;
        long started = 0;
        void Draw(double amount)
        {
            progress = amount;
            // Like the web pill: the song details blur back (8 px) and fade to 22 %.
            if (blur is null) nowPlaying.Opacity = 1 - .78 * amount;
            else blur.Draw(amount);
            times.Opacity = amount;
            thickness.ScaleY = .5 + .5 * amount;
            byte channel = (byte)Math.Round(244 + 11 * amount);
            fill.Color = global::Windows.UI.Color.FromArgb(255, channel, channel, (byte)Math.Round(245 + 10 * amount));
        }
        void Stop()
        {
            if (!animating) return;
            CompositionTarget.Rendering -= Animate;
            animating = false;
        }
        void Animate(object? sender, object args)
        {
            double t = Math.Clamp((Environment.TickCount64 - started) / 160.0, 0, 1);
            if (t >= 1 || !WindowsIntegration.AnimationsEnabled) { Stop(); Draw(target); return; }
            double rest = 1 - t;
            Draw(start + (target - start) * (1 - rest * rest * rest));
        }
        void UpdateScrub()
        {
            double next = seek.IsEnabled && (pointerOver || dragging || seek.FocusState == FocusState.Keyboard) ? 1 : 0;
            if (target == next) return;
            target = next;
            if (!WindowsIntegration.AnimationsEnabled) { Stop(); Draw(target); return; }
            start = progress;
            started = Environment.TickCount64;
            if (!animating) { CompositionTarget.Rendering += Animate; animating = true; }
        }
        seek.PointerEntered += (_, _) => { pointerOver = true; UpdateScrub(); };
        seek.PointerExited += (_, _) => { pointerOver = false; UpdateScrub(); };
        seek.GotFocus += (_, _) => UpdateScrub();
        seek.LostFocus += (_, _) => UpdateScrub();
        seek.IsEnabledChanged += (_, _) => UpdateScrub();
        PointerEventHandler pressed = (_, args) => { dragging = args.GetCurrentPoint(seek).Properties.IsLeftButtonPressed; UpdateScrub(); };
        PointerEventHandler released = (_, args) => {
            dragging = false;
            // Pointer capture can defer the exit notification until after the drag ends.
            var point = args.GetCurrentPoint(seek).Position;
            pointerOver = pointerOver && point.X >= 0 && point.X < seek.ActualWidth && point.Y >= 0 && point.Y < seek.ActualHeight;
            UpdateScrub();
        };
        PointerEventHandler canceled = (_, _) => { pointerOver = dragging = false; UpdateScrub(); };
        seek.AddHandler(UIElement.PointerPressedEvent, pressed, true);
        seek.AddHandler(UIElement.PointerReleasedEvent, released, true);
        seek.AddHandler(UIElement.PointerCaptureLostEvent, released, true);
        seek.AddHandler(UIElement.PointerCanceledEvent, canceled, true);
        seek.Unloaded += (_, _) => { Stop(); pointerOver = dragging = false; target = 0; Draw(0); };
        Ui.OnRelease(seek, Stop);
        if (blur is not null) Ui.OnRelease(seek, blur.Dispose);
    }

    private static void KeepAbovePlayer(FrameworkElement content, ScrollViewer viewport)
    {
        content.BringIntoViewRequested += (_, args) => {
            if (viewport.ViewportHeight <= PlayerInset) return;
            var rect = args.TargetElement.TransformToVisual(viewport).TransformBounds(args.TargetRect);
            double covered = rect.Bottom - (viewport.ViewportHeight - PlayerInset);
            if (covered > 0) args.VerticalOffset -= Math.Min(covered, PlayerInset);
        };
    }
}

internal static class PlayerControls
{
    public static Brush Glass() => new AcrylicBrush {
        TintColor = global::Windows.UI.Color.FromArgb(255, 24, 24, 28), TintOpacity = .86,
        FallbackColor = global::Windows.UI.Color.FromArgb(255, 24, 24, 28)
    };

    public static TextBlock SingleLine(string text, double size, bool bold = false)
    {
        var block = Ui.Text(text, size, bold); block.TextWrapping = TextWrapping.NoWrap; block.TextTrimming = TextTrimming.CharacterEllipsis; block.MaxLines = 1; return block;
    }

    public static void StyleSlider(Slider slider)
    {
        slider.Resources["SliderTrackThemeHeight"] = 3d;
        slider.Resources["SliderThumbThemeWidth"] = 10d;
        slider.Resources["SliderThumbThemeHeight"] = 10d;
        slider.Resources["SliderTrackFill"] = Ui.Brush("#FFFFFF30");
        slider.Resources["SliderTrackValueFill"] = Ui.Brush("#F4F4F5");
        slider.Resources["SliderTrackValueFillPointerOver"] = Ui.Brush("#1ED760");
        slider.Resources["SliderThumbBackground"] = Ui.Brush("#F4F4F5");
    }

    /// <summary>
    /// Every player slider is exactly the WinUI template height (rows 14 / 3 / 14 inside MinHeight 32), so its
    /// track sits on the slider's centre line and lines up with neighbouring icons and times. A taller slider
    /// keeps the track in the top rows and floats it above whatever it is centred against.
    /// </summary>
    public const double TrackHeight = 32;
    public static Slider Track()
    {
        var slider = new Slider { Minimum = 0, MinWidth = 0, Height = TrackHeight, MinHeight = TrackHeight, VerticalAlignment = VerticalAlignment.Center };
        StyleSlider(slider); return slider;
    }
    public static Slider Volume(double width)
    {
        var slider = Track(); slider.Maximum = 1; slider.StepFrequency = .01; slider.Width = width;
        // The engine works in 0–1; people read volume as a whole percentage.
        slider.ThumbToolTipValueConverter = new PercentLabel();
        return slider;
    }
    private sealed partial class PercentLabel : Microsoft.UI.Xaml.Data.IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, string language) => $"{Math.Round(System.Convert.ToDouble(value) * 100):0} %";
        public object ConvertBack(object value, Type targetType, object parameter, string language) => throw new NotSupportedException();
    }
    private sealed partial class TimeLabel : Microsoft.UI.Xaml.Data.IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, string language) { var time = TimeSpan.FromSeconds(Math.Max(0, Math.Floor(System.Convert.ToDouble(value)))); return time.TotalHours >= 1 ? time.ToString(@"h\:mm\:ss") : time.ToString(@"m\:ss"); }
        public object ConvertBack(object value, Type targetType, object parameter, string language) => throw new NotSupportedException();
    }

    /// <summary>Elapsed/total time: tabular digits at a fixed width so the bar never shifts while playing.</summary>
    public static TextBlock Time(TextAlignment alignment)
    {
        var text = Ui.Muted("", 11); text.VerticalAlignment = VerticalAlignment.Center; text.TextAlignment = alignment; text.MinWidth = 36;
        text.TextLineBounds = TextLineBounds.Tight; text.TextWrapping = TextWrapping.NoWrap;
        Microsoft.UI.Xaml.Documents.Typography.SetNumeralAlignment(text, FontNumeralAlignment.Tabular);
        return text;
    }

    public static Slider Seek(MainViewModel model)
    {
        var seek = Track(); seek.StepFrequency = .1; seek.ThumbToolTipValueConverter = new TimeLabel();
        // No OneWay binding on Value: a drag or arrow key writes Value locally, which would discard the binding
        // and freeze the bar for the rest of the session. Follow the model by hand instead, except while the
        // person is choosing a position or that seek is still reopening the track.
        bool holding = false; int pending = 0;
        void Sync() { if (holding || pending > 0) return; seek.Maximum = Math.Max(0, model.Duration); seek.Value = Math.Clamp(model.Position, 0, seek.Maximum); }
        async Task CommitAsync() {
            holding = false; pending++;
            try { await model.SeekAsync(seek.Value); } finally { pending--; Sync(); }
        }
        PropertyChangedEventHandler changed = (_, args) => { if (args.PropertyName is nameof(model.Position) or nameof(model.Duration)) Sync(); };
        PointerEventHandler pressed = (_, _) => holding = true;
        PointerEventHandler released = (_, _) => { if (holding) _ = model.RunAsync(CommitAsync); };
        PointerEventHandler lost = (_, _) => { if (holding) _ = model.RunAsync(CommitAsync); };
        model.PropertyChanged += changed;
        seek.AddHandler(UIElement.PointerPressedEvent, pressed, true); seek.AddHandler(UIElement.PointerReleasedEvent, released, true);
        seek.AddHandler(UIElement.PointerCaptureLostEvent, lost, true); seek.AddHandler(UIElement.PointerCanceledEvent, lost, true);
        Ui.OnRelease(seek, () => {
            model.PropertyChanged -= changed;
            seek.RemoveHandler(UIElement.PointerPressedEvent, pressed); seek.RemoveHandler(UIElement.PointerReleasedEvent, released);
            seek.RemoveHandler(UIElement.PointerCaptureLostEvent, lost); seek.RemoveHandler(UIElement.PointerCanceledEvent, lost);
        });
        Ui.KeyboardSeek(seek, () => holding = true, () => _ = model.RunAsync(CommitAsync));
        Sync(); return seek;
    }
}
