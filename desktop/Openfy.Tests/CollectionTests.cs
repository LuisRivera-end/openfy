using Openfy.Core;
using Xunit;

namespace Openfy.Tests;

public class CollectionTests
{
    [Fact]
    public void MigratesCollectionFiltersWithoutChangingTheRankingPreferences()
    {
        var ranking = new LibraryFilters { Query = "sienna", Downloaded = true, Sort = "plays", Direction = "desc", Artist = "A", Album = "B", Genre = "C", Source = "youtube", Favorite = true };
        var collection = ranking.ForCollection();
        Assert.Equal(new LibraryFilters { Query = "sienna", Downloaded = true, Sort = "plays", Direction = "desc" }, collection);
        Assert.Equal("A", ranking.Artist); Assert.True(ranking.Favorite);
    }

    [Fact]
    public void MixesEveryOccurrenceWithoutChangingTheOriginalCollection()
    {
        var original = new[] { new PlaybackEntry("local", "a", QueueId: "first-a"), new PlaybackEntry("youtube", Song: new("abcdefghijk", "B", [], null, null, 120), QueueId: "b"), new PlaybackEntry("local", "a", QueueId: "second-a") };
        var starts = new HashSet<string>();
        for (int seed = 0; seed < 20; seed++) {
            var mixed = CollectionQueue.Mix(original, new Random(seed));
            Assert.Equal(original.Select(row => row.QueueId).Order(), mixed.Select(row => row.QueueId).Order());
            starts.Add(mixed[0].QueueId!);
        }
        Assert.Equal(3, starts.Count); Assert.Equal("first-a", original[0].QueueId);
        Assert.Empty(CollectionQueue.Mix(Array.Empty<PlaybackEntry>()));
        Assert.Equal(original.Take(1), CollectionQueue.Mix(original.Take(1)));
    }
}
