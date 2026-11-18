using System.ComponentModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private FrameworkElement PlayerBar()
    {
        var bar = new Border {
            Height = 112, CornerRadius = new CornerRadius(12),
            Background = PlayerControls.Glass(), BorderBrush = Ui.Brush("#FFFFFF0B"), BorderThickness = new Thickness(1),
            Padding = new Thickness(21, 0, 17, 0), HorizontalAlignment = HorizontalAlignment.Stretch
        };
        var layout = new Grid { ColumnSpacing = 20 };
        layout.ColumnDefinitions.Add(new() { Width = new GridLength(26, GridUnitType.Star) });
        layout.ColumnDefinitions.Add(new() { Width = new GridLength(43, GridUnitType.Star) });
        layout.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        bar.Child = layout;

        var now = new Grid { ColumnSpacing = 13, VerticalAlignment = VerticalAlignment.Center };
        now.ColumnDefinitions.Add(new() { Width = new GridLength(53) });
        now.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        var picture = new Grid { Width = 53, Height = 53, Background = Ui.Gradient("#28483E", "#151B23") };
        var fallback = Ui.Icon("music", 27); fallback.Opacity = .65; picture.Children.Add(fallback); picture.Children.Add(cover);
        now.Children.Add(new Border { CornerRadius = new CornerRadius(6), Child = picture, IsHitTestVisible = false });
        var copy = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        var title = PlayerControls.SingleLine("", 13, true); title.IsHitTestVisible = false; Ui.Bind(title, TextBlock.TextProperty, model, nameof(model.Title)); copy.Children.Add(title);
        var artist = NewArtistLink(11, "#A1A1AA"); copy.Children.Add(artist);
        void UpdateArtist() => artist.Set(model.Artist, ArtistTarget(model.Current));
        Grid.SetColumn(copy, 1); now.Children.Add(copy);
        // The open button lies underneath the cover and title (which ignore hits) so the artist link can sit on top of it.
        var open = Ui.Button("", () => openPlayer("fullscreen"), "Abrir reproductor ampliado");
        open.Padding = new Thickness(0); open.Background = Ui.Brush("#00000000"); open.BorderThickness = new Thickness(0);
        open.HorizontalAlignment = HorizontalAlignment.Stretch; open.VerticalAlignment = VerticalAlignment.Stretch;
        var nowHost = new Grid { VerticalAlignment = VerticalAlignment.Center };
        nowHost.Children.Add(open); nowHost.Children.Add(now); layout.Children.Add(nowHost);

        var center = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 600 };
        var transport = Ui.Row(); transport.Spacing = 11; transport.HorizontalAlignment = HorizontalAlignment.Center;
        var shuffle = Ui.IconButton("shuffle", "Reproducción aleatoria", model.Shuffle, 44);
        var previous = Ui.IconButton("previous", "Canción anterior", () => _ = model.RunAsync(() => model.AdvanceAsync(-1)), 44);
        var play = Ui.PlayButton(() => _ = model.RunAsync(model.ToggleAsync), 44);
        var next = Ui.IconButton("next", "Canción siguiente", () => _ = model.RunAsync(() => model.AdvanceAsync(1)), 44);
        var repeat = Ui.IconButton("repeat", "Repetición desactivada", model.CycleRepeat, 44);
        foreach (var control in new[] { shuffle, previous, play, next, repeat }) transport.Children.Add(control);
        center.Children.Add(transport);
        // The slider is exactly its template height (track centred at 15.5 of 32) and the times use
        // tight digit bounds, so both share the row's centre line instead of the 44 px box's top rows.
        var seekRow = new Grid { ColumnSpacing = 10, MinHeight = 40 };
        seekRow.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); seekRow.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); seekRow.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var position = PlayerControls.Time(TextAlignment.Right); Ui.Bind(position, TextBlock.TextProperty, model, nameof(model.PositionText)); seekRow.Children.Add(position);
        var seek = PlayerControls.Seek(model); Grid.SetColumn(seek, 1); seekRow.Children.Add(seek);
        var duration = PlayerControls.Time(TextAlignment.Left); Ui.Bind(duration, TextBlock.TextProperty, model, nameof(model.DurationText)); Grid.SetColumn(duration, 2); seekRow.Children.Add(duration);
        center.Children.Add(seekRow); Grid.SetColumn(center, 1); layout.Children.Add(center);

        var tools = Ui.Row(); tools.Spacing = 2; tools.VerticalAlignment = VerticalAlignment.Center; tools.HorizontalAlignment = HorizontalAlignment.Right;
        Button? lyrics = null, queue = null;
        void UpdatePanels() { if (lyrics != null) Ui.SetActive(lyrics, lyricsVisible); if (queue != null) Ui.SetActive(queue, queueVisible); }
        lyrics = Ui.IconButton("lyrics", "Letras", () => _ = model.RunAsync(async () => {
            lyricsVisible = !lyricsVisible; queueVisible = false; model.LyricsVisible = lyricsVisible; BuildSide(); UpdatePanels(); if (lyricsVisible) await model.LoadLyricsAsync();
        }), 44);
        queue = Ui.IconButton("queue", "Cola de reproducción", () => { queueVisible = !queueVisible; lyricsVisible = false; model.LyricsVisible = false; BuildSide(); UpdatePanels(); }, 44);
        var mini = Ui.IconButton("mini", "Minirreproductor", () => openPlayer("mini"), 44);
        var widget = Ui.IconButton("widget", "Widget de escritorio", () => openPlayer("widget"), 44);
        var expand = Ui.IconButton("expand", "Pantalla completa", () => openPlayer("fullscreen"), 44);
        var more = Ui.IconButton("more", "Más opciones de reproducción", () => { }, 44);
        var menu = new MenuFlyout();
        void Menu(string label, Action action) { var item = new MenuFlyoutItem { Text = label }; RoutedEventHandler handler = (_, _) => action(); item.Click += handler; Ui.OnRelease(more, () => item.Click -= handler); menu.Items.Add(item); }
        Menu("Minirreproductor", () => openPlayer("mini")); Menu("Widget de escritorio", () => openPlayer("widget")); Menu("Pantalla completa", () => openPlayer("fullscreen"));
        Menu("Reproducción aleatoria", model.Shuffle); Menu("Cambiar repetición", model.CycleRepeat); more.Flyout = menu;
        var volumeIcon = Ui.IconButton("volume", "Volumen", () => { }, 44);
        var volumePopup = PlayerControls.Volume(150); Ui.Bind(volumePopup, Slider.ValueProperty, model, nameof(model.Volume), BindingMode.TwoWay); AutomationProperties.SetName(volumePopup, "Volumen");
        volumeIcon.Flyout = new Flyout { Content = volumePopup }; Ui.OnRelease(volumeIcon, () => Ui.ReleaseTree(volumePopup));
        var volume = PlayerControls.Volume(68); Ui.Bind(volume, Slider.ValueProperty, model, nameof(model.Volume), BindingMode.TwoWay); AutomationProperties.SetName(volume, "Volumen");
        foreach (var control in new UIElement[] { lyrics, queue, mini, widget, expand, more, volumeIcon, volume }) tools.Children.Add(control);
        Grid.SetColumn(tools, 2); layout.Children.Add(tools);

        void UpdatePlayback()
        {
            bool enabled = model.Current != null;
            foreach (var control in new[] { open, shuffle, previous, play, next, repeat, lyrics }) control.IsEnabled = enabled;
            title.Opacity = enabled ? 1 : .55; UpdateArtist();
            seek.IsEnabled = enabled;
            Ui.SetIcon(play, model.Playing ? "pause" : "play", 20); AutomationProperties.SetName(play, model.PlayLabel); ToolTipService.SetToolTip(play, model.PlayLabel);
            Ui.SetActive(shuffle, model.ShuffleEnabled); Ui.SetActive(repeat, model.RepeatMode != "off"); Ui.SetIcon(repeat, model.RepeatMode == "one" ? "repeatOne" : "repeat", 18);
            string repeatLabel = "Repetición: " + (model.RepeatMode == "off" ? "desactivada" : model.RepeatMode == "all" ? "toda la cola" : "una canción");
            AutomationProperties.SetName(repeat, repeatLabel); ToolTipService.SetToolTip(repeat, repeatLabel); UpdatePanels();
        }
        PropertyChangedEventHandler changed = (_, args) => {
            if (args.PropertyName is nameof(model.Playing) or nameof(model.PlayLabel) or nameof(model.Current) or nameof(model.ShuffleEnabled) or nameof(model.RepeatMode)) UpdatePlayback();
            else if (args.PropertyName is nameof(model.Artist) or nameof(model.Library)) UpdateArtist();
        };
        model.PropertyChanged += changed; Ui.OnRelease(bar, () => model.PropertyChanged -= changed); UpdatePlayback();
        PanelsChanged += UpdatePanels; Ui.OnRelease(bar, () => PanelsChanged -= UpdatePanels);
        SizeChangedEventHandler responsive = (_, _) => {
            double width = bar.ActualWidth; bool compact = width < 1180, narrow = width < 950;
            mini.Visibility = widget.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
            more.Visibility = compact ? Visibility.Visible : Visibility.Collapsed;
            volume.Visibility = narrow ? Visibility.Collapsed : Visibility.Visible;
            shuffle.Visibility = repeat.Visibility = width < 800 ? Visibility.Collapsed : Visibility.Visible;
            layout.ColumnSpacing = narrow ? 10 : 20; transport.Spacing = narrow ? 5 : 11;
            bar.Padding = new Thickness(narrow ? 12 : 21, 0, narrow ? 10 : 17, 0);
        };
        bar.SizeChanged += responsive; Ui.OnRelease(bar, () => bar.SizeChanged -= responsive);
        return bar;
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
