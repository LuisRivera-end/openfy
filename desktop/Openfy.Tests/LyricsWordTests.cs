using System.Text.Json;
using Openfy.Core;
using Xunit;

public sealed class LyricsWordTests
{
    [Fact]
    public void FindsTheSungWordLikeThePwa()
    {
        var fixture = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "lyrics-contract.json")));
        var lines = fixture.GetProperty("lines");
        foreach (var example in fixture.GetProperty("active").EnumerateArray())
        {
            var line = lines.GetProperty(example.GetProperty("line").GetString()!).Deserialize<LyricsLine>(Contracts.Json);
            double? next = example.GetProperty("next").ValueKind == JsonValueKind.Null ? null : example.GetProperty("next").GetDouble();
            var value = RenderPolicy.ActiveLyricsWord(line, next, example.GetProperty("position").GetDouble());
            var expected = example.GetProperty("expected");
            if (expected.ValueKind == JsonValueKind.Null) { Assert.Null(value); continue; }
            Assert.NotNull(value);
            Assert.Equal(expected.GetProperty("index").GetInt32(), value!.Value.Index);
            Assert.Equal(expected.GetProperty("progress").GetDouble(), value.Value.Progress, 6);
        }
    }

    [Fact]
    public void ReadsParsedWordTimingFromTheServerWireFormat()
    {
        var fixture = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "lyrics-contract.json")));
        var parsed = fixture.GetProperty("parse")[0].GetProperty("lines").Deserialize<LyricsLine[]>(Contracts.Json)!;
        Assert.Equal(3, parsed[0].Words!.Length);
        Assert.Equal("Hola mundo bonito", string.Concat(parsed[0].Words!.Select(word => word.Text)));
        Assert.Equal(12, parsed[0].End);
        Assert.Null(parsed[1].Words);
        Assert.False(JsonSerializer.SerializeToElement(parsed[1], Contracts.Json).TryGetProperty("words", out _));
    }
}
