using System.Runtime.CompilerServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Openfy.Windows.Views;

/// <summary>Applies presentation without replacing windows or the audio model.</summary>
public static class Appearance
{
    private sealed record ElementStyle(Action Apply, bool PreserveTemplate);
    private static readonly ConditionalWeakTable<FrameworkElement, ElementStyle> styles = new();

    internal static void SetStyle(FrameworkElement element, Action apply, bool preserveTemplate = false)
    {
        styles.Add(element, new(apply, preserveTemplate));
        apply();
    }

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
        if (node is FrameworkElement element && styles.TryGetValue(element, out var style))
        {
            style.Apply();
            if (style.PreserveTemplate) return;
        }
        else
            ApplyDefaults(node);
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++) Apply(VisualTreeHelper.GetChild(node, i));
    }

    private static void ApplyDefaults(DependencyObject node)
    {
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
    }
}
