using System.Text.Json;
using Openfy.Core;
using Xunit;

public sealed class AlbumTintTests
{
    private static JsonElement Fixture() => JsonSerializer.Deserialize<JsonElement>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "album-tint-contract.json")));

    public static IEnumerable<object?[]> TintCases() => Fixture().GetProperty("tint").EnumerateArray()
        .Select(example => new object?[] { example.GetProperty("name").GetString(), example.GetProperty("input").GetString(),
            example.GetProperty("expected").Deserialize<AlbumTint>(Contracts.Json) });

    [Theory]
    [MemberData(nameof(TintCases), DisableDiscoveryEnumeration = true)]
    public void MatchesEverySharedTint(string name, string? input, AlbumTint expected)
    {
        var actual = AlbumTint.From(input);
        Assert.True(expected == actual, $"{name}: expected {expected}, got {actual}");
    }

    [Fact]
    public void MatchesEverySharedDominantColor()
    {
        foreach (var example in Fixture().GetProperty("dominant").EnumerateArray())
        {
            var pixels = example.GetProperty("pixels").EnumerateArray().Select(value => value.GetByte()).ToArray();
            var actual = AlbumTint.Dominant(pixels, example.GetProperty("width").GetInt32(),
                example.GetProperty("height").GetInt32(), example.GetProperty("channels").GetInt32());
            Assert.Equal(example.GetProperty("expected").GetString(), actual);
        }
    }
}
