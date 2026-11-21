using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Color = global::Windows.UI.Color;

namespace Openfy.Windows.Views;

/// <summary>
/// Theme-resource overrides read by a control's visual states (pointer over, pressed, focused, disabled).
/// Replacing or removing such an entry in a templated control's <see cref="FrameworkElement.Resources"/> can fail
/// with 0x800F0902 while the control is in that state (leaving a transparent artist page did, from the search box),
/// so every key gets one owned brush, registered while the control is still new, and later changes only recolour it.
/// A brush can follow a source brush whose colour animates (the frame tint, the artist palette); <see cref="Refresh"/>
/// copies the current source colours.
/// </summary>
internal sealed class StateBrushes
{
    // Stored on the element itself: a ConditionalWeakTable keyed by the .NET wrapper loses the entry when CsWinRT
    // collects that wrapper and hands out a new one for the same XAML object (recycled list containers do this).
    private static readonly DependencyProperty OwnedProperty = DependencyProperty.RegisterAttached(
        "OpenfyStateBrushes", typeof(object), typeof(StateBrushes), new PropertyMetadata(null));
    private static readonly List<WeakReference<StateBrushes>> following = [];
    private readonly Dictionary<string, SolidColorBrush> brushes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SolidColorBrush> sources = new(StringComparer.Ordinal);
    private bool listed;

    /// <summary>Registers the keys that are not registered yet. Call it before the control is first shown.</summary>
    public static StateBrushes Register(FrameworkElement element, params string[] keys)
    {
        var owned = Owned(element);
        foreach (string key in keys)
        {
            if (owned.brushes.ContainsKey(key)) continue;
            var brush = new SolidColorBrush(ThemeColor(key));
            owned.brushes[key] = brush;
            element.Resources[key] = brush;
        }
        return owned;
    }

    /// <summary>
    /// Takes over brushes the element already declares (a XAML template's own resources) without writing to its
    /// dictionary, and starts them at the theme colours. Safe on controls that are already templated.
    /// </summary>
    public static StateBrushes Adopt(FrameworkElement element, params string[] keys)
    {
        var owned = Owned(element);
        foreach (string key in keys)
        {
            if (owned.brushes.ContainsKey(key) || !element.Resources.TryGetValue(key, out var value) || value is not SolidColorBrush brush) continue;
            owned.brushes[key] = brush;
            owned.Paint(key, ThemeColor(key));
        }
        return owned;
    }

    public bool Has(params string[] keys) => keys.All(brushes.ContainsKey);

    public static StateBrushes? Of(FrameworkElement element) => element.GetValue(OwnedProperty) as StateBrushes;

    private static StateBrushes Owned(FrameworkElement element)
    {
        if (Of(element) is { } owned) return owned;
        owned = new StateBrushes();
        element.SetValue(OwnedProperty, owned);
        return owned;
    }

    public StateBrushes Set(Color color, params string[] keys)
    {
        foreach (string key in keys) { sources.Remove(key); Paint(key, color); }
        return this;
    }

    public StateBrushes Follow(SolidColorBrush source, params string[] keys)
    {
        foreach (string key in keys) { sources[key] = source; Paint(key, source.Color); }
        if (!listed && sources.Count > 0) { listed = true; following.Add(new(this)); }
        return this;
    }

    /// <summary>Returns the keys to the colours the theme gives them.</summary>
    public StateBrushes Reset(params string[] keys)
    {
        foreach (string key in keys) { sources.Remove(key); Paint(key, ThemeColor(key)); }
        return this;
    }

    public static void Refresh()
    {
        for (int i = following.Count - 1; i >= 0; i--)
        {
            if (!following[i].TryGetTarget(out var owned) || owned.sources.Count == 0)
            {
                if (owned != null) owned.listed = false;
                following.RemoveAt(i);
                continue;
            }
            foreach (var (key, source) in owned.sources) owned.Paint(key, source.Color);
        }
    }

    public static Color ThemeColor(string key)
        => Application.Current?.Resources.TryGetValue(key, out var value) == true && value is SolidColorBrush brush ? brush.Color : default;

    private void Paint(string key, Color color)
    {
        if (brushes.TryGetValue(key, out var brush) && brush.Color != color) brush.Color = color;
    }
}
