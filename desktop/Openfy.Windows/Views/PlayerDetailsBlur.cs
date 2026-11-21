using System.Numerics;
using System.Runtime.InteropServices;
using Microsoft.Graphics.Canvas.Effects;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Openfy.Core;

namespace Openfy.Windows.Views;

/// <summary>
/// The pill's scrub state, after the web <c>filter: blur(8px); opacity: .22</c> on <c>.now-playing</c>:
/// a live copy of the cover and title is drawn through a Gaussian blur while the sharp original is hidden.
/// At rest the original is shown untouched and the copy is not drawn.
/// </summary>
internal sealed class PlayerDetailsBlur : IDisposable
{
    private const string Amount = "Blur.BlurAmount";
    private const float Radius = 8, Padding = 3 * Radius;
    private readonly Visual sharpVisual;
    private readonly FrameworkElement details;
    private readonly CompositionVisualSurface surface;
    private readonly CompositionSurfaceBrush source;
    private readonly CompositionEffectBrush brush;
    private readonly SpriteVisual sprite;

    private PlayerDetailsBlur(Grid sharp, Grid host, FrameworkElement details)
    {
        sharpVisual = ElementCompositionPreview.GetElementVisual(sharp);
        this.details = details;
        var visual = ElementCompositionPreview.GetElementVisual(details);
        var compositor = visual.Compositor;
        using var effect = new GaussianBlurEffect {
            Name = "Blur",
            BlurAmount = 0,
            BorderMode = EffectBorderMode.Soft,
            Optimization = EffectOptimization.Balanced,
            Source = new CompositionEffectSourceParameter("Details")
        };
        using var factory = compositor.CreateEffectFactory(effect, [Amount]);
        surface = compositor.CreateVisualSurface();
        surface.SourceVisual = visual;
        source = compositor.CreateSurfaceBrush(surface);
        source.Stretch = CompositionStretch.None;
        brush = factory.CreateBrush();
        brush.SetSourceParameter("Details", source);
        sprite = compositor.CreateSpriteVisual();
        sprite.Brush = brush;
        sprite.IsVisible = false;
        ElementCompositionPreview.SetElementChildVisual(host, sprite);
        details.SizeChanged += Resize;
        Resize(details, null);
    }

    /// <summary>
    /// Wraps <paramref name="details"/> so its parent's opacity can hide the original without
    /// affecting the copy, and places the blurred copy in the same cell. Returns null when the
    /// effect cannot be created; the caller then fades the details without blur.
    /// </summary>
    public static PlayerDetailsBlur? Attach(Grid display, FrameworkElement details)
    {
        int index = display.Children.IndexOf(details);
        if (index < 0) return null;
        display.Children.RemoveAt(index);
        var sharp = new Grid { Children = { details } };
        var host = new Grid { IsHitTestVisible = false };
        display.Children.Insert(index, sharp);
        display.Children.Insert(index + 1, host);
        try { return new PlayerDetailsBlur(sharp, host, details); }
        catch (COMException error)
        {
            SessionLog.Write("playback.scrub-blur", "failed", error: error);
            return null;
        }
    }

    public void Draw(double amount)
    {
        bool blurred = amount > 0;
        // Hide the original on its composition visual: XAML stops rendering a subtree whose Opacity is 0,
        // which would leave the copy empty.
        sharpVisual.Opacity = blurred ? 0 : 1;
        sprite.IsVisible = blurred;
        sprite.Opacity = (float)(1 - .78 * amount);
        brush.Properties.InsertScalar(Amount, (float)(Radius * amount));
    }

    private void Resize(object sender, SizeChangedEventArgs? args)
    {
        var size = new Vector2((float)details.ActualWidth + 2 * Padding, (float)details.ActualHeight + 2 * Padding);
        surface.SourceOffset = new(-Padding, -Padding);
        surface.SourceSize = size;
        sprite.Size = size;
        sprite.Offset = new(-Padding, -Padding, 0);
    }

    public void Dispose()
    {
        details.SizeChanged -= Resize;
        sprite.Brush = null;
        brush.Dispose();
        source.Dispose();
        surface.Dispose();
        sprite.Dispose();
    }
}
