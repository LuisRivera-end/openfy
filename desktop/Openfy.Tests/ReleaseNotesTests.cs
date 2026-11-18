using System.Text.Json;
using Openfy.Core;
using Xunit;

public sealed class ReleaseNotesTests
{
    [Fact]
    public void SelectsTheReleasesSinceTheLastSeenVersionLikeThePwa()
    {
        var fixture = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "release-notes-contract.json")));
        var releases = fixture.GetProperty("releases").EnumerateArray().Select(item => item.GetString()!).ToArray();
        foreach (var example in fixture.GetProperty("cases").EnumerateArray())
        {
            string? lastSeen = example.GetProperty("lastSeen").ValueKind == JsonValueKind.Null ? null : example.GetProperty("lastSeen").GetString();
            var expected = example.GetProperty("expected").EnumerateArray().Select(item => item.GetString()!).ToArray();
            var actual = ReleaseNotes.Since(releases, version => version, lastSeen, example.GetProperty("current").GetString()!);
            Assert.True(expected.SequenceEqual(actual), $"{example.GetProperty("name").GetString()}: {string.Join(", ", actual)}");
        }
    }

    [Fact]
    public void EmbedsTheNotesOfTheRunningVersion()
    {
        Assert.NotEmpty(ReleaseNotes.Bundled);
        var current = ReleaseNotes.Since(ReleaseNotes.Bundled, null, ReleaseInfo.Current.Version);
        Assert.Single(current);
        Assert.All(current[0].Items, item => Assert.True(ReleaseNotes.Labels.ContainsKey(item.Type) && item.Text.Length > 0));
        Assert.Equal("14 de noviembre de 2026", ReleaseNotes.FormatDate("2026-11-14"));
    }
}
