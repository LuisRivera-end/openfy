using System.Text.Json;
using Openfy.Core;
using Xunit;

public sealed class ShortcutsTests
{
    private static JsonElement Fixture() => JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "shortcuts-contract.json")));
    private static bool Flag(JsonElement input, string name) => input.TryGetProperty(name, out var value) && value.GetBoolean();

    [Fact]
    public void MapsEveryInputLikeTheWeb()
    {
        foreach (var example in Fixture().GetProperty("cases").EnumerateArray())
        {
            var input = example.GetProperty("input");
            var actual = Shortcuts.Command(new(input.GetProperty("key").GetString()!, Flag(input, "ctrl"), Flag(input, "shift"), Flag(input, "alt"), Flag(input, "meta"), Flag(input, "editable")));
            var expected = example.GetProperty("command");
            Assert.True((expected.ValueKind == JsonValueKind.Null ? null : expected.GetString()) == actual, $"{example.GetProperty("name").GetString()}: {actual}");
        }
    }

    [Fact]
    public void SharesTheStepsAndTheGuide()
    {
        var fixture = Fixture();
        Assert.Equal(Shortcuts.SeekSeconds, fixture.GetProperty("seekSeconds").GetDouble());
        Assert.Equal(Shortcuts.VolumeStep, fixture.GetProperty("volumeStep").GetDouble());
        var guide = fixture.GetProperty("guide").EnumerateArray().Select(item => (item.GetProperty("keys").GetString()!, item.GetProperty("label").GetString()!)).ToArray();
        Assert.Equal(guide, Shortcuts.Guide);
    }

    [Theory]
    [InlineData("back and forward", "visit home|visit library|visit album:1|back library|back home|back -|forward library|forward album:1|forward -")]
    [InlineData("a new visit drops the forward entries", "visit home|visit library|back home|visit settings|forward -|back home")]
    [InlineData("repeated visits are one entry", "visit home|visit home|visit library|back home|back -")]
    [InlineData("the replayed page is not a new visit", "visit home|visit library|back home|visit home|forward library")]
    [InlineData("search keeps one entry while typing", "visit home|visit search:ro|visit search:rosalia|back home|forward search:rosalia")]
    [InlineData("a failed replay does not swallow the next visit", "visit home|visit library|back home|visit settings|back home")]
    public void KeepsTheNavigationHistory(string name, string steps)
    {
        var history = new NavigationHistory();
        foreach (var step in steps.Split('|'))
        {
            var (action, route) = (step.Split(' ')[0], step.Split(' ')[1]);
            if (action == "visit") { history.Visit(route); continue; }
            var actual = action == "back" ? history.Back() : history.Forward();
            Assert.True((route == "-" ? null : route) == actual, $"{name}: {step} → {actual}");
        }
    }

    [Fact]
    public void ForgetsTheOldestPagesOverCapacity()
    {
        var history = new NavigationHistory { Capacity = 3 };
        foreach (var route in new[] { "a", "b", "c", "d" }) history.Visit(route);
        Assert.Equal("c", history.Back()); Assert.Equal("b", history.Back()); Assert.Null(history.Back());
    }
}
