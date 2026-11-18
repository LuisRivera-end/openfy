using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.ComponentModel;

namespace Openfy.Core;

public sealed class BatchedObservableCollection<T> : ObservableCollection<T>
{
    public void ReplaceAll(IEnumerable<T> values)
    {
        var copied = values.ToArray();
        CheckReentrancy();
        Items.Clear();
        foreach (var value in copied) Items.Add(value);
        OnPropertyChanged(new PropertyChangedEventArgs(nameof(Count)));
        OnPropertyChanged(new PropertyChangedEventArgs("Item[]"));
        OnCollectionChanged(new NotifyCollectionChangedEventArgs(NotifyCollectionChangedAction.Reset));
    }
}
