using System.Text.Json;
using Openfy.Core;
using Xunit;

public sealed class ArtistThemeTests
{
    [Fact]
    public void MatchesTheSharedArtistThemeContract()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "artist-theme-contract.json")));
        foreach (var example in fixture.RootElement.EnumerateArray())
        {
            var name = example.GetProperty("name").GetString();
            var pixels = example.GetProperty("pixels").EnumerateArray().Select(value => value.GetByte()).ToArray();
            Assert.Equal(ArtistTheme.Sample * ArtistTheme.Sample * 3, pixels.Length);
            var actual = ArtistTheme.From(pixels, channels: 3);
            var expected = example.GetProperty("expected");
            Assert.Equal(expected.GetProperty("neutral").GetBoolean(), actual.Neutral);

            foreach (var (key, hex) in new[] { ("base", actual.Base), ("secondary", actual.Secondary), ("deep", actual.Deep), ("surface", actual.Surface) })
            {
                Assert.Matches("^#[0-9a-f]{6}$", hex);
                var channels = Rgb(hex);
                var expectedChannels = Rgb(expected.GetProperty(key).GetString()!);
                for (var i = 0; i < channels.Length; i++)
                    Assert.True(Math.Abs(channels[i] - expectedChannels[i]) <= 2, $"{name} / {key}: {hex}");
            }

            foreach (var background in new[] { actual.Base, actual.Secondary, actual.Deep, actual.Surface })
                Assert.True((Luminance("#EDEDF0") + 0.05) / (Luminance(background) + 0.05) >= 4.5, $"{name}: {background}");

            var bgra = new byte[ArtistTheme.Sample * ArtistTheme.Sample * 4];
            for (var i = 0; i < ArtistTheme.Sample * ArtistTheme.Sample; i++)
            {
                bgra[i * 4] = pixels[i * 3 + 2];
                bgra[i * 4 + 1] = pixels[i * 3 + 1];
                bgra[i * 4 + 2] = pixels[i * 3];
                bgra[i * 4 + 3] = 255;
            }
            Assert.Equal(actual, ArtistTheme.From(bgra));
        }
    }

    [Fact]
    public void UsesTheSameNeutralThemeWithoutASample()
        => Assert.Equal(ArtistTheme.NeutralTheme, ArtistTheme.From(default));

    private static int[] Rgb(string hex) => [Convert.ToInt32(hex[1..3], 16), Convert.ToInt32(hex[3..5], 16), Convert.ToInt32(hex[5..7], 16)];

    private static double Luminance(string hex)
    {
        static double Linear(int value)
        {
            var c = value / 255.0;
            return c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
        }
        var rgb = Rgb(hex);
        return 0.2126 * Linear(rgb[0]) + 0.7152 * Linear(rgb[1]) + 0.0722 * Linear(rgb[2]);
    }
}
