using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Services;
using global::Windows.Graphics.Imaging;
using global::Windows.Storage;
using global::Windows.Storage.Streams;

namespace Openfy.Windows.Views;

/// <summary>
/// Artist page colours (web twin: app/composables/useArtistTheme.ts). The prepared artwork is decoded once at
/// 16 × 16 and passed to <see cref="ArtistTheme.From"/>. Themes are kept for the session by artist key, so the
/// search result reuses the colours of an artist page already opened.
/// </summary>
internal static class ArtistThemes
{
    private static readonly Dictionary<string, ArtistThemeColors> Known = [];
    private static readonly Dictionary<string, Task<ArtistThemeColors>> Pending = [];

    public static ArtistThemeColors? Cached(string? key) => key != null && Known.TryGetValue(key, out var theme) ? theme : null;
    private static void Remember(string? key, ArtistThemeColors theme)
    {
        if (key == null) return;
        Known[key] = theme;
        if (Known.Count > 96) Known.Remove(Known.Keys.First());
    }

    /// <summary>The theme of <paramref name="url"/>, or the neutral slate when it is missing or cannot be read.</summary>
    public static Task<ArtistThemeColors> LoadAsync(ArtworkService artwork, string? url, string? key = null)
    {
        if (Cached(key) is { } known) return Task.FromResult(known);
        if (string.IsNullOrWhiteSpace(url)) return Task.FromResult(ArtistTheme.NeutralTheme);
        string id = key ?? "url:" + url;
        if (Known.TryGetValue("url:" + url, out var byUrl)) { Remember(key, byUrl); return Task.FromResult(byUrl); }
        if (!Pending.TryGetValue(id, out var work)) Pending[id] = work = Track();
        return work;

        // Runs on the UI thread, which owns both dictionaries.
        async Task<ArtistThemeColors> Track()
        {
            // An immediate decoder failure must finish after the work is registered.
            await Task.Yield();
            try {
                // A failed read is not remembered: the next visit samples again.
                if (await Compute(artwork, url) is not { } theme) return ArtistTheme.NeutralTheme;
                Remember("url:" + url, theme); Remember(key, theme); return theme;
            }
            finally { Pending.Remove(id); }
        }
    }

    private static async Task<ArtistThemeColors?> Compute(ArtworkService artwork, string url)
    {
        try {
            var prepared = await artwork.GetAsync(url, 128);
            var file = await StorageFile.GetFileFromPathAsync(prepared.Path);
            using IRandomAccessStream stream = await file.OpenReadAsync();
            var decoder = await BitmapDecoder.CreateAsync(stream);
            var transform = new BitmapTransform { ScaledWidth = ArtistTheme.Sample, ScaledHeight = ArtistTheme.Sample, InterpolationMode = BitmapInterpolationMode.Fant };
            var data = await decoder.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, transform, ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage);
            return ArtistTheme.From(data.DetachPixelData(), 4, bgra: true);
        } catch { return null; }
    }

    public static global::Windows.UI.Color Color(string hex)
    {
        uint rgb = uint.Parse(hex.AsSpan(1), System.Globalization.NumberStyles.HexNumber);
        byte alpha = 255;
        if (hex.Length == 9) { alpha = (byte)rgb; rgb >>= 8; }
        return global::Windows.UI.Color.FromArgb(alpha, (byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
    }

    public static global::Windows.UI.Color Mix(global::Windows.UI.Color a, global::Windows.UI.Color b, double t)
    {
        t = Math.Clamp(t, 0, 1);
        byte Lerp(byte x, byte y) => (byte)Math.Round(x + (y - x) * t);
        return global::Windows.UI.Color.FromArgb(Lerp(a.A, b.A), Lerp(a.R, b.R), Lerp(a.G, b.G), Lerp(a.B, b.B));
    }

    /// <summary>The <c>base → deep</c> diagonal used by the search result panel.</summary>
    public static LinearGradientBrush Panel(ArtistThemeColors theme)
    {
        var brush = new LinearGradientBrush { StartPoint = new(0, 0), EndPoint = new(1, 1) };
        brush.GradientStops.Add(new() { Color = Color(theme.Base), Offset = 0 });
        brush.GradientStops.Add(new() { Color = Color(theme.Deep), Offset = 1 });
        return brush;
    }
}
