namespace Openfy.Core;

/// <summary>Page colours of an artist (shared/utils/artist-theme.ts ArtistTheme).</summary>
public sealed record ArtistThemeColors(string Base, string Secondary, string Deep, string Surface, bool Neutral);

/// <summary>
/// Twin of shared/utils/artist-theme.ts, pinned by tests/fixtures/artist-theme-contract.json.
/// </summary>
public static class ArtistTheme
{
    public const int Sample = 16;
    private const int PixelCount = Sample * Sample;
    private const int BucketCount = 12;
    private const double MaxLuminance = 0.14;

    private readonly record struct Rgb(double R, double G, double B);
    private readonly record struct Hsl(double H, double S, double L);
    private struct Bucket { public double Weight, R, G, B; }

    public static readonly ArtistThemeColors NeutralTheme = Theme(new(215, 0.18, 0.30), new(230, 0.14, 0.26), true);

    /// <summary>Page colours from a 16×16 sample; <paramref name="channels"/> is 3 (RGB), or 4 for BGRA when <paramref name="bgra"/> is set, RGBA otherwise.</summary>
    public static ArtistThemeColors From(ReadOnlySpan<byte> pixels, int channels = 4, bool bgra = true)
    {
        if (channels is not (3 or 4) || pixels.Length < PixelCount * channels) return NeutralTheme;
        var red = channels == 4 && bgra ? 2 : 0;
        var blue = 2 - red;
        var buckets = new Bucket[BucketCount];
        double totalChroma = 0;
        for (var i = 0; i < PixelCount * channels; i += channels)
        {
            var r = pixels[i + red] / 255.0;
            var g = pixels[i + 1] / 255.0;
            var b = pixels[i + blue] / 255.0;
            var max = Math.Max(r, Math.Max(g, b));
            var min = Math.Min(r, Math.Min(g, b));
            var chroma = max - min;
            totalChroma += chroma;
            if (max < 0.08 || min > 0.92) continue;
            var hue = ToHsl(r, g, b).H;
            ref var bucket = ref buckets[(int)Math.Floor(hue / 30)];
            bucket.Weight += chroma;
            bucket.R += chroma * r;
            bucket.G += chroma * g;
            bucket.B += chroma * b;
        }

        var dominant = 0;
        for (var i = 1; i < BucketCount; i++)
            if (buckets[i].Weight > buckets[dominant].Weight) dominant = i;
        var primary = buckets[dominant];
        if (totalChroma / PixelCount < 0.08 || primary.Weight == 0) return NeutralTheme;

        Bucket? alternate = null;
        for (var i = 0; i < BucketCount; i++)
        {
            var distance = Math.Abs(i - dominant);
            var bucket = buckets[i];
            if (Math.Min(distance, BucketCount - distance) < 2 || bucket.Weight < 0.15 * primary.Weight) continue;
            if (alternate is null || bucket.Weight > alternate.Value.Weight) alternate = bucket;
        }
        var baseColor = BucketColor(primary);
        var secondary = alternate is { } value ? BucketColor(value) : baseColor with { H = (baseColor.H + 20) % 360 };
        return Theme(baseColor, secondary, false);
    }

    private static Hsl ToHsl(double r, double g, double b)
    {
        var max = Math.Max(r, Math.Max(g, b));
        var min = Math.Min(r, Math.Min(g, b));
        var chroma = max - min;
        var lightness = (max + min) / 2;
        if (chroma == 0) return new(0, 0, lightness);
        var hue = 60 * (max == r ? (g - b) / chroma : max == g ? (b - r) / chroma + 2 : (r - g) / chroma + 4);
        return new(hue < 0 ? hue + 360 : hue, chroma / (1 - Math.Abs(2 * lightness - 1)), lightness);
    }

    private static Rgb ToRgb(Hsl color)
    {
        var (hue, saturation, lightness) = color;
        var amplitude = saturation * Math.Min(lightness, 1 - lightness);
        double Channel(int offset)
        {
            var k = (offset + hue / 30) % 12;
            return lightness - amplitude * Math.Max(-1, Math.Min(Math.Min(k - 3, 9 - k), 1));
        }
        return new(Channel(0), Channel(8), Channel(4));
    }

    private static double Luminance(Rgb color)
    {
        static double Linear(double c) => c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
        return 0.2126 * Linear(color.R) + 0.7152 * Linear(color.G) + 0.0722 * Linear(color.B);
    }

    private static Hsl FitContrast(Hsl color)
    {
        if (Luminance(ToRgb(color)) <= MaxLuminance) return color;
        double low = 0, high = color.L;
        for (var i = 0; i < 24; i++)
        {
            var mid = (low + high) / 2;
            if (Luminance(ToRgb(color with { L = mid })) <= MaxLuminance) low = mid;
            else high = mid;
        }
        return color with { L = low };
    }

    private static Hsl BucketColor(Bucket bucket)
    {
        var (h, s, l) = ToHsl(bucket.R / bucket.Weight, bucket.G / bucket.Weight, bucket.B / bucket.Weight);
        return new(h, Math.Clamp(s, 0.45, 0.85), Math.Clamp(l, 0.22, 0.60));
    }

    private static string Hex(Rgb color)
    {
        static int Channel(double c) => (int)Math.Round(c * 255, MidpointRounding.AwayFromZero);
        return $"#{Channel(color.R):x2}{Channel(color.G):x2}{Channel(color.B):x2}";
    }

    private static ArtistThemeColors Theme(Hsl baseColor, Hsl secondary, bool neutral)
    {
        var fitted = FitContrast(baseColor);
        var rgb = ToRgb(fitted);
        // Lighter for hover/selection while white text keeps AA; otherwise a darker step of base.
        var lighter = new Rgb(rgb.R + (1 - rgb.R) * 0.10, rgb.G + (1 - rgb.G) * 0.10, rgb.B + (1 - rgb.B) * 0.10);
        var surface = Luminance(lighter) <= MaxLuminance ? lighter : new Rgb(rgb.R * 0.82, rgb.G * 0.82, rgb.B * 0.82);
        return new(Hex(rgb), Hex(ToRgb(FitContrast(secondary))), Hex(ToRgb(fitted with { L = fitted.L * 0.45 })), Hex(surface), neutral);
    }
}
