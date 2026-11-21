using System.Globalization;

namespace Openfy.Core;

/// <summary>The native twin of shared/utils/album-tint.ts.</summary>
public sealed record AlbumTint(string Background, string Surface, string Muted, string Edge)
{
    private readonly record struct Rgb(int R, int G, int B)
    {
        public string Hex => $"#{R:X2}{G:X2}{B:X2}";
    }

    private struct Bucket
    {
        public int Count, R, G, B;
    }

    private static readonly Rgb Base = new(9, 9, 11);
    private static readonly Rgb White = new(255, 255, 255);
    private const int Sample = 64;
    private const double MaxLightness = 0.30;
    private const double MaxChroma = 0.125;
    private const double MinMutedContrast = 4.5;

    private static int Round(double value) => (int)Math.Floor(value + 0.5);
    private static Rgb Mix(Rgb a, Rgb b, int weight)
    {
        int Channel(int from, int to) => Round(((100 - weight) * from + weight * to) / 100.0);
        return new(Channel(a.R, b.R), Channel(a.G, b.G), Channel(a.B, b.B));
    }

    private static double Linear(int channel)
    {
        double s = channel / 255.0;
        return s <= 0.04045 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4);
    }

    private static int Encode(double value)
    {
        double v = Math.Clamp(value, 0, 1);
        return Round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.Pow(v, 1 / 2.4) - 0.055));
    }

    private static double Luminance(Rgb color) =>
        0.2126 * Linear(color.R) + 0.7152 * Linear(color.G) + 0.0722 * Linear(color.B);

    private static double Contrast(Rgb a, Rgb b)
    {
        double first = Luminance(a), second = Luminance(b);
        return (Math.Max(first, second) + 0.05) / (Math.Min(first, second) + 0.05);
    }

    private static Rgb PageColor(Rgb color)
    {
        double r = Linear(color.R), g = Linear(color.G), b = Linear(color.B);
        double l = Math.Cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        double m = Math.Cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        double s = Math.Cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        double lightness = Math.Min(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, MaxLightness);
        double a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
        double labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
        double chroma = double.Hypot(a, labB);
        if (chroma > MaxChroma)
        {
            double scale = MaxChroma / chroma;
            a *= scale;
            labB *= scale;
        }
        double l2 = Math.Pow(lightness + 0.3963377774 * a + 0.2158037573 * labB, 3);
        double m2 = Math.Pow(lightness - 0.1055613458 * a - 0.0638541728 * labB, 3);
        double s2 = Math.Pow(lightness - 0.0894841775 * a - 1.291485548 * labB, 3);
        return new(
            Encode(4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2),
            Encode(-1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2),
            Encode(-0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2));
    }

    public static AlbumTint From(string? hex)
    {
        // Match ECMAScript trim, including a BOM and excluding NEL.
        static bool WhiteSpace(char c) => c is >= '\u0009' and <= '\u000D' or ' ' or '\u00A0' or '\u1680'
            or >= '\u2000' and <= '\u200A' or '\u2028' or '\u2029' or '\u202F' or '\u205F' or '\u3000' or '\uFEFF';
        var digits = hex.AsSpan();
        while (!digits.IsEmpty && WhiteSpace(digits[0])) digits = digits[1..];
        while (!digits.IsEmpty && WhiteSpace(digits[^1])) digits = digits[..^1];
        if (digits.StartsWith("#", StringComparison.Ordinal)) digits = digits[1..];
        var input = digits.Length == 6 && int.TryParse(digits, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out int value)
            && digits.IndexOf('\0') < 0
            ? new Rgb(value >> 16, (value >> 8) & 255, value & 255)
            : Base;
        var background = PageColor(input);
        var surface = Mix(background, White, 8);
        var lifted = new Rgb(Math.Min(255, background.R + 161), Math.Min(255, background.G + 161), Math.Min(255, background.B + 166));
        var muted = lifted;
        for (int weight = 10; Contrast(muted, surface) < MinMutedContrast && weight <= 100; weight += 10)
            muted = Mix(lifted, White, weight);
        return new(background.Hex, surface.Hex, muted.Hex, Mix(background, default, 28).Hex);
    }

    /// <summary>Samples the centered square of decoded sRGB pixels in RGB or RGBA order.</summary>
    public static string? Dominant(ReadOnlySpan<byte> pixels, int width, int height, int channels)
    {
        if (width < 1 || height < 1 || channels is not (3 or 4) || (long)width * height > pixels.Length / channels)
            return null;
        int side = Math.Min(width, height);
        double left = (width - side) / 2.0, top = (height - side) / 2.0;
        var buckets = new Bucket[4096];
        for (int y = 0; y < Sample; y++)
        {
            int row = (int)Math.Floor(top + (y + 0.5) * side / Sample) * width;
            for (int x = 0; x < Sample; x++)
            {
                int index = (row + (int)Math.Floor(left + (x + 0.5) * side / Sample)) * channels;
                if (channels == 4 && pixels[index + 3] < 128) continue;
                int r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
                ref var bucket = ref buckets[(r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)];
                bucket.Count++;
                bucket.R += r;
                bucket.G += g;
                bucket.B += b;
            }
        }
        Bucket winner = default;
        foreach (var bucket in buckets)
            if (bucket.Count > winner.Count) winner = bucket;
        return winner.Count == 0 ? null : new Rgb(
            Round((double)winner.R / winner.Count),
            Round((double)winner.G / winner.Count),
            Round((double)winner.B / winner.Count)).Hex;
    }
}
