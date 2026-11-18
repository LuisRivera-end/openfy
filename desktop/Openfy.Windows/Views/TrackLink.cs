using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Openfy.Windows.Views;

/// <summary>Artist or album name that behaves as a link: no chrome, hand cursor, brighter and underlined on hover.
/// Long names are trimmed with an ellipsis and shown whole in a tooltip.
/// Without a target it stays plain text and lets clicks reach whatever is underneath.</summary>
public sealed class TrackLink : Button
{
    private readonly TextBlock text;
    private readonly Brush rest;
    private readonly Brush hover = Ui.Brush("#F4F4F5");
    private readonly string action;
    private Func<Task>? target;

    /// <param name="action">Accessible verb phrase for the destination, such as "Abrir artista".</param>
    public TrackLink(double fontSize, string foreground, string action, Action<Func<Task>> open)
    {
        this.action = action;
        rest = Ui.Brush(foreground);
        text = new TextBlock { FontSize = fontSize, Foreground = rest, TextTrimming = TextTrimming.CharacterEllipsis, TextWrapping = TextWrapping.NoWrap, MaxLines = 1 };
        Content = text; Padding = new Thickness(0); MinWidth = 0; MinHeight = 0; BorderThickness = new Thickness(0); CornerRadius = new CornerRadius(0);
        Background = Ui.Brush("#00000000"); HorizontalAlignment = HorizontalAlignment.Left; VerticalAlignment = VerticalAlignment.Center; HorizontalContentAlignment = HorizontalAlignment.Left;
        foreach (var key in new[] { "ButtonBackgroundPointerOver", "ButtonBackgroundPressed", "ButtonBorderBrushPointerOver", "ButtonBorderBrushPressed" }) Resources[key] = Ui.Brush("#00000000");
        ProtectedCursor = InputSystemCursor.Create(InputSystemCursorShape.Hand);
        PointerEntered += (_, _) => Highlight(true);
        PointerExited += (_, _) => Highlight(false);
        PointerCanceled += (_, _) => Highlight(false);
        PointerCaptureLost += (_, _) => Highlight(false);
        GotFocus += (_, _) => Highlight(FocusState == FocusState.Keyboard);
        LostFocus += (_, _) => Highlight(false);
        Click += (_, _) => { if (target != null) open(target); };
    }

    public void Set(string name, Func<Task>? destination)
    {
        text.Text = name; target = destination;
        IsHitTestVisible = IsTabStop = destination != null;
        ToolTipService.SetToolTip(this, destination != null && !string.IsNullOrWhiteSpace(name) ? name : null);
        AutomationProperties.SetName(this, destination != null ? action + " " + name : name);
        Highlight(false);
    }

    private void Highlight(bool on)
    {
        bool active = on && target != null;
        text.Foreground = active ? hover : rest;
        text.TextDecorations = active ? global::Windows.UI.Text.TextDecorations.Underline : global::Windows.UI.Text.TextDecorations.None;
    }
}
