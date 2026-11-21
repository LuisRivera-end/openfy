using System.Runtime.InteropServices;
using Microsoft.Graphics.Canvas.Effects;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Color = Windows.UI.Color;

namespace Openfy.Windows.Views;

internal sealed class GlassBrush(Compositor compositor, float blurAmount, float tintOpacity) : XamlCompositionBrushBase
{
    private const string Backdrop = "Backdrop";
    private const string TintProperty = "Tint.Color";
    private CompositionBackdropBrush? backdrop;
    private Color tintColor;

    public Color TintColor
    {
        get => tintColor;
        set
        {
            if (tintColor == value) return;
            tintColor = value;
            CompositionBrush?.Properties.InsertColor(TintProperty, EffectTint);
        }
    }

    private Color EffectTint => Color.FromArgb((byte)MathF.Round(tintColor.A * tintOpacity),
        tintColor.R, tintColor.G, tintColor.B);

    protected override void OnConnected()
    {
        if (CompositionBrush != null) return;

        using var blur = new GaussianBlurEffect
        {
            BlurAmount = blurAmount,
            BorderMode = EffectBorderMode.Hard,
            Source = new CompositionEffectSourceParameter(Backdrop)
        };
        using var saturation = new SaturationEffect { Saturation = 1.8f, Source = blur };
        using var tint = new ColorSourceEffect { Name = "Tint", Color = EffectTint };
        using var composite = new CompositeEffect { Sources = { saturation, tint } };
        CompositionEffectBrush? effect = null;
        try
        {
            using var factory = compositor.CreateEffectFactory(composite, [TintProperty]);
            effect = factory.CreateBrush();
            backdrop = compositor.CreateBackdropBrush();
            effect.SetSourceParameter(Backdrop, backdrop);
            CompositionBrush = effect;
        }
        catch (COMException error)
        {
            effect?.Dispose();
            backdrop?.Dispose();
            backdrop = null;
            SessionLog.Write("playback.glass", "failed", error: error);
        }
    }

    protected override void OnDisconnected()
    {
        var brush = CompositionBrush;
        CompositionBrush = null;
        brush?.Dispose();
        backdrop?.Dispose();
        backdrop = null;
    }
}
