using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Openfy.Windows.Views;

/// <summary>Applies presentation without replacing windows or the audio model.</summary>
public static class Appearance
{
    public static void Attach(FrameworkElement root)
    {
        RoutedEventHandler loaded = (_, _) => Apply(root);
        root.Loaded += loaded;
        Ui.OnRelease(root, () => root.Loaded -= loaded);
        Apply(root);
    }

    public static void Apply(DependencyObject node)
    {
        // Each step is idempotent when dynamic content is styled repeatedly.
        if (node is TextBlock text && !Equals(text.Tag, "display"))
            text.FontSize = text.FontSize switch { >= 48 => 48, >= 30 => 32, >= 18 => 22, >= 13 => 14, >= 11 => 12, _ => text.FontSize };
        if (node is Border border && border.CornerRadius.TopLeft >= 10 && !Equals(border.Tag, "home-artwork") && !Equals(border.Tag, "ambient-preview") && !Equals(border.Tag, "loading-placeholder")) {
            border.CornerRadius = new(16);
            border.Background = border.Background is AcrylicBrush ? Ui.Glass("#202024", .8) : Ui.Brush("#151518");
        }
        if (node is Button button && button.CornerRadius.TopLeft > 0 && (button.Width != button.Height || double.IsNaN(button.Width)))
            button.CornerRadius = new(12);
        if (node is Grid grid && grid.Padding.Left == 9 && grid.Padding.Top == 9)
            grid.Padding = new(12);
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++) Apply(VisualTreeHelper.GetChild(node, i));
    }
}
