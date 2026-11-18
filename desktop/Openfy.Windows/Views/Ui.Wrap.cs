using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace Openfy.Windows.Views;

public static partial class Ui
{
    public static Panel Wrap(params UIElement[] children)
    {
        var panel = new WrapRow();
        foreach (var child in children) panel.Children.Add(child);
        return panel;
    }
    private sealed partial class WrapRow : Panel
    {
        private const double Gap = 8;
        protected override Size MeasureOverride(Size availableSize)
        {
            double x = 0, y = 0, height = 0, width = 0;
            foreach (var child in Children) {
                child.Measure(new Size(availableSize.Width, double.PositiveInfinity));
                var size = child.DesiredSize;
                if (x > 0 && x + size.Width > availableSize.Width) { y += height + Gap; x = 0; height = 0; }
                width = Math.Max(width, x + size.Width); x += size.Width + Gap; height = Math.Max(height, size.Height);
            }
            return new Size(width, y + height);
        }
        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0, y = 0, height = 0;
            var line = new List<(UIElement Child, double X, Size Size)>();
            void ArrangeLine() { foreach (var item in line) item.Child.Arrange(new Rect(item.X, y + (height - item.Size.Height) / 2, item.Size.Width, item.Size.Height)); line.Clear(); }
            foreach (var child in Children) {
                var size = child.DesiredSize;
                if (x > 0 && x + size.Width > finalSize.Width) { ArrangeLine(); y += height + Gap; x = 0; height = 0; }
                line.Add((child, x, size)); x += size.Width + Gap; height = Math.Max(height, size.Height);
            }
            ArrangeLine(); return finalSize;
        }
    }
}
