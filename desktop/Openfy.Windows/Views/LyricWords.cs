using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Services;
using Windows.Foundation;

namespace Openfy.Windows.Views;

/// <summary>Flows word blocks like running text so each sung word can carry its own fill.</summary>
public sealed partial class WordWrapPanel : Panel
{
    protected override Size MeasureOverride(Size available)
    {
        double x = 0, y = 0, line = 0, width = 0;
        foreach (var child in Children)
        {
            child.Measure(new Size(available.Width, double.PositiveInfinity));
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > available.Width) { y += line; x = 0; line = 0; }
            x += size.Width; line = Math.Max(line, size.Height); width = Math.Max(width, x);
        }
        return new Size(double.IsInfinity(available.Width) ? width : Math.Min(width, available.Width), y + line);
    }

    protected override Size ArrangeOverride(Size final)
    {
        double x = 0, y = 0, line = 0;
        foreach (var child in Children)
        {
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > final.Width) { y += line; x = 0; line = 0; }
            child.Arrange(new Rect(x, y, size.Width, size.Height));
            x += size.Width; line = Math.Max(line, size.Height);
        }
        return final;
    }
}

/// <summary>
/// Per-word fill for a line whose source carries word timing (RenderPolicy.ActiveLyricsWord, twin of
/// activeLyricsWord in shared/utils/lyrics.ts): sung words lit, the current word filled left to right.
/// </summary>
public sealed class LyricWords
{
    private readonly TextBlock[] blocks;
    private readonly SolidColorBrush on, off;
    private readonly LinearGradientBrush sweep = new() { StartPoint = new(0, .5), EndPoint = new(1, .5) };
    private readonly GradientStop litEdge, dimEdge;
    private int index = int.MinValue;
    public WordWrapPanel Panel { get; } = new();

    public LyricWords(LyricsWord[] words, double size, double lineHeight, global::Windows.UI.Color lit, global::Windows.UI.Color dim)
    {
        on = new(lit); off = new(dim);
        litEdge = new GradientStop { Color = lit }; dimEdge = new GradientStop { Color = dim };
        sweep.GradientStops.Add(litEdge); sweep.GradientStops.Add(dimEdge);
        double space = size * .28;
        blocks = words.Select(word =>
        {
            var text = Ui.Text(word.Text.TrimEnd(), size, true); text.LineHeight = lineHeight; text.Foreground = off;
            // Syllable fragments join without a gap; a fragment that ends in whitespace keeps one.
            if (word.Text.Length > 0 && char.IsWhiteSpace(word.Text[^1])) text.Margin = new Thickness(0, 0, space, 0);
            Panel.Children.Add(text); return text;
        }).ToArray();
        Panel.IsHitTestVisible = false;
    }

    public void Update(int current, double progress)
    {
        if (current != index)
        {
            index = current;
            for (int i = 0; i < blocks.Length; i++) blocks[i].Foreground = i < current ? on : i == current ? sweep : off;
        }
        double fill = WindowsIntegration.AnimationsEnabled ? progress : 1.2;
        litEdge.Offset = Math.Clamp(fill - .06, 0, 1); dimEdge.Offset = Math.Clamp(fill + .06, 0, 1);
    }
}
