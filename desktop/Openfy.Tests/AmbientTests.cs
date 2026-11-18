using System.Text.Json;
using Openfy.Core;
using Xunit;

public sealed class AmbientTests
{
    private static JsonElement Fixture() => JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "ambient-contract.json")));

    [Fact]
    public void UsesTheSameAmbientParametersAsThePwa()
    {
        var p = Fixture().GetProperty("parameters");
        Assert.Equal(p.GetProperty("textureSize").GetInt32(), Ambient.TextureSize);
        Assert.Equal(p.GetProperty("lumaFloor").GetSingle(), Ambient.LumaFloor);
        Assert.Equal(p.GetProperty("lumaCeiling").GetSingle(), Ambient.LumaCeiling);
        Assert.Equal(p.GetProperty("saturation").GetSingle(), Ambient.Saturation);
        Assert.Equal(p.GetProperty("scrimMin").GetSingle(), Ambient.ScrimMin);
        Assert.Equal(p.GetProperty("scrimMax").GetSingle(), Ambient.ScrimMax);
        Assert.Equal(p.GetProperty("scrimPivot").GetSingle(), Ambient.ScrimPivot);
        Assert.Equal(p.GetProperty("scrimSlope").GetSingle(), Ambient.ScrimSlope);
        Assert.Equal(p.GetProperty("lyricsScrim").GetSingle(), Ambient.LyricsScrim);
        Assert.Equal(p.GetProperty("fadeSeconds").GetSingle(), Ambient.FadeSeconds);
        Assert.Equal(p.GetProperty("motionSpeed").GetSingle(), Ambient.MotionSpeed);
    }

    [Fact]
    public void GradesScrimsAndFadesLikeThePwa()
    {
        var fixture = Fixture();
        foreach (var example in fixture.GetProperty("grade").EnumerateArray())
        {
            var rgb = example.GetProperty("rgb").EnumerateArray().Select(value => value.GetSingle()).ToArray();
            var expected = example.GetProperty("expected").EnumerateArray().Select(value => value.GetSingle()).ToArray();
            var (r, g, b) = Ambient.Grade(rgb[0], rgb[1], rgb[2]);
            Assert.Equal(expected[0], r, 4); Assert.Equal(expected[1], g, 4); Assert.Equal(expected[2], b, 4);
        }
        foreach (var example in fixture.GetProperty("scrim").EnumerateArray()) Assert.Equal(example.GetProperty("expected").GetSingle(), Ambient.Scrim(example.GetProperty("luma").GetSingle()), 5);
        foreach (var example in fixture.GetProperty("fade").EnumerateArray()) Assert.Equal(example.GetProperty("expected").GetSingle(), Ambient.Fade(example.GetProperty("elapsed").GetDouble()), 5);
    }

    [Fact]
    public void BuildsTheSamePaletteFallbackTextureInBgra()
    {
        var palette = Fixture().GetProperty("palette");
        var pixels = Ambient.PaletteTexture(palette.GetProperty("colors").EnumerateArray().Select(value => value.GetString()!).ToArray());
        Assert.Equal(Ambient.TextureSize * Ambient.TextureSize * 4, pixels.Length);
        foreach (var sample in palette.GetProperty("samples").EnumerateArray())
        {
            int offset = (sample.GetProperty("y").GetInt32() * Ambient.TextureSize + sample.GetProperty("x").GetInt32()) * 4;
            var rgb = sample.GetProperty("rgb").EnumerateArray().Select(value => value.GetInt32()).ToArray();
            Assert.Equal([rgb[2], rgb[1], rgb[0]], new int[] { pixels[offset], pixels[offset + 1], pixels[offset + 2] });
        }
        Assert.Equal(.5f, Ambient.MeanLuma([255, 255, 255, 255, 0, 0, 0, 255]), 5);
        Assert.Equal(new byte[] { 0x3e, 0x48, 0x28 }, Ambient.PaletteTexture(["nope"], 2)[..3]);
    }
}

public sealed class ImmersiveTests
{
    [Theory]
    [InlineData(3, 0, "off", 1)] [InlineData(3, 2, "off", null)]
    [InlineData(3, 2, "all", 0)] [InlineData(3, 1, "one", 1)]
    [InlineData(1, 0, "all", 0)] [InlineData(0, 0, "all", null)]
    public void AnticipatesTheAutomaticQueue(int count, int index, string repeat, int? expected)
        => Assert.Equal(expected, Immersive.NextIndex(count, index, repeat));

    [Theory]
    [InlineData(19.99, 30, null)] [InlineData(20, 30, 10)] [InlineData(29.1, 30, 1)]
    [InlineData(30, 30, 0)] [InlineData(31, 30, null)] [InlineData(0, 0, null)]
    [InlineData(double.NaN, 30, null)] [InlineData(1, double.PositiveInfinity, null)]
    public void CountdownUsesMediaPosition(double position, double duration, int? expected)
        => Assert.Equal(expected, Immersive.UpcomingSeconds(position, duration));

    [Fact]
    public void ChoosesTheSameExpandedLayoutAsThePwa()
    {
        var fixture = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "immersive-layout-contract.json")));
        var parameters = fixture.GetProperty("parameters");
        var presentation = fixture.GetProperty("presentation");
        Assert.Equal(presentation.GetProperty("compactScale").GetDouble(), Immersive.CompactScale);
        Assert.Equal(presentation.GetProperty("compactMs").GetInt32(), Immersive.CompactMilliseconds);
        Assert.Equal(presentation.GetProperty("layoutMs").GetInt32(), Immersive.LayoutMilliseconds);
        Assert.Equal(presentation.GetProperty("lyricsTop").GetDouble(), Immersive.LyricsTop);
        Assert.Equal(presentation.GetProperty("lyricsEdge").GetDouble(), Immersive.LyricsEdge);
        Assert.Equal(presentation.GetProperty("sideMargin").GetDouble(), Immersive.SideMargin);
        Assert.Equal(parameters.GetProperty("splitMinWidth").GetDouble(), Immersive.SplitMinWidth);
        Assert.Equal(parameters.GetProperty("splitMinAspect").GetDouble(), Immersive.SplitMinAspect);
        Assert.Equal(presentation.GetProperty("cardWidth").GetDouble(), Immersive.CardWidth);
        Assert.Equal(presentation.GetProperty("cardHeight").GetDouble(), Immersive.CardHeight);
        Assert.Equal(presentation.GetProperty("cornerHeight").GetDouble(), Immersive.CornerHeight);
        Assert.Equal(presentation.GetProperty("cornerMargin").GetDouble(), Immersive.CornerMargin);
        Assert.Equal(presentation.GetProperty("cornerWidth").GetDouble(), Immersive.CornerWidth);
        Assert.Equal(presentation.GetProperty("cornerMaxWidth").GetDouble(), Immersive.CornerMaxWidth);
        foreach (var card in fixture.GetProperty("cards").EnumerateArray()) {
            var viewport = card.GetProperty("viewport");
            var bounds = Immersive.NextCardBounds(viewport[0].GetDouble(), viewport[1].GetDouble(), card.GetProperty("contentRight").GetDouble(), card.GetProperty("contentWidth").GetDouble(), card.GetProperty("dockTop").GetDouble(), card.GetProperty("idle").GetBoolean());
            double[] actual = [bounds.X, bounds.Y, bounds.Width, bounds.Height, bounds.Scale];
            int i = 0;
            foreach (var expected in card.GetProperty("bounds").EnumerateArray()) Assert.Equal(expected.GetDouble(), actual[i++], 6);
        }
        foreach (var example in fixture.GetProperty("lyricsCases").EnumerateArray()) {
            var status = example.GetProperty("status");
            Assert.Equal(example.GetProperty("lyrics").GetBoolean(), Immersive.BigPictureLyrics(status.ValueKind == JsonValueKind.Null ? null : status.GetString(), example.GetProperty("pending").GetBoolean(), example.GetProperty("previous").GetBoolean()));
        }
        foreach (var example in fixture.GetProperty("cases").EnumerateArray())
            Assert.Equal(example.GetProperty("layout").GetString(), Immersive.Layout(example.GetProperty("width").GetDouble(), example.GetProperty("height").GetDouble(), example.GetProperty("lyrics").GetBoolean()));
    }
}
