using System.Collections.ObjectModel;
using System.Collections.Specialized;
using Openfy.Core;
using Xunit;

namespace Openfy.Tests;

public class CollectionUpdateTests
{
    [Fact]
    public void InitialFiveHundredSongCollectionEmitsOneNotification()
    {
        var rows = new BatchedObservableCollection<string>();
        var changes = new List<NotifyCollectionChangedAction>();
        rows.CollectionChanged += (_, args) => changes.Add(args.Action);
        rows.ReplaceAll(Enumerable.Range(0, 500).Select(i => i.ToString()));
        Assert.Equal(500, rows.Count);
        Assert.Equal([NotifyCollectionChangedAction.Reset], changes);
    }
    [Fact]
    public void AdvancingAThousandSongQueueRemovesOnlyTheDepartedHead()
    {
        var queue = new ObservableCollection<string>(Enumerable.Range(0, 1000).Select(i => i.ToString()));
        var changes = new List<NotifyCollectionChangedAction>();
        queue.CollectionChanged += (_, args) => changes.Add(args.Action);
        CollectionUpdates.Replace(queue, queue.Skip(1), value => value);
        Assert.Equal(999, queue.Count);
        Assert.Equal("1", queue[0]);
        Assert.Equal([NotifyCollectionChangedAction.Remove], changes);
    }

    private record Row(string Id, int Progress);
    private record SnapshotRow(string Id, string[] Artists);
    [Fact]
    public void DownloadProgressChangesOnlyOneOfFiveHundredRows()
    {
        var rows = new ObservableCollection<Row>(Enumerable.Range(0, 500).Select(i => new Row(i.ToString(), 0)));
        var changes = new List<NotifyCollectionChangedEventArgs>();
        rows.CollectionChanged += (_, args) => changes.Add(args);
        CollectionUpdates.Replace(rows, rows.Select(row => row.Id == "42" ? row with { Progress = 77 } : row), row => row.Id);
        Assert.Single(changes);
        Assert.Equal(NotifyCollectionChangedAction.Replace, changes[0].Action);
        Assert.Equal(42, changes[0].NewStartingIndex);
        Assert.Equal(77, rows[42].Progress);
    }

    [Fact]
    public void EquivalentHttpSnapshotsDoNotRecreateObservableRows()
    {
        var rows = new ObservableCollection<SnapshotRow>(Enumerable.Range(0, 500).Select(i => new SnapshotRow(i.ToString(), ["Openfy"])));
        var changes = new List<NotifyCollectionChangedAction>();
        rows.CollectionChanged += (_, args) => changes.Add(args.Action);
        CollectionUpdates.Replace(rows, rows.Select(row => new SnapshotRow(row.Id, ["Openfy"])), row => row.Id,
            (a, b) => a.Id == b.Id && a.Artists.SequenceEqual(b.Artists));
        Assert.Empty(changes);
    }
    [Fact]
    public void ReorderingAndReplacingMetadataRetainsQueueIdentitiesAndDuplicates()
    {
        var rows = new ObservableCollection<Row>([new("occurrence-a", 1), new("occurrence-b", 1), new("removed", 0)]);
        Row[] wanted = [new("occurrence-b", 2), new("new", 0), new("occurrence-a", 1)];
        CollectionUpdates.Replace(rows, wanted, row => row.Id);
        Assert.Equal(wanted, rows);
        CollectionUpdates.Replace(rows, [], row => row.Id);
        Assert.Empty(rows);
    }
}
