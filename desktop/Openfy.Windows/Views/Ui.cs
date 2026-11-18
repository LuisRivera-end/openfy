using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Shapes;
using Openfy.Windows.ViewModels;
using Openfy.Core;

namespace Openfy.Windows.Views;

public static partial class Ui
{
    public static SolidColorBrush Brush(byte r, byte g, byte b) => new(global::Windows.UI.Color.FromArgb(255, r, g, b));
    public static SolidColorBrush Brush(string hex)
    {
        hex = hex.TrimStart('#');
        byte alpha = hex.Length == 8 ? Convert.ToByte(hex[6..8], 16) : (byte)255;
        return new(global::Windows.UI.Color.FromArgb(alpha, Convert.ToByte(hex[..2], 16), Convert.ToByte(hex[2..4], 16), Convert.ToByte(hex[4..6], 16)));
    }
    public static LinearGradientBrush Gradient(string start, string end) => new()
    {
        StartPoint = new(0, 0), EndPoint = new(1, 1),
        GradientStops = { new() { Color = Brush(start).Color, Offset = 0 }, new() { Color = Brush(end).Color, Offset = 1 } }
    };
    public static AcrylicBrush Glass(string tint = "#18181B", double opacity = .84) => new()
    {
        TintColor = Brush(tint).Color, TintOpacity = opacity, TintLuminosityOpacity = .9,
        FallbackColor = Brush(tint).Color
    };
    public static TextBlock Text(string text, double size = 14, bool bold = false) => new() { Text = text, FontSize = size, FontWeight = bold ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal, TextWrapping = TextWrapping.Wrap, Foreground = Brush(244, 244, 245) };
    public static TextBlock Muted(string text, double size = 13) { var result = Text(text, size); result.Foreground = Brush("#A1A1AA"); return result; }
    public static Button Button(string label, Action action, string? name = null)
    {
        var button = new Button { Content = label, CornerRadius = new CornerRadius(24), MinHeight = 44, FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Background = Brush("#FFFFFF0B"), BorderBrush = Brush("#FFFFFF10"), BorderThickness = new Thickness(1), VerticalAlignment = VerticalAlignment.Center, Padding = new Thickness(20, 8, 20, 8) };
        RoutedEventHandler handler = (_, _) => action();
        AutomationProperties.SetName(button, name ?? label); button.Click += handler;
        OnRelease(button, () => button.Click -= handler); return button;
    }
    public static Button PrimaryButton(string label, Action action)
    {
        var button = Button(label, action); button.Background = Brush("#1ED760"); button.Foreground = Brush("#07160B"); button.BorderThickness = new(0);
        button.Resources["ButtonBackgroundPointerOver"] = Brush("#4AE37F"); button.Resources["ButtonForegroundPointerOver"] = Brush("#07160B");
        button.Resources["ButtonBackgroundPressed"] = Brush("#19BD54"); button.Resources["ButtonForegroundPressed"] = Brush("#07160B");
        return button;
    }
    public static FrameworkElement Icon(string name, double size = 20)
    {
        var canvas = new Canvas { Width = 24, Height = 24 };
        foreach (string data in IconPaths.GetValueOrDefault(name, IconPaths["music"]))
        {
            var path = (Microsoft.UI.Xaml.Shapes.Path)XamlReader.Load("<Path xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" Data=\"" + data + "\" />");
            path.Stroke = Brush("#A1A1AA"); path.StrokeThickness = 1.8; path.StrokeStartLineCap = PenLineCap.Round; path.StrokeEndLineCap = PenLineCap.Round; path.StrokeLineJoin = PenLineJoin.Round;
            // Solid transport glyphs keep the stroke too, so their corners stay as round as the outline icons.
            if (SolidIcons.Contains(name)) { path.Fill = path.Stroke; path.Tag = Solid; }
            canvas.Children.Add(path);
        }
        return new Viewbox { Child = canvas, Width = size, Height = size, IsHitTestVisible = false };
    }
    public static Button IconButton(string icon, string label, Action action, double size = 36)
    {
        var button = Button(label, action, label); button.Width = size; button.Height = size; button.MinHeight = size; button.MinWidth = size; button.Padding = new(0); button.CornerRadius = new(size / 2); button.Background = Brush("#FFFFFF00"); button.Foreground = Brush("#A1A1AA"); button.BorderThickness = new(0); SetIcon(button, icon);
        ToolTipService.SetToolTip(button, label); return button;
    }
    public static Button PlayButton(Action action, double size = 44, bool green = false)
    {
        var button = IconButton("play", "Reproducir", action, size); button.Background = Brush(green ? "#1ED760" : "#F4F4F5"); button.Foreground = Brush("#07160B");
        button.Resources["ButtonBackgroundPointerOver"] = Brush(green ? "#4AE37F" : "#FFFFFF"); button.Resources["ButtonForegroundPointerOver"] = Brush("#07160B"); SetIcon(button, "play", size > 50 ? 28 : 22); return button;
    }
    private const string Solid = "solid";
    private static readonly HashSet<string> ToggleIcons = ["shuffle", "repeat", "repeatOne"];
    public static void SetIcon(Button button, string name, double size = 20)
    {
        bool indicated = button.Tag is string previous && ToggleIcons.Contains(previous) && button.Content is Grid { Tag: true };
        button.Tag = name; FrameworkElement icon = Icon(name, size);
        button.Content = ToggleIcons.Contains(name) ? Indicated(icon, indicated) : icon;
        ColorIcon(button.Content as DependencyObject, button.Foreground);
    }
    // Shuffle and repeat also mark their state with a dot under the glyph, as on the web, so it does not rely on colour alone.
    private static Grid Indicated(FrameworkElement icon, bool active)
    {
        var dot = new Ellipse { Width = 4, Height = 4, StrokeThickness = 0, Tag = Solid, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, RenderTransform = new TranslateTransform { Y = 7 }, Visibility = active ? Visibility.Visible : Visibility.Collapsed };
        return new Grid { Tag = active, IsHitTestVisible = false, Children = { icon, dot } };
    }
    public static void Tint(FrameworkElement icon, Microsoft.UI.Xaml.Media.Brush brush) => ColorIcon(icon, brush);
    private static void ColorIcon(DependencyObject? element, Microsoft.UI.Xaml.Media.Brush brush)
    {
        if (element == null) return;
        if (element is Shape shape) { shape.Stroke = brush; if (shape.Tag is Solid) shape.Fill = brush; }
        if (element is Viewbox box) ColorIcon(box.Child, brush);
        else if (element is Panel panel) foreach (var child in panel.Children) ColorIcon(child, brush);
    }
    public static void SetActive(Button button, bool active)
    {
        button.Foreground = Brush(active ? "#1ED760" : "#A1A1AA"); ColorIcon(button.Content as DependencyObject, button.Foreground);
        if (button.Tag is string icon && ToggleIcons.Contains(icon) && button.Content is Grid { Children.Count: 2 } indicated && indicated.Children[1] is Ellipse dot) { indicated.Tag = active; dot.Visibility = active ? Visibility.Visible : Visibility.Collapsed; }
        if (button.Tag is "heart" && button.Content is Viewbox box && box.Child is Panel shapes) foreach (var shape in shapes.Children.OfType<Shape>()) shape.Fill = active ? button.Foreground : null;
    }
    public static Button AsyncButton(string label, MainViewModel model, Func<Task> action, string? name = null) => Button(label, () => _ = model.RunAsync(action), name);
    public static void KeyboardSeek(Slider slider, Action hold, Action commit)
    {
        AutomationProperties.SetName(slider, "Posición de reproducción");
        static bool Seeking(global::Windows.System.VirtualKey key) => key is global::Windows.System.VirtualKey.Left or global::Windows.System.VirtualKey.Right or global::Windows.System.VirtualKey.Home or global::Windows.System.VirtualKey.End;
        // The slider handles these keys itself, so listen to handled events too.
        Microsoft.UI.Xaml.Input.KeyEventHandler down = (_, args) => { if (Seeking(args.Key)) hold(); };
        Microsoft.UI.Xaml.Input.KeyEventHandler up = (_, args) => { if (Seeking(args.Key)) commit(); };
        slider.AddHandler(UIElement.KeyDownEvent, down, true); slider.AddHandler(UIElement.KeyUpEvent, up, true);
        OnRelease(slider, () => { slider.RemoveHandler(UIElement.KeyDownEvent, down); slider.RemoveHandler(UIElement.KeyUpEvent, up); });
    }
    public static void Bind(FrameworkElement element, DependencyProperty property, object source, string path, BindingMode mode = BindingMode.OneWay)
    { element.SetBinding(property, new Binding { Source = source, Path = new PropertyPath(path), Mode = mode }); OnRelease(element, () => element.ClearValue(property)); }
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<FrameworkElement, List<Action>> releases = new();
    public static void OnRelease(FrameworkElement element, Action release) => releases.GetOrCreateValue(element).Add(release);
    public static void ReleaseTree(DependencyObject element)
    {
        for (int i = VisualTreeHelper.GetChildrenCount(element) - 1; i >= 0; i--) ReleaseTree(VisualTreeHelper.GetChild(element, i));
        if (element is FrameworkElement control && releases.TryGetValue(control, out var callbacks)) { releases.Remove(control); foreach (var release in callbacks) release(); }
    }
    public static Image Image(double size) => new() { Width = size, Height = size, Stretch = Stretch.UniformToFill };
    // Keep the fallback visible until decoding, not just the network request, finishes.
    public static Action BeginArtworkLoad(Image image, FrameworkElement placeholder)
    {
        image.Source = null;
        placeholder.Visibility = Visibility.Visible;
        FrameworkElement surface = (image.Parent as FrameworkElement)?.Parent as Border ?? placeholder;
        var visual = Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(surface);
        void Stop() { visual.StopAnimation("Opacity"); visual.Opacity = 1; }
        void Start() { visual.Opacity = 1; }
        void Finish(bool success) { Stop(); placeholder.Visibility = success ? Visibility.Collapsed : Visibility.Visible; }
        RoutedEventHandler opened = (_, _) => { SessionLog.Write("artwork.render", "completed", image.Source is BitmapImage bitmap ? bitmap.UriSource?.LocalPath : null); Finish(true); };
        ExceptionRoutedEventHandler failed = (_, args) => { SessionLog.Write("artwork.render", "failed", image.Source is BitmapImage bitmap ? bitmap.UriSource?.LocalPath : null, error: new IOException(args.ErrorMessage)); Finish(false); };
        RoutedEventHandler loaded = (_, _) => Start(), unloaded = (_, _) => Stop();
        image.ImageOpened += opened; image.ImageFailed += failed;
        surface.Loaded += loaded; surface.Unloaded += unloaded;
        OnRelease(image, () => {
            Stop();
            image.ImageOpened -= opened; image.ImageFailed -= failed;
            surface.Loaded -= loaded; surface.Unloaded -= unloaded;
        });
        if (surface.IsLoaded) Start();
        return () => Finish(false);
    }
    private static readonly Dictionary<string, (BitmapImage Bitmap, long Stamp)> bitmaps = [];
    /// <summary>
    /// Decodes at the width UniformToFill actually needs: a box filled by its height needs
    /// height × aspect pixels of width. Callers that know the box and the prepared source
    /// size pass them; a layout pass that has not happened yet must not decide resolution.
    /// </summary>
    public static void Cover(Image image, string path, double boxWidth = 0, double boxHeight = 0, int sourceWidth = 0, int sourceHeight = 0)
    {
        if (string.IsNullOrEmpty(path)) { image.Source = null; return; }
        try {
            if (boxWidth <= 0) boxWidth = double.IsFinite(image.Width) ? image.Width : image.ActualWidth;
            if (boxHeight <= 0) boxHeight = double.IsFinite(image.Height) ? image.Height : image.ActualHeight;
            double aspect = sourceWidth > 0 && sourceHeight > 0 ? (double)sourceWidth / sourceHeight : 1;
            double visible = Math.Max(128, Math.Max(boxWidth, boxHeight * aspect));
            double pixels = visible * (image.XamlRoot?.RasterizationScale ?? 1.5);
            int decode = (int)Math.Ceiling(pixels / 128) * 128;
            if (sourceWidth > 0) decode = Math.Min(decode, sourceWidth);
            string key = path + ":" + decode;
            if (!bitmaps.TryGetValue(key, out var cached)) {
                cached = (new BitmapImage { DecodePixelWidth = decode, UriSource = new Uri(path) }, Environment.TickCount64);
                bitmaps[key] = cached;
                long bytes = bitmaps.Values.Sum(item => (long)Math.Max(1, item.Bitmap.DecodePixelWidth) * Math.Max(1, item.Bitmap.DecodePixelWidth) * 4);
                foreach (var old in bitmaps.OrderBy(pair => pair.Value.Stamp).ToArray()) {
                    if (bytes <= 64 * 1024 * 1024) break;
                    if (old.Key == key) continue;
                    bytes -= (long)old.Value.Bitmap.DecodePixelWidth * old.Value.Bitmap.DecodePixelWidth * 4; bitmaps.Remove(old.Key);
                }
            }
            bitmaps[key] = (cached.Bitmap, Environment.TickCount64);
            image.Source = cached.Bitmap;
            if (cached.Bitmap.PixelWidth > 0 && image.Parent is Grid grid)
                foreach (var placeholder in grid.Children.OfType<TextBlock>()) placeholder.Visibility = Visibility.Collapsed;
        } catch (Exception error) { SessionLog.Write("artwork.assign", "failed", path, error: error); }
    }
    /// <summary>Horizontal icon/text/control row. Every child shares the row's centre line, so a 20 px icon and 14 px text align optically.</summary>
    public static StackPanel Row(params UIElement[] items)
    {
        var row = new CenteredRow { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach (var item in items) row.Children.Add(item);
        return row;
    }
    /// <summary>Also centres children added after creation (rows are often filled incrementally).</summary>
    private sealed partial class CenteredRow : StackPanel
    {
        protected override global::Windows.Foundation.Size MeasureOverride(global::Windows.Foundation.Size availableSize)
        {
            foreach (var child in Children) if (child is FrameworkElement element && element.VerticalAlignment == VerticalAlignment.Stretch) element.VerticalAlignment = VerticalAlignment.Center;
            return base.MeasureOverride(availableSize);
        }
    }
    public static T? Find<T>(DependencyObject parent) where T : DependencyObject
    {
        if (parent is T current) return current;
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++) { var result = Find<T>(VisualTreeHelper.GetChild(parent, i)); if (result != null) return result; }
        return null;
    }
}
