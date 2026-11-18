namespace Openfy.Core;

/// <summary>
/// Ambient lighting rules shared with the PWA (shared/utils/ambient.ts). Values are pinned by
/// tests/fixtures/ambient-contract.json; the HLSL in Graphics/ReactiveSurface.cs and the GLSL in
/// app/lib/ambient-gl.ts apply the same grade per pixel.
/// </summary>
public static class Ambient
{
    public const int TextureSize = 64;
    // A small shadow lift keeps detail visible without turning artwork blacks into grey.
    public const float LumaFloor = .04f, LumaCeiling = .74f, Saturation = 1.4f;
    public const float ScrimMin = .08f, ScrimMax = .4f, ScrimPivot = .38f, ScrimSlope = .8f;
    public const float LyricsScrim = .18f, FadeSeconds = 1.2f;
    /// <summary>Phase units per second while playing; the shaders turn phase into drift and rotation.</summary>
    public const float MotionSpeed = 2.4f;

    public static float Luma(float r, float g, float b) => .2126f * r + .7152f * g + .0722f * b;

    public static (float R, float G, float B) Grade(float r, float g, float b)
    {
        float luma = Luma(r, g, b), lifted = LumaFloor + (LumaCeiling - LumaFloor) * luma;
        return (Math.Clamp(lifted + (r - luma) * Saturation, 0, 1), Math.Clamp(lifted + (g - luma) * Saturation, 0, 1), Math.Clamp(lifted + (b - luma) * Saturation, 0, 1));
    }

    public static float Scrim(float meanLuma) => Math.Clamp(ScrimMin + (meanLuma - ScrimPivot) * ScrimSlope, ScrimMin, ScrimMax);

    public static float Fade(double elapsed)
    {
        float t = (float)Math.Clamp(elapsed / FadeSeconds, 0, 1);
        return t * t * (3 - 2 * t);
    }

    /// <summary>Mean luma (0..1) of a BGRA byte buffer.</summary>
    public static float MeanLuma(ReadOnlySpan<byte> bgra)
    {
        int count = bgra.Length / 4; double total = 0;
        for (int i = 0; i < count * 4; i += 4) total += Luma(bgra[i + 2] / 255f, bgra[i + 1] / 255f, bgra[i] / 255f);
        return count == 0 ? 0 : (float)(total / count);
    }

    /// <summary>Square BGRA texture used when no artwork pixels are available.</summary>
    public static byte[] PaletteTexture(IReadOnlyList<string> palette, int size = TextureSize)
    {
        var colors = Enumerable.Range(0, 3).Select(i => Parse(i < palette.Count ? palette[i] : null)).ToArray();
        var pixels = new byte[size * size * 4];
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                double u = x / (double)(size - 1), v = y / (double)(size - 1); int offset = (y * size + x) * 4;
                for (int channel = 0; channel < 3; channel++)
                {
                    double across = colors[0][channel] + (colors[1][channel] - colors[0][channel]) * u;
                    // BGRA: channel 0 (red) lands at offset + 2.
                    pixels[offset + 2 - channel] = (byte)Math.Round(across + (colors[2][channel] - across) * v, MidpointRounding.AwayFromZero);
                }
                pixels[offset + 3] = 255;
            }
        return pixels;
    }

    private static int[] Parse(string? value)
    {
        string hex = value?.Trim().TrimStart('#') ?? "";
        if (hex.Length != 6 || !int.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out int number)) number = 0x28483e;
        return [number >> 16 & 255, number >> 8 & 255, number & 255];
    }
}
