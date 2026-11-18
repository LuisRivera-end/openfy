using System.Text.Json;
using Openfy.Core;
using Xunit;

public sealed class ListeningTests
{
    [Fact]
    public void KeepsTheContractContextOnTheSessionAndAcrossRestoration()
    {
        var fixture = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "listening-contract.json")));
        var context = fixture.GetProperty("context").Deserialize<ListeningContext>(Contracts.Json)!;
        var entry = fixture.GetProperty("entry").Deserialize<PlaybackEntry>(Contracts.Json)!;
        long at = fixture.GetProperty("startedAt").GetInt64();
        var accumulator = new ListeningAccumulator(entry with { Context = context }, fixture.GetProperty("deviceId").GetString()!, fixture.GetProperty("sessionId").GetString()!, at);
        var checkpoint = accumulator.Checkpoint();
        Assert.Equal(context, checkpoint.Context);
        var serialized = JsonSerializer.SerializeToElement(checkpoint, Contracts.Json).GetProperty("context");
        foreach (var property in fixture.GetProperty("context").EnumerateObject()) {
            if (property.Value.ValueKind == JsonValueKind.Null) Assert.False(serialized.TryGetProperty(property.Name, out _));
            else Assert.Equal(property.Value.GetRawText(), serialized.GetProperty(property.Name).GetRawText());
        }
        var restored = new ListeningAccumulator(entry, checkpoint.DeviceId, checkpoint.Id, at, checkpoint);
        Assert.Equal(context, restored.Checkpoint().Context);
        Assert.False(JsonSerializer.SerializeToElement(new ListeningAccumulator(entry, checkpoint.DeviceId, checkpoint.Id, at).Checkpoint(), Contracts.Json).TryGetProperty("context", out _));
    }
    [Fact]
    public void DeserializesRecentCards()
    {
        var recent = JsonSerializer.Deserialize<RecentListening>("""{"items":[{"kind":"playlist","key":"playlist:p1","id":"p1","title":"Para correr","subtitle":"Playlist","artwork":null,"lastPlayedAt":5,"item":null}]}""", Contracts.Json)!;
        Assert.Equal("playlist", recent.Items[0].Kind); Assert.Null(recent.Items[0].Item);
    }
    [Fact]
    public void RestoresDuplicateQueueEntriesWithTheirOwnContexts()
    {
        var entries = new[] { new PlaybackEntry("local", "same", QueueId: "one", Context: new("playlist", "p1")), new PlaybackEntry("local", "same", QueueId: "two", Context: new("song")) };
        var saved = new PlaybackSnapshot(3, entries.ToList(), 0, 10, "all", true, 0, ["one", "two"]);
        var restored = JsonSerializer.Deserialize<PlaybackSnapshot>(JsonSerializer.Serialize(saved, Contracts.Json), Contracts.Json)!;
        Assert.Equal(entries, restored.Queue);
        Assert.Equal(entries, CollectionQueue.Mix(restored.Queue).OrderBy(entry => entry.QueueId));
    }
    [Fact]
    public void MissingOptionalArtistReferencesAreOmittedFromTheSharedWireFormat()
    {
        var song = new YouTubeSong("abcdefghijk", "Sin referencias", ["Openfy"], null, null, 100);
        var json = JsonSerializer.SerializeToElement(song, Contracts.Json);
        Assert.False(json.TryGetProperty("artistRefs", out _)); Assert.False(json.TryGetProperty("genres", out _));
        Assert.Equal(JsonValueKind.Null, json.GetProperty("albumId").ValueKind);
    }
    [Fact]
    public void UsesTheSameListeningContractAsThePwa()
    {
        var fixture = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "listening-contract.json")));
        var entry = fixture.GetProperty("entry").Deserialize<PlaybackEntry>(Contracts.Json)!;
        long at = fixture.GetProperty("startedAt").GetInt64();
        foreach (var example in fixture.GetProperty("cases").EnumerateArray())
        {
            var accumulator = new ListeningAccumulator(entry, fixture.GetProperty("deviceId").GetString()!, fixture.GetProperty("sessionId").GetString()!, at);
            accumulator.Reset(0, 0, at);
            foreach (var sample in example.GetProperty("samples").EnumerateArray()) accumulator.Sample(sample[0].GetDouble(), 100, sample[1].GetDouble(), at + sample[1].GetInt64(), sample[2].GetBoolean());
            Assert.Equal(example.GetProperty("listenedMs").GetInt64(), accumulator.Session.ListenedMs);
            Assert.Equal(example.GetProperty("qualified").GetBoolean(), accumulator.Session.QualifiedAt != null);
        }
    }
    [Fact]
    public void SplitsMexicoMidnightAndKeepsRestoredListening()
    {
        long at = DateTimeOffset.Parse("2027-01-01T06:00:00Z").ToUnixTimeMilliseconds();
        var entry = new PlaybackEntry("local", Guid.NewGuid().ToString());
        var first = new ListeningAccumulator(entry, Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), at - 5000);
        first.Reset(0, 0, at - 5000, true); first.Sample(10, 100, 10000, at + 5000, false);
        Assert.Equal(5000, first.Session.Days["2026-12-31"]); Assert.Equal(5000, first.Session.Days["2027-01-01"]);
        var restored = new ListeningAccumulator(entry, first.Session.DeviceId, first.Session.Id, at + 100000, first.Checkpoint());
        restored.Reset(10, 0, at + 100000); restored.Sample(10, 100, 50000, at + 150000, true); restored.Sample(90, 100, 130000, at + 230000, false);
        Assert.Equal(90000, restored.Session.ListenedMs); Assert.NotNull(restored.Session.QualifiedAt);
    }
}
